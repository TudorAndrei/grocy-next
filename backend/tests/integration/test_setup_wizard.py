from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from grocy.core.config import clear_settings_cache
from grocy.db.session import reset_engine
from grocy.main import create_app

TOKEN = "first-run-token"


@pytest.fixture
def empty_client(monkeypatch) -> Iterator[TestClient]:
    monkeypatch.setenv("GROCY_SEED_DEMO_DATA", "false")
    monkeypatch.setenv("GROCY_SETUP_TOKEN", TOKEN)
    clear_settings_cache()
    reset_engine()
    with TestClient(create_app()) as test_client:
        yield test_client


def _setup(client: TestClient, **overrides):
    body = {"setup_token": TOKEN, "username": "owner", "password": "correct horse"}
    return client.post("/api/v2/setup", json={**body, **overrides})


def test_setup_creates_first_admin_once(empty_client: TestClient):
    assert empty_client.get("/api/v2/setup").json() == {"needs_setup": True}

    created = _setup(empty_client)
    assert created.status_code == 201
    headers = {"GROCY-API-KEY": created.json()["api_key"]}
    users = empty_client.get("/api/users", headers=headers).json()
    assert [u["username"] for u in users] == ["owner"]
    assert empty_client.get("/api/v2/api-keys", headers=headers).status_code == 200

    assert empty_client.get("/api/v2/setup").json() == {"needs_setup": False}
    assert _setup(empty_client, username="intruder").status_code == 409


def test_setup_requires_the_setup_token(empty_client: TestClient):
    assert _setup(empty_client, setup_token="guess").status_code == 403
    assert empty_client.get("/api/v2/setup").json() == {"needs_setup": True}


def test_setup_is_closed_on_seeded_database(client: TestClient):
    assert client.get("/api/v2/setup").json() == {"needs_setup": False}
    assert _setup(client).status_code == 409


def test_setup_rejects_short_password(empty_client: TestClient):
    assert _setup(empty_client, password="short").status_code in {400, 422}
    assert empty_client.get("/api/v2/setup").json() == {"needs_setup": True}


@pytest.mark.parametrize("auth_mode", ["default", "session"])
def test_login_issues_key_and_logout_revokes_it(empty_client: TestClient, monkeypatch, auth_mode):
    from grocy.core.config import get_settings

    monkeypatch.setattr(get_settings(), "auth_mode", auth_mode)
    assert _setup(empty_client).status_code == 201

    wrong = {"username": "owner", "password": "wrong password"}
    assert empty_client.post("/api/v2/login", json=wrong).status_code == 401
    unknown = {"username": "nobody", "password": "correct horse"}
    assert empty_client.post("/api/v2/login", json=unknown).status_code == 401

    login = empty_client.post(
        "/api/v2/login", json={"username": "owner", "password": "correct horse"}
    )
    assert login.status_code == 200
    headers = {"GROCY-API-KEY": login.json()["api_key"]}
    assert empty_client.get("/api/system/info", headers=headers).status_code == 200
    if auth_mode == "session":
        assert "grocy_session" in login.cookies
        assert empty_client.get("/api/user").json()[0]["username"] == "owner"
        assert empty_client.get("/api/v2/api-keys").status_code == 200

    assert empty_client.post("/api/v2/logout", headers=headers).status_code == 204
    assert empty_client.get("/api/system/info", headers=headers).status_code == 401


@pytest.mark.parametrize("auth_mode", ["default", "ldap", "reverse-proxy"])
def test_password_login_uses_the_configured_authentication_provider(
    client: TestClient, api_headers: dict, monkeypatch, auth_mode
):
    from grocy.core.config import get_settings

    created = client.post(
        "/api/users", headers=api_headers, json={"username": "cook", "password": "pan-fried"}
    )
    assert created.status_code == 204
    monkeypatch.setattr(get_settings(), "auth_mode", auth_mode)
    login = client.post("/api/v2/login", json={"username": "cook", "password": "pan-fried"})
    assert login.status_code == {"default": 200, "ldap": 401, "reverse-proxy": 403}[auth_mode]
