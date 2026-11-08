import base64
from urllib.parse import quote, urlsplit

import pytest

from grocy.core.config import get_settings


def test_about_context_is_available_without_domain_grants(client, api_headers, monkeypatch):
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users", headers=api_headers, json={"username": "System reader", "password": ""}
    ).raise_for_status()
    identity = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "System reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": identity}).json()[
        "api_key"
    ]
    path = "/api/v2/system/about"
    assert client.get(path).status_code == 401
    response = client.get(
        path, headers={"GROCY-API-KEY": key, "User-Agent": "About contract client"}
    )
    assert response.status_code == 200, response.text
    context = response.json()
    info = context["system_info"]
    assert info["grocy_version"] == {"Version": "4.5.0", "ReleaseDate": "2025-03-28"}
    assert info["client"] == "About contract client"
    assert info["python_version"]
    assert info["php_version"] == ""
    assert info["sqlite_version"]
    assert isinstance(info["db_version"], int)
    changes = context["changelog"]
    assert changes["newest_release_number"] == 80
    releases = changes["changelog_items"]
    assert [release["release_number"] for release in releases] == list(range(80, 0, -1))
    assert releases[0]["version"] == "4.5.0"
    assert releases[0]["release_date"] == "2025-03-28"
    assert "<h3>Stock</h3>" in releases[0]["body_html"]
    assert "<code>stock_entry</code>" in releases[0]["body_html"]
    assert 'href="https://github.com/zxing-js/library"' in releases[0]["body_html"]
    assert all("<script" not in release["body_html"].lower() for release in releases)


@pytest.mark.parametrize(
    ("query", "title", "start"),
    [
        ("", "", None),
        ("data=", "", None),
        ("data=U3RvY2sjL3N0b2Nrb3ZlcnZpZXc", "Stock", "/stockoverview"),
        ("data=VGFza3MjL3Rhc2tzI2lnbm9yZWQ=", "Tasks", "/tasks"),
        ("data=U3RvY2sjL3N0b2Nrb3ZlcnZpZXc=&data=VGFza3MjL3Rhc2tz", "Tasks", "/tasks"),
        ("data=U3RvY2sjL3N0b2Nrb3ZlcnZpZXc!!!", "Stock", "/stockoverview"),
        (
            "data="
            + quote(base64.b64encode("Chöres#/home/chores?x=1&y=2".encode()).decode(), safe=""),
            "Chöres",
            "/home/chores?x=1&y=2",
        ),
    ],
)
def test_manifest_uses_native_php_query_and_base64_rules(client, api_headers, query, title, start):
    response = client.get("/manifest?" + query, headers=api_headers)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {
        "name": "Grocy " + title,
        "short_name": "Grocy " + title,
        "icons": [{"src": "./img/icon-1024.png", "sizes": "1024x1024", "type": "image/png"}],
        "start_url": start,
        "background_color": "#333131",
        "theme_color": "#333131",
        "display": "standalone",
    }


def test_manifest_auth_prefix_head_and_invalid_data(client, api_headers, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "base_path", "/house.hold")
    monkeypatch.setattr(settings, "base_url", "http://testserver/house.hold")
    denied = client.get("/house.hold/manifest", follow_redirects=False)
    assert denied.status_code == 302
    assert urlsplit(denied.headers["location"]).path == "/house.hold/login"
    get = client.get("/house.hold/manifest?data=VGFza3MjL3Rhc2tz", headers=api_headers)
    head = client.head("/house.hold/manifest?data=VGFza3MjL3Rhc2tz", headers=api_headers)
    assert get.status_code == head.status_code == 200
    assert head.content == b""
    assert head.headers["content-length"] == str(len(get.content))
    assert client.get("/houseXhold/manifest", headers=api_headers).status_code == 404
    malformed = client.get("/house.hold/manifest?data[]=x", headers=api_headers)
    assert malformed.status_code == 500
    assert client.get("/house.hold/manifest?data=/w==", headers=api_headers).content == b""
