from pathlib import Path

from fastapi.testclient import TestClient


def test_permissions_keys_and_mcp_use_stored_identity(client: TestClient, api_headers: dict):
    created = client.post(
        "/api/users", headers=api_headers, json={"username": "Reader", "password": "secret"}
    )
    assert created.status_code == 204
    users = client.get("/api/users", headers=api_headers).json()
    user_id = next(u["id"] for u in users if u["username"] == "Reader")
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": user_id}).json()
    headers = {"GROCY-API-KEY": key["api_key"]}
    assert client.get("/api/stock", headers=headers).status_code == 403
    grant = client.put(
        f"/api/users/{user_id}/permissions", headers=api_headers, json={"permission_ids": [7]}
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
        {"permission_id": 1, "user_id": 1},
    ]
    client.put(
        f"/api/users/{user_id}/permissions", headers=api_headers, json={"permission_ids": []}
    )
    assert client.get("/api/stock", headers=headers).status_code == 403
    client.put(
        f"/api/users/{user_id}/permissions", headers=api_headers, json={"permission_ids": [24]}
    )
    tracked = client.post("/api/chores/1/execute", headers=headers)
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
    path = "/api/files/equipment/manual.txt"
    assert client.put(path, headers=api_headers, content=b"Manual").status_code == 204
    downloaded = client.get(path, headers=api_headers)
    assert downloaded.content == b"Manual"
    assert "attachment" in downloaded.headers["content-disposition"]
    assert client.put(path, headers=api_headers, content=b"0123456789").status_code == 413
    assert client.get(path, headers=api_headers).content == b"Manual"
    assert (
        client.put("/api/files/%2e%2e/escaped.txt", headers=api_headers, content=b"bad").status_code
        == 400
    )
    assert not (tmp_path / "escaped.txt").exists()
    import base64

    for invalid in ("../escaped.txt", "/absolute.txt", "nested/file.txt"):
        encoded = base64.b64encode(invalid.encode()).decode()
        assert (
            client.put(
                f"/api/files/equipment/{encoded}", headers=api_headers, content=b"bad"
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


def test_picture_response_preserves_original_and_aspect_ratio(
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
            "/api/files/productpictures/photo.png", headers=api_headers, content=original.getvalue()
        ).status_code
        == 204
    )
    response = client.get(
        "/api/files/productpictures/photo.png?force_serve_as=picture&best_fit_width=20",
        headers=api_headers,
    )
    assert response.status_code == 200
    with Image.open(BytesIO(response.content)) as resized:
        assert resized.size == (20, 10)
    assert (
        client.get("/api/files/productpictures/photo.png", headers=api_headers).content
        == original.getvalue()
    )
