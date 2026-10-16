from pathlib import Path

from fastapi.testclient import TestClient


def test_permissions_keys_and_mcp_use_stored_identity(
    client: TestClient, api_headers: dict, monkeypatch, tmp_path: Path
):
    from grocy.core.config import get_settings

    monkeypatch.setattr(get_settings(), "default_permissions", [])
    created = client.post(
        "/api/users", headers=api_headers, json={"username": "Reader", "password": "secret"}
    )
    assert created.status_code == 204
    users = client.get("/api/users", headers=api_headers).json()
    user_id = next(u["id"] for u in users if u["username"] == "Reader")
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": user_id}).json()
    headers = {"GROCY-API-KEY": key["api_key"]}
    assert client.get("/api/stock", headers=headers).status_code == 200
    assert (
        client.post("/api/stock/products/1/add", headers=headers, json={"amount": 1}).status_code
        == 403
    )
    assert client.get("/api/system/config", headers=headers).status_code == 200
    import base64

    monkeypatch.setattr(get_settings(), "files_root", tmp_path)
    encoded = base64.b64encode(b"manual.txt").decode()
    path = f"/api/files/equipmentmanuals/{encoded}"
    assert client.put(path, headers=headers, content=b"Manual").status_code == 204
    assert client.get(path, headers=headers).content == b"Manual"
    assert client.delete(path, headers=headers).status_code == 204
    photo = "/api/v2/files/nutrition/reader-photo.jpg"
    assert client.put(photo, headers=headers, content=b"photo").status_code == 204
    assert client.get(photo, headers=headers).content == b"photo"
    assert client.delete(photo, headers=headers).status_code == 204
    grant = client.put(
        f"/api/users/{user_id}/permissions", headers=api_headers, json={"permissions": [7]}
    )
    assert grant.status_code == 204
    assert client.get("/api/stock", headers=headers).status_code == 200
    # The HTTP bridge must enforce the same permissions as native MCP.
    response = client.post(
        "/api/v2/mcp/call",
        headers=headers,
        json={
            "tool": "nutrition_upsert",
            "arguments": {"product_id": 1, "payload": {}},
        },
    )
    assert response.status_code == 403
    response = client.post(
        "/api/v2/mcp/call",
        headers=headers,
        json={
            "tool": "products_get",
            "arguments": {"product_id": 1, "user_id": 1},
        },
    )
    assert response.status_code == 422
    assert client.get("/api/users/1/permissions", headers=api_headers).json() == [
        {"id": 1, "permission_id": 1, "user_id": 1},
    ]
    client.put(f"/api/users/{user_id}/permissions", headers=api_headers, json={"permissions": []})
    assert (
        client.post("/api/stock/products/1/add", headers=headers, json={"amount": 1}).status_code
        == 403
    )
    client.put(f"/api/users/{user_id}/permissions", headers=api_headers, json={"permissions": [24]})
    tracked = client.post("/api/chores/1/execute", headers=headers, json={})
    assert tracked.status_code == 200
    assert tracked.json()["done_by_user_id"] == user_id
    assert client.post("/api/batteries/1/charge", headers=headers).status_code == 403
    assert client.delete(f"/api/v2/api-keys/{key['id']}", headers=api_headers).status_code == 204
    assert client.get("/api/user", headers=headers).status_code == 401


def test_file_storage_is_bounded_and_rejects_escape(
    client: TestClient, api_headers: dict, tmp_path: Path, monkeypatch
):
    from grocy.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "files_root", tmp_path / "files")
    monkeypatch.setattr(settings, "max_upload_bytes", 8)
    path = "/api/v2/files/equipment/manual.txt"
    assert client.put(path, headers=api_headers, content=b"Manual").status_code == 204
    downloaded = client.get(path, headers=api_headers)
    assert downloaded.content == b"Manual"
    assert "inline" in downloaded.headers["content-disposition"]
    assert client.put(path + "2", headers=api_headers, content=b"0123456789").status_code == 413
    assert client.get(path, headers=api_headers).content == b"Manual"
    assert (
        client.put(
            "/api/v2/files/%2e%2e/escaped.txt", headers=api_headers, content=b"bad"
        ).status_code
        == 400
    )
    assert not (tmp_path / "escaped.txt").exists()
    import base64

    for invalid in ("../escaped.txt", "/absolute.txt", "nested/file.txt"):
        encoded = base64.b64encode(invalid.encode()).decode()
        assert (
            client.put(
                f"/api/v2/files/equipment/{encoded}", headers=api_headers, content=b"bad"
            ).status_code
            == 400
        )
    assert client.delete(path, headers=api_headers).status_code == 204
    assert client.get(path, headers=api_headers).status_code == 404


def test_calendar_subscription_is_scoped_and_escaped(client: TestClient, api_headers: dict):
    task = client.post(
        "/api/objects/tasks",
        headers=api_headers,
        json={
            "name": "Check, shelves\nBEGIN:VEVENT",
            "due_date": "2027-01-01T12:00:00",
        },
    )
    assert task.status_code == 200
    link = client.get("/api/calendar/ical/sharing-link", headers=api_headers).json()["url"]
    calendar = client.get(link)
    assert calendar.status_code == 200
    assert "SUMMARY:Task due: Check\\, shelves\\nBEGIN:VEVENT\r\n" in calendar.text
    assert all(len(line.encode()) <= 75 for line in calendar.text.split("\r\n"))
    secret = link.split("secret=", 1)[1]
    assert client.get("/api/stock", headers={"GROCY-API-KEY": secret}).status_code == 401
    assert client.get(f"/api/stock?secret={secret}").status_code == 401

    from grocy.db.models.users import ApiKey
    from grocy.db.session import get_session_factory

    legacy = "saved-calendar-subscription"

    async def save_legacy_key():
        async with get_session_factory()() as session:
            session.add(ApiKey(api_key=legacy, user_id=1, key_type="calendar"))
            await session.commit()

    portal = client.portal
    assert portal is not None
    portal.call(save_legacy_key)
    assert client.get(f"/api/calendar/ical?secret={legacy}").status_code == 200
    assert client.get("/api/stock", headers={"GROCY-API-KEY": legacy}).status_code == 401


def test_extension_picture_response_preserves_original_and_aspect_ratio(
    client: TestClient, api_headers: dict, tmp_path: Path, monkeypatch
):
    from io import BytesIO

    from PIL import Image

    from grocy.core.config import get_settings

    monkeypatch.setattr(get_settings(), "files_root", tmp_path)
    original = BytesIO()
    Image.new("RGB", (100, 50), "red").save(original, "PNG")
    assert (
        client.put(
            "/api/v2/files/productpictures/photo.png",
            headers=api_headers,
            content=original.getvalue(),
        ).status_code
        == 204
    )
    response = client.get(
        "/api/v2/files/productpictures/photo.png?force_serve_as=picture&best_fit_width=20",
        headers=api_headers,
    )
    assert response.status_code == 200
    with Image.open(BytesIO(response.content)) as resized:
        assert resized.size == (20, 10)
    assert (
        client.get("/api/v2/files/productpictures/photo.png", headers=api_headers).content
        == original.getvalue()
    )


def test_user_defaults_and_operation_permissions(client: TestClient, api_headers: dict):
    client.headers.update(api_headers)
    assert (
        client.post("/api/users", json={"username": "Profile user", "password": "keep"}).status_code
        == 204
    )
    user = next(row for row in client.get("/api/users").json() if row["username"] == "Profile user")
    user_id = user["id"]
    assert client.get(f"/api/users/{user_id}/permissions").json() == [
        {"id": 2, "user_id": user_id, "permission_id": 1}
    ]
    key = client.post("/api/v2/api-keys", json={"user_id": user_id}).json()["api_key"]
    headers = {"GROCY-API-KEY": key}
    assert (
        client.put(f"/api/users/{user_id}/permissions", json={"permissions": [6]}).status_code
        == 204
    )
    assert (
        client.put(
            f"/api/users/{user_id}",
            headers=headers,
            json={
                "username": "Profile user",
                "first_name": "Updated",
                "last_name": "",
                "password": "",
            },
        ).status_code
        == 204
    )
    assert client.get("/api/user", headers=headers).json()[0]["first_name"] == "Updated"
    assert (
        client.put("/api/users/1", headers=headers, json={"first_name": "Wrong user"}).status_code
        == 403
    )
    assert client.get(f"/api/users/{user_id}/permissions", headers=headers).status_code == 403
    assert (
        client.put(f"/api/users/{user_id}/permissions", json={"permissions": [3]}).status_code
        == 204
    )
    assert (
        client.post(
            "/api/users", headers=headers, json={"username": "Created by manager", "password": ""}
        ).status_code
        == 204
    )
    assert (
        client.put(f"/api/users/{user_id}/permissions", json={"permissions": [5]}).status_code
        == 204
    )
    assert (
        client.post("/api/users", headers=headers, json={"username": "Read only"}).status_code
        == 403
    )


async def test_empty_profile_password_preserves_stored_password(
    client: TestClient, api_headers: dict
):
    from sqlalchemy import select

    from grocy.db.models.users import User
    from grocy.db.session import get_session_factory

    client.headers.update(api_headers)
    assert (
        client.post(
            "/api/users", json={"username": "Password user", "password": "keep"}
        ).status_code
        == 204
    )
    async with get_session_factory()() as session:
        user = await session.scalar(select(User).where(User.username == "Password user"))
        assert user is not None
        user_id, password = user.id, user.password
        assert password.startswith("$2y$")
    for value in ("", None, "0"):
        assert (
            client.put(
                f"/api/users/{user_id}",
                json={
                    "username": "Password user",
                    "password": value,
                    "first_name": "Updated",
                    "last_name": "",
                },
            ).status_code
            == 204
        )
        async with get_session_factory()() as session:
            assert await session.scalar(select(User.password).where(User.id == user_id)) == password


def test_native_key_use_preserves_file_time_and_credential_priority(tmp_path, monkeypatch):
    import os
    import sqlite3
    import time
    from datetime import datetime

    from grocy.core.config import clear_settings_cache
    from grocy.core.time import server_timezone
    from grocy.main import create_app

    database = tmp_path / "native-key-use.db"
    monkeypatch.setenv("GROCY_DATABASE_URL", f"sqlite+aiosqlite:///{database}")
    monkeypatch.setenv("GROCY_DATABASE_WAL", "false")
    clear_settings_cache()
    with TestClient(create_app()) as api:
        api.options("/api/system/info")
        with sqlite3.connect(database) as db:
            db.execute(
                "INSERT INTO api_keys(api_key,user_id,expires) "
                "VALUES ('native-valid',1,'2999-12-31 23:59:59')"
            )
            db.execute(
                "INSERT INTO api_keys(api_key,user_id,expires) "
                "VALUES ('native-orphan',2147483647,'2999-12-31 23:59:59')"
            )
        old_time = int(time.time()) - 7 * 86400
        for key, status in [("native-valid", 200), ("native-orphan", 401)]:
            os.utime(database, (old_time, old_time))
            for _ in range(2):
                response = api.get(
                    "/api/system/info",
                    headers={"GROCY-API-KEY": key},
                    params={"GROCY-API-KEY": "dev-key"},
                )
                assert response.status_code == status, response.text
                assert int(database.stat().st_mtime) == old_time
            with sqlite3.connect(database) as db:
                last_used = db.execute(
                    "SELECT last_used FROM api_keys WHERE api_key=?", (key,)
                ).fetchone()[0]
            assert isinstance(last_used, str) and len(last_used) == 19
        changed = api.get(
            "/api/system/db-changed-time", headers={"GROCY-API-KEY": "native-valid"}
        )
        assert changed.status_code == 200
        assert changed.json()["changed_time"] == datetime.fromtimestamp(
            old_time, server_timezone()
        ).strftime("%Y-%m-%d %H:%M:%S")
        preferred = api.get(
            "/api/user",
            headers={"GROCY-API-KEY": "dev-key"},
            params={"GROCY-API-KEY": "native-orphan"},
        )
        assert preferred.status_code == 200 and preferred.json()[0]["id"] == 1
