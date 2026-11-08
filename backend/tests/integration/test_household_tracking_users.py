from grocy.core.config import get_settings


def test_chore_tracking_assignments_are_authenticated_without_user_directory_access(
    client, api_headers, monkeypatch
):
    path = "/api/v2/chores/tracking/users"
    assert client.get(path).status_code == 401
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    assert (
        client.post(
            "/api/users",
            headers=api_headers,
            json={
                "username": "Chore tracker",
                "first_name": "Casey",
                "last_name": "Reader",
                "password": "secret",
            },
        ).status_code
        == 204
    )
    directory = client.get("/api/users", headers=api_headers).json()
    identity = next(row["id"] for row in directory if row["username"] == "Chore tracker")
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": identity}).json()[
        "api_key"
    ]
    headers = {"GROCY-API-KEY": key}
    assert client.get(path, headers=headers).status_code == 200
    expected = [
        {"id": identity, "username": "Chore tracker", "display_name": "Casey Reader"},
        {"id": 1, "username": "admin", "display_name": "Admin User"},
    ]
    for permission in [7, 5, 10, 24]:
        assert (
            client.put(
                f"/api/users/{identity}/permissions",
                headers=api_headers,
                json={"permissions": [permission]},
            ).status_code
            == 204
        )
        response = client.get(path, headers=headers)
        assert response.status_code == 200, response.text
        assert response.json() == expected
        if permission != 5:
            assert client.get("/api/users", headers=headers).status_code == 403

    execution = client.post(
        "/api/chores/1/execute",
        headers=headers,
        json={"tracked_time": "2020-01-02 03:04:00", "done_by": 1},
    )
    assert execution.status_code == 200, execution.text
    assert execution.json()["done_by_user_id"] == 1
