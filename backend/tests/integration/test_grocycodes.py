import hashlib
import json
from ctypes.util import find_library
from datetime import UTC
from email.utils import parsedate_to_datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import quote, urlsplit

import pytest
from PIL import Image
from sqlalchemy import text

from grocy.core.config import get_settings
from grocy.db.session import get_session_factory

CASES = json.loads(
    (Path(__file__).parents[1] / "fixtures/grocycodes/native-images.json").read_text()
)["cases"]
CASES += json.loads(
    (Path(__file__).parents[1] / "fixtures/grocycodes/native-routes.json").read_text()
)["cases"]


@pytest.mark.parametrize("case", CASES, ids=[f"{i}-{case['kind']}" for i, case in enumerate(CASES)])
def test_code_images_match_pinned_png_output(client, api_headers, monkeypatch, case):
    monkeypatch.setattr(get_settings(), "grocycode_type", case["kind"])
    if case.get("stock"):

        async def create_entry():
            async with get_session_factory()() as session:
                await session.execute(
                    text(
                        "INSERT INTO stock (id, product_id, amount, best_before_date, "
                        "purchased_date, "
                        "stock_id, location_id) VALUES (991, 1, 2, '2099-01-01', '2026-10-28', "
                        "'label-stock-17', 1)"
                    )
                )
                await session.commit()

        assert client.portal is not None
        client.portal.call(create_entry)
    paths = (
        case["paths"]
        if "paths" in case
        else [f"/api/v2/recipes/{quote(case['id'], safe='')}/grocycode"]
    )
    for path in paths:
        response = client.get(
            path, headers=api_headers, params={} if case["size"] is None else {"size": case["size"]}
        )
        if "error" in case:
            assert response.status_code == 500, response.text
            assert response.json()["error_message"] == case["error"]
            continue
        assert response.status_code == 200, response.text
        assert response.headers["Content-Type"] == "image/png"
        assert response.headers["Cache-Control"] == "no-cache"
        assert int(response.headers["Content-Length"]) == len(response.content)
        assert parsedate_to_datetime(response.headers["Last-Modified"]).tzinfo == UTC
        image = Image.open(BytesIO(response.content))
        assert image.size == (case["width"], case["height"])
        assert hashlib.sha256(image.convert("RGB").tobytes()).hexdigest() == case["pixels"]
        if find_library("gd") is not None:
            assert hashlib.sha256(response.content).hexdigest() == case["png"]


@pytest.mark.parametrize(
    "query,download",
    [
        ("download=", False),
        ("download=0", False),
        ("download=false", True),
        ("download=true", True),
        ("download[]=", True),
    ],
)
def test_recipe_code_download_headers_retain_php_query_truth(client, api_headers, query, download):
    response = client.get(f"/recipe/17/grocycode?{query}", headers=api_headers)
    assert response.status_code == 200, response.text
    assert response.headers["Content-Type"] == (
        "application/octet-stream" if download else "image/png"
    )
    assert response.headers.get("Content-Disposition") == (
        "attachment; filename=Grocycode.png" if download else None
    )
    assert Image.open(BytesIO(response.content)).size == (100, 100)


@pytest.mark.parametrize("entity", ["recipe", "product", "chore", "battery", "stockentry"])
def test_legacy_code_head_and_login_redirect(client, api_headers, entity):
    path = f"/{entity}/17/grocycode"
    denied = client.get(path, follow_redirects=False)
    assert denied.status_code == 302
    assert urlsplit(denied.headers["Location"]).path == "/login"
    response = client.get(path, headers=api_headers)
    head = client.head(path, headers=api_headers)
    assert head.status_code == 200
    assert head.content == b""
    assert head.headers["Content-Length"] == response.headers["Content-Length"]


@pytest.mark.parametrize(
    "permission,allowed",
    [(7, {"products", "stock/entries"}), (10, {"chores"}), (11, {"batteries"})],
)
def test_application_codes_use_their_domain_permission(
    client, api_headers, monkeypatch, permission, allowed
):
    paths = ["products", "stock/entries", "chores", "batteries"]
    for path in paths:
        assert client.get(f"/api/v2/{path}/17/grocycode").status_code == 401
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    assert (
        client.post(
            "/api/users",
            headers=api_headers,
            json={"username": "Code reader", "password": "secret"},
        ).status_code
        == 204
    )
    identity = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Code reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": identity}).json()[
        "api_key"
    ]
    headers = {"GROCY-API-KEY": key}
    for path in paths:
        assert client.get(f"/api/v2/{path}/17/grocycode", headers=headers).status_code == 403
    assert (
        client.put(
            f"/api/users/{identity}/permissions",
            headers=api_headers,
            json={"permissions": [permission]},
        ).status_code
        == 204
    )
    for path in paths:
        response = client.get(f"/api/v2/{path}/17/grocycode", headers=headers)
        assert response.status_code == (200 if path in allowed else 403), response.text
    for path in ["product", "chore", "battery", "stockentry"]:
        assert client.get(f"/{path}/17/grocycode", headers=headers).status_code == 200
