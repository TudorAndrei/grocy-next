import pytest
from sqlalchemy import text

from grocy.core.config import get_settings
from grocy.db.session import get_session_factory
from grocy.domains.household import task_overview as overview_module


@pytest.fixture
def tasks_page(client, api_headers, monkeypatch):
    client.headers.update(api_headers)
    monkeypatch.setattr(overview_module, "php_date", lambda: "2028-03-11 12:00:00")
    client.post(
        "/api/objects/userfields",
        json={"entity": "tasks", "name": "notes", "caption": "Task notes", "type": "text"},
    ).raise_for_status()

    async def seed():
        async with get_session_factory()() as session:
            await session.execute(text("DELETE FROM tasks"))
            await session.execute(text("UPDATE task_categories SET active=0"))
            await session.execute(
                text(
                    "INSERT INTO task_categories(id,name,active) VALUES "
                    "(10,'Home',1),(11,'Inactive',0),(12,'alpha',1)"
                )
            )
            for identity, name, due, category, assigned, done in [
                (101, "Yesterday", "2028-03-10 23:59:58", 10, 1, 0),
                (102, "Boundary", "2028-03-10 23:59:59", 10, 1, 0),
                (103, "Due today", "2028-03-11", 11, 999, 0),
                (104, "Future", "2028-03-14", None, None, 0),
                (105, "Undated", None, 0, 0, 0),
                (106, "Finished", "2028-03-10", 10, 1, 1),
                (107, "Missing category", "2999-12-31", 999, None, 0),
                (108, "Zero date", "0", None, None, 0),
                (109, "Exactly next five", "2028-03-16 23:59:59", None, None, 0),
            ]:
                await session.execute(
                    text(
                        "INSERT INTO tasks(id,name,due_date,category_id,assigned_to_user_id,done) "
                        "VALUES (:id,:name,:due,:category,:assigned,:done)"
                    ),
                    {
                        "id": identity,
                        "name": name,
                        "due": due,
                        "category": category,
                        "assigned": assigned,
                        "done": done,
                    },
                )
            await session.commit()

    assert client.portal is not None
    client.portal.call(seed)
    client.put("/api/userfields/tasks/101", json={"notes": "Kitchen task"}).raise_for_status()
    return client


def test_task_overview_selects_controller_rows_boundaries_and_limited_labels(tasks_page):
    response = tasks_page.get("/api/v2/tasks/overview")
    response.raise_for_status()
    view = response.json()
    assert view["include_done"] is False
    assert view["next_days"] == 5
    assert [row["id"] for row in view["rows"]] == [101, 102, 103, 104, 105, 107, 108, 109]
    assert [row["name"] for row in view["categories"]] == ["alpha", "Home"]
    rows = {row["id"]: row for row in view["rows"]}
    assert [
        rows[identity]["due_type"] for identity in [101, 102, 103, 104, 105, 107, 108, 109]
    ] == ["overdue", "duetoday", "duetoday", "duesoon", "", "", "", "duesoon"]
    assert rows[101]["category_name"] == "Home"
    assert rows[101]["assigned_name"] == "Admin User"
    assert rows[101]["custom_values"] == {"notes": "Kitchen task"}
    assert rows[103]["has_category"] is True
    assert rows[103]["category_name"] is None
    assert rows[103]["assigned_name"] is None
    assert rows[105]["has_category"] is False
    assert rows[105]["assigned_name"] is None
    assert rows[107]["has_category"] is True
    assert rows[107]["category_name"] is None
    assert "users" not in view
    assert all("password" not in row and "assigned_to_user" not in row for row in view["rows"])


def test_task_overview_include_done_is_php_presence_and_other_filters_are_client_only(tasks_page):
    for suffix in [
        "?include_done",
        "?include_done=",
        "?include_done=0",
        "?include_done=false",
        "?include_done[]=yes",
    ]:
        response = tasks_page.get("/api/v2/tasks/overview" + suffix)
        response.raise_for_status()
        assert response.json()["include_done"] is True
        assert [row["name"] for row in response.json()["rows"]] == [
            "Boundary",
            "Due today",
            "Exactly next five",
            "Finished",
            "Future",
            "Missing category",
            "Undated",
            "Yesterday",
            "Zero date",
        ]
    response = tasks_page.get("/api/v2/tasks/overview?status=overdue&category=Home&user=1")
    response.raise_for_status()
    assert [row["id"] for row in response.json()["rows"]] == [
        101,
        102,
        103,
        104,
        105,
        107,
        108,
        109,
    ]


def test_task_overview_reads_canonical_due_setting_and_reflects_native_writes(tasks_page):
    tasks_page.put("/api/user/settings/tasks_due_soon_days", json={"value": "0"}).raise_for_status()
    view = tasks_page.get("/api/v2/tasks/overview").json()
    assert view["next_days"] == "0"
    assert next(row for row in view["rows"] if row["id"] == 104)["due_type"] == ""
    tasks_page.post(
        "/api/tasks/101/complete", json={"done_time": "2028-03-11 01:02:03"}
    ).raise_for_status()
    assert 101 not in {row["id"] for row in tasks_page.get("/api/v2/tasks/overview").json()["rows"]}
    all_rows = tasks_page.get("/api/v2/tasks/overview?include_done").json()["rows"]
    assert next(row for row in all_rows if row["id"] == 101)["done"] == 1
    tasks_page.post("/api/tasks/101/undo", json={}).raise_for_status()
    task = next(
        row for row in tasks_page.get("/api/v2/tasks/overview").json()["rows"] if row["id"] == 101
    )
    assert task["done"] == 0
    assert task["custom_values"] == {"notes": "Kitchen task"}
    tasks_page.delete("/api/objects/tasks/101").raise_for_status()
    assert 101 not in {
        row["id"] for row in tasks_page.get("/api/v2/tasks/overview?include_done").json()["rows"]
    }


def test_task_overview_matches_authenticated_native_read_boundary(client, api_headers, monkeypatch):
    assert client.get("/api/v2/tasks/overview").status_code == 401
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users", headers=api_headers, json={"username": "Task reader", "password": ""}
    ).raise_for_status()
    identity = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Task reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": identity}).json()[
        "api_key"
    ]
    headers = {"GROCY-API-KEY": key}
    assert client.get("/api/users", headers=headers).status_code == 403
    response = client.get("/api/v2/tasks/overview", headers=headers)
    response.raise_for_status()
    assert "users" not in response.json()
    assert client.post("/api/tasks/1/complete", headers=headers, json={}).status_code == 403
