from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from grocy.core.config import clear_settings_cache
from grocy.db.session import reset_engine
from grocy.main import create_app


@pytest.fixture
def empty_client(monkeypatch) -> Iterator[TestClient]:
    monkeypatch.setenv("GROCY_SEED_DEMO_DATA", "false")
    clear_settings_cache()
    reset_engine()
    with TestClient(create_app()) as test_client:
        yield test_client


def test_setup_creates_first_admin_once(empty_client: TestClient):
    assert empty_client.get("/api/v2/setup").json() == {"needs_setup": True}

    created = empty_client.post(
        "/api/v2/setup", json={"username": "owner", "password": "correct horse"}
    )
    assert created.status_code == 201
    headers = {"GROCY-API-KEY": created.json()["api_key"]}
    assert empty_client.get("/api/system/info", headers=headers).status_code == 200
    users = empty_client.get("/api/users", headers=headers).json()
    assert [u["username"] for u in users] == ["owner"]
    assert empty_client.get("/api/v2/api-keys", headers=headers).status_code == 200

    assert empty_client.get("/api/v2/setup").json() == {"needs_setup": False}
    again = empty_client.post(
        "/api/v2/setup", json={"username": "intruder", "password": "correct horse"}
    )
    assert again.status_code == 409


def test_setup_is_closed_on_seeded_database(client: TestClient):
    assert client.get("/api/v2/setup").json() == {"needs_setup": False}
    response = client.post("/api/v2/setup", json={"username": "x", "password": "correct horse"})
    assert response.status_code == 409


def test_setup_rejects_short_password(empty_client: TestClient):
    response = empty_client.post("/api/v2/setup", json={"username": "owner", "password": "short"})
    assert response.status_code in {400, 422}
    assert empty_client.get("/api/v2/setup").json() == {"needs_setup": True}
