import asyncio
import base64
import sqlite3
from datetime import datetime
from io import BytesIO

import bcrypt
import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from starlette.requests import ClientDisconnect

from grocy.compatibility.generic import NativeStatements
from grocy.core.config import clear_settings_cache
from grocy.db.session import get_session_factory
from grocy.main import create_app


def test_python_runtime_persists_objects_users_settings_and_files(tmp_path, monkeypatch):
    database = tmp_path / "python.db"
    monkeypatch.setenv("GROCY_USE_NATIVE_PHP", "false")
    monkeypatch.setenv("GROCY_PHP_EXECUTABLE", str(tmp_path / "missing-php"))
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{database}")
    monkeypatch.setenv("GROCY_FILES_ROOT", str(tmp_path / "files"))
    clear_settings_cache()
    headers = {"GROCY-API-KEY": "dev-key"}
    path = "/api/files/userfiles/" + base64.b64encode(b"manual.txt").decode()
    with TestClient(create_app(), headers=headers) as api:
        created = api.post("/api/objects/locations", json={"name": "Python storage"})
        assert created.status_code == 200, created.text
        object_id = created.json()["created_object_id"]
        assert (
            api.put(f"/api/objects/locations/{object_id}", json={"is_freezer": 1}).status_code
            == 204
        )
        assert (
            api.post(
                "/api/users", json={"username": "Python user", "password": "saved"}
            ).status_code
            == 204
        )
        user = api.get("/api/users", params={"query[]": "username=Python user"}).json()[0]
        user_id = user["id"]
        key = api.post("/api/v2/api-keys", json={"user_id": user_id}).json()["api_key"]
        user_headers = {"GROCY-API-KEY": key}
        assert (
            api.put(
                "/api/user/settings/locale", headers=user_headers, json={"value": "de"}
            ).status_code
            == 204
        )
        assert api.get("/api/user/settings/locale").json() == {"value": None}
        assert api.put(path, content=b"Python stream").status_code == 204
        info = api.get("/api/system/info", headers={"user-agent": "Python deployment"}).json()
        assert info["python_version"] and info["db_version"] == 253
        assert info["client"] == "Python deployment"
        assert "/objects/{entity}" in api.get("/api/openapi/specification").json()["paths"]
    with sqlite3.connect(database) as connection:
        password = connection.execute(
            "SELECT password FROM users WHERE id=?", (user_id,)
        ).fetchone()[0]
        assert bcrypt.checkpw(b"saved", password.encode())
    with TestClient(create_app(), headers=headers) as api:
        assert api.get(f"/api/objects/locations/{object_id}").json()["is_freezer"] == 1
        assert api.get("/api/user/settings/locale", headers=user_headers).json() == {"value": "de"}
        assert api.get(path).content == b"Python stream"
        assert api.head(path).content == b""
        assert api.delete(path).status_code == 204
        assert api.delete(f"/api/users/{user_id}").status_code == 204
        assert api.get("/api/user", headers=user_headers).status_code == 401


@pytest.mark.parametrize(
    ("parameters", "expected"),
    [
        ({"query[]": "id>950"}, [1001, 1010]),
        ({"query[]": "id>=1001"}, [1001, 1010]),
        ({"query[]": "id<1001"}, [900]),
        ({"query[]": "id<=1001"}, [900, 1001]),
        ({"query[]": "id=1001"}, [1001]),
        ({"query[]": "id!=1001"}, [900, 1010]),
        ({"query[]": "name~AB_C"}, [1001]),
        ({"query[]": "name!~AB_C"}, [900, 1010]),
        ({"query[]": "description=null"}, [900, 1010]),
        ({"query[]": "description§^Bä.$"}, [1001]),
        ({"query[]": "description§["}, []),
        ({"query[]": "name~ABC]"}, [1010]),
        ({"query[]": "id!<1001"}, [900, 1001, 1010]),
        ({"order": "id:desc", "limit": "1", "offset": "1"}, [1001]),
        ({"order": "id", "offset": "1"}, [1001, 1010]),
        ({"order": "id:desc:ignored"}, [1010, 1001, 900]),
        ({"limit": "none"}, []),
    ],
)
def test_object_filters_use_sqlite_comparisons(client, api_headers, parameters, expected):
    client.headers.update(api_headers)
    for object_id, name, description in (
        (900, "Query AC", None),
        (1001, "Query ABBC", "Bär"),
        (1010, "Query ABC", "null"),
    ):
        response = client.post(
            "/api/objects/locations",
            json={"id": object_id, "name": name, "description": description},
        )
        assert response.status_code == 200, response.text
    response = client.get(
        "/api/objects/locations",
        params=[("query[]", "name~Query "), ("order", "id:asc"), *parameters.items()],
    )
    assert response.status_code == 200, response.text
    assert [row["id"] for row in response.json()] == expected


@pytest.mark.parametrize(
    "parameters",
    [{"query[]": "unknown=1"}, {"order": 'name";DROP TABLE users;--'}, {"query[]": "id"}],
)
def test_object_query_validation_keeps_saved_data(client, api_headers, parameters):
    client.headers.update(api_headers)
    before = client.get("/api/objects/locations").json()
    assert client.get("/api/objects/locations", params=parameters).status_code == 500
    assert client.get("/api/objects/locations").json() == before
    assert client.get("/api/user").json()[0]["username"] == "admin"


async def test_python_sqlite_callbacks_execute_with_native_statements(client):
    async with get_session_factory()() as session:
        result = await NativeStatements(session).execute(
            {
                "context": {"action": "select", "table": ""},
                "query": "SELECT regexp('^B[ä]r', 'Bär') AS matched, "
                "regexp('[', 'Bär') AS invalid, regexp('^$', NULL) AS empty, "
                "regexp('^B.r$', 'B' || char(10) || 'r') AS newline, "
                "ceil(1.2) AS positive, ceil(-1.2) AS negative, ceil(NULL) AS zero",
            }
        )
    assert result["rows"] == [
        {
            "matched": 1,
            "invalid": 0,
            "empty": 1,
            "newline": 1,
            "positive": 2.0,
            "negative": -1.0,
            "zero": 0.0,
        }
    ]


def test_python_picture_response_preserves_original_and_upload_limit(
    client, api_headers, tmp_path, monkeypatch
):
    from grocy.core.config import get_settings

    client.headers.update(api_headers)
    monkeypatch.setattr(get_settings(), "files_root", tmp_path / "files")
    output = BytesIO()
    Image.new("RGB", (100, 50), "red").save(output, "PNG")
    payload = output.getvalue()
    path = "/api/files/productpictures/" + base64.b64encode(b"photo.png").decode()
    assert client.put(path, content=payload).status_code == 204
    response = client.get(path, params={"force_serve_as": "picture", "best_fit_width": 20})
    assert response.status_code == 200
    with Image.open(BytesIO(response.content)) as picture:
        assert picture.size == (20, 10)
    assert client.get(path).content == payload
    assert client.put(path, content=b"replacement").status_code == 400
    monkeypatch.setattr(get_settings(), "max_upload_bytes", 2)
    other = "/api/files/userfiles/" + base64.b64encode(b"limited.txt").decode()
    assert client.put(other, content=b"too large").status_code == 413
    assert list((tmp_path / "files" / "userfiles").iterdir()) == []


def test_python_file_names_and_picture_cache_follow_grocy_storage(
    client, api_headers, tmp_path, monkeypatch
):
    from grocy.core.config import get_settings

    client.headers.update(api_headers)
    monkeypatch.setattr(get_settings(), "files_root", tmp_path / "files")
    for name in (b"manual", b"manual:1.txt"):
        invalid = "/api/files/userfiles/" + base64.b64encode(name).decode()
        assert client.put(invalid, content=b"manual").status_code == 400
    output = BytesIO()
    Image.new("RGB", (100, 50), "red").save(output, "PNG")
    path = "/api/files/productpictures/" + base64.b64encode(b"photo.png").decode()
    assert client.put(path, content=output.getvalue()).status_code == 204
    for width in ("wide", "20"):
        response = client.get(path, params={"force_serve_as": "picture", "best_fit_width": width})
        assert response.status_code == 200
    folder = tmp_path / "files" / "productpictures"
    assert sorted(entry.name for entry in folder.iterdir()) == [
        "photo.png",
        "photo__downscaledtoautox20.png",
        "photo__downscaledtoautoxauto.png",
    ]
    assert client.delete(path).status_code == 204
    assert list(folder.iterdir()) == []


def test_python_user_requests_use_grocy_controller_fields(client, api_headers):
    client.headers.update(api_headers)
    created = client.post(
        "/api/users",
        json={"username": "Form user", "password": "secret", "password_confirm": "secret"},
    )
    assert created.status_code == 204, created.text
    assert client.post("/api/users", json={"username": "No password"}).status_code == 400
    users = {row["username"]: row["id"] for row in client.get("/api/users").json()}
    assert "No password" not in users
    path = f"/api/users/{users['Form user']}"
    profile = {"username": "Form user", "first_name": "Form", "last_name": "User"}
    assert client.put(path, json={"username": "Form user"}).status_code == 400
    assert client.put(path, json={**profile, "picture_file_name": "face.png"}).status_code == 204
    assert client.put(path, json=profile).status_code == 204
    user = client.get("/api/users", params={"query[]": "username=Form user"}).json()[0]
    assert (user["first_name"], user["picture_file_name"]) == ("Form", None)
    assert client.put(f"{path}/permissions", json={"permission_ids": [1]}).status_code == 204
    assert client.get(f"{path}/permissions").json() == []
    assert client.put("/api/user/settings/locale", json={}).status_code == 204
    assert client.get("/api/user/settings/locale").json() == {"value": None}


def test_python_system_responses_use_settings_and_full_specification(client, api_headers):
    client.headers.update(api_headers)
    assert client.put("/api/user/settings/locale", json={"value": "de"}).status_code == 204
    config = client.get("/api/system/config").json()
    assert config["LOCALE"] == "de" and config["FEATURE_FLAG_STOCK"] is True
    strings = client.get("/api/system/localization-strings")
    assert strings.status_code == 200
    assert strings.json()["messages"][""]["STOCK"][0] == "Bestand"
    response = client.get("/api/system/time", params={"offset": "invalid"})
    assert response.status_code == 400
    changed = client.get("/api/system/db-changed-time").json()["changed_time"]
    assert datetime.strptime(changed, "%Y-%m-%d %H:%M:%S")


async def test_python_file_upload_disconnect_removes_partial_data(tmp_path, monkeypatch):
    root = tmp_path / "files"
    monkeypatch.setenv("GROCY_FILES_ROOT", str(root))
    monkeypatch.setenv("GROCY_USE_NATIVE_PHP", "false")
    clear_settings_cache()
    app = create_app()
    path = "/api/files/userfiles/" + base64.b64encode(b"stream.bin").decode()

    async def interrupted():
        yield b"partial data"
        raise ClientDisconnect

    async def chunks():
        for _ in range(40):
            yield b"stream\x00" * 10000

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
            headers={"GROCY-API-KEY": "dev-key"},
        ) as api,
    ):
        with pytest.raises(ClientDisconnect):
            await asyncio.wait_for(api.put(path, content=interrupted()), timeout=10)
        assert list((root / "userfiles").iterdir()) == []
        assert (await api.put(path, content=chunks())).status_code == 204
        assert (await api.get(path)).content == b"stream\x00" * 400000
