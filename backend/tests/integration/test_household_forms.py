import pytest
from sqlalchemy import text

from grocy.core.config import get_settings
from grocy.db.session import get_session_factory


def test_household_forms_supply_safe_selected_context_to_master_data_editors(
    client, api_headers, monkeypatch
):
    assert client.get("/api/v2/chores/new/editor").status_code == 401
    assert client.get("/api/v2/tasks/form-context").status_code == 401
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users",
        headers=api_headers,
        json={"username": "Form editor", "first_name": "Casey", "password": "secret"},
    ).raise_for_status()
    identity = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Form editor"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": identity}).json()[
        "api_key"
    ]
    headers = {"GROCY-API-KEY": key}
    for path in ["/api/v2/chores/new/editor", "/api/v2/tasks/form-context"]:
        assert client.get(path, headers=headers).status_code == 200
    client.put(
        f"/api/users/{identity}/permissions",
        headers=api_headers,
        json={"permissions": [30]},
    ).raise_for_status()
    assert client.get("/api/users", headers=headers).status_code == 403
    for name, active in [("Alpha", 1), ("Hidden", 0)]:
        client.post(
            "/api/objects/task_categories",
            headers=api_headers,
            json={"name": name, "active": active},
        ).raise_for_status()
    task = client.get("/api/v2/tasks/form-context", headers=headers)
    task.raise_for_status()
    assert task.json()["current_user_id"] == identity
    assert "Alpha" in [category["name"] for category in task.json()["categories"]]
    assert "Hidden" not in [category["name"] for category in task.json()["categories"]]
    expected_users = [
        {"id": identity, "username": "Form editor", "display_name": "Casey"},
        {"id": 1, "username": "admin", "display_name": "Admin User"},
    ]
    assert task.json()["users"] == expected_users
    new = client.get("/api/v2/chores/new/editor", headers=headers)
    new.raise_for_status()
    assert new.json()["chore"] is None
    assert new.json()["has_history"] is False
    assert new.json()["initial_start_date"]
    # ChoreEditForm uses GetUsersAsDto without the task picker's username ordering.
    assert new.json()["users"] == [expected_users[1], expected_users[0]]
    assert all(
        set(product) == {"id", "name", "stock_unit_name"} for product in new.json()["products"]
    )
    assert client.get("/api/v2/chores/not-an-id/editor", headers=headers).status_code == 422
    assert client.get("/api/v2/chores/999999/editor", headers=headers).status_code == 404
    initial = client.get("/api/v2/chores/1/editor", headers=headers)
    initial.raise_for_status()
    assert initial.json()["chore"]["id"] == 1
    assert initial.json()["has_history"] is False
    execution = client.post("/api/chores/1/execute", headers=api_headers, json={})
    execution.raise_for_status()
    client.post(
        f"/api/chores/executions/{execution.json()['id']}/undo", headers=api_headers, json={}
    ).raise_for_status()
    tracked = client.get("/api/v2/chores/1/editor", headers=headers)
    tracked.raise_for_status()
    assert tracked.json()["has_history"] is True
    assert tracked.json()["initial_start_date"] == initial.json()["initial_start_date"]
    client.put(
        f"/api/users/{identity}/permissions", headers=api_headers, json={"permissions": [24]}
    ).raise_for_status()
    assert client.get("/api/v2/chores/1/editor", headers=headers).status_code == 200
    assert client.get("/api/v2/tasks/form-context", headers=headers).status_code == 200
    assert (
        client.put("/api/objects/chores/1", headers=headers, json={"name": "Denied"}).status_code
        == 403
    )


@pytest.mark.parametrize(
    "stored,expected",
    [
        ("not-a-date", "1970-01-01 02:00:00"),
        ("2020-01-02T03:04:05+05:00", "2020-01-02 00:04:05"),
    ],
)
def test_chore_context_formats_legacy_start_dates_in_server_timezone(
    client, api_headers, monkeypatch, stored, expected
):
    monkeypatch.setenv("TZ", "Europe/Bucharest")

    async def import_legacy_start():
        async with get_session_factory()() as session:
            await session.execute(
                text("UPDATE chores SET start_date=:start WHERE id=1"), {"start": stored}
            )
            await session.commit()

    assert client.portal is not None
    client.portal.call(import_legacy_start)
    response = client.get("/api/v2/chores/1/editor", headers=api_headers)
    response.raise_for_status()
    assert response.json()["initial_start_date"] == expected
