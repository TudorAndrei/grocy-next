import pytest
from sqlalchemy import text

from grocy.core.config import get_settings
from grocy.db.session import get_session_factory


@pytest.fixture
def sections(client):
    async def save():
        async with get_session_factory()() as session:
            await session.execute(
                text(
                    "INSERT INTO meal_plan_sections(id,name,sort_number,time_info) "
                    "VALUES(0,'Context reserved',-100,'00:00:01') "
                    "ON CONFLICT(id) DO UPDATE SET name=excluded.name,"
                    "sort_number=excluded.sort_number,time_info=excluded.time_info"
                )
            )
            await session.execute(
                text(
                    "INSERT INTO meal_plan_sections"
                    "(id,name,sort_number,time_info,row_created_timestamp) "
                    "VALUES(:id,:name,:sort,:time,:created)"
                ),
                [
                    {"created": None, **row}
                    for row in [
                        {"id": -1007, "name": "Context negative id", "sort": -10, "time": None},
                        {"id": 1001, "name": "Context Zulu null", "sort": None, "time": ""},
                        {"id": 1002, "name": "Context Zulu tie", "sort": 1, "time": "08:30:45"},
                        {"id": 1003, "name": "Context Alpha tie", "sort": 1, "time": "not-a-time"},
                        {"id": 1004, "name": "Context numeric", "sort": 2, "time": None},
                        {"id": 1005, "name": "Context empty text", "sort": "", "time": ""},
                        {"id": 1006, "name": "Context sort text", "sort": "2a", "time": "0"},
                        {"id": 1007, "name": "Context negative sort", "sort": -1, "time": "24:99"},
                    ]
                ],
            )
            await session.commit()

    # A saved database can contain NULL, numeric and TEXT sort storage classes.
    # Explicit NULL timestamps exercise raw reads rather than model defaults.
    assert client.portal is not None

    client.portal.call(save)
    return client


def test_mealplan_section_context_keeps_reserved_selection_and_native_sql_sort(
    sections, api_headers
):
    client = sections
    response = client.get("/api/v2/mealplan-sections", headers=api_headers)
    response.raise_for_status()
    rows = response.json()["rows"]
    assert all(row["id"] > 0 for row in rows)
    selected = [row for row in rows if row["id"] >= 1001]
    assert [row["id"] for row in selected] == [1001, 1007, 1002, 1003, 1004, 1005, 1006]
    assert [row["sort_number"] for row in selected] == [None, -1, 1, 1, 2, None, "2a"]
    assert [row["time_info"] for row in selected] == [
        None,
        "24:99",
        "08:30:45",
        "not-a-time",
        None,
        None,
        "0",
    ]
    assert selected[2]["row_created_timestamp"] is None
    assert client.get("/api/v2/mealplan-sections/editor", headers=api_headers).json() == {
        "section": None
    }
    editor = client.get(
        "/api/v2/mealplan-sections/editor?section_id=1002", headers=api_headers
    ).json()["section"]
    assert editor == next(row for row in rows if row["id"] == 1002)
    reserved = client.get(
        "/api/v2/mealplan-sections/editor?section_id=0", headers=api_headers
    ).json()["section"]
    assert reserved["id"] == 0
    assert reserved["name"] == "Context reserved"
    assert reserved["time_info"] == "00:00:01"
    assert (
        client.get(
            "/api/v2/mealplan-sections/editor?section_id=2147483647", headers=api_headers
        ).status_code
        == 404
    )


def test_mealplan_section_presentation_is_authenticated_without_changing_native_write_grants(
    sections, api_headers, monkeypatch
):
    client = sections
    paths = [
        "/api/v2/mealplan-sections",
        "/api/v2/mealplan-sections/editor",
        "/api/v2/mealplan-sections/editor?section_id=0",
    ]
    for path in paths:
        assert client.get(path).status_code == 401
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users", headers=api_headers, json={"username": "Section reader", "password": ""}
    ).raise_for_status()
    identity = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Section reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": identity}).json()[
        "api_key"
    ]
    reader = {"GROCY-API-KEY": key}
    for path in paths:
        assert client.get(path, headers=reader).status_code == 200
    payload = {"name": "Denied section", "sort_number": "", "time_info": "21:15:07"}
    target = "/api/objects/meal_plan_sections/1002"
    assert client.put(target, headers=reader, json=payload).status_code == 403
    client.put(
        f"/api/users/{identity}/permissions", headers=api_headers, json={"permissions": [23]}
    ).raise_for_status()
    # Meal-plan access does not grant generic section mutation: native uses MASTER_DATA_EDIT.
    assert client.put(target, headers=reader, json=payload).status_code == 403
    assert client.get(paths[0], headers=reader).status_code == 200
    client.put(
        f"/api/users/{identity}/permissions", headers=api_headers, json={"permissions": [30]}
    ).raise_for_status()
    client.put(target, headers=reader, json=payload).raise_for_status()
    saved = client.get("/api/v2/mealplan-sections/editor?section_id=1002", headers=reader).json()[
        "section"
    ]
    assert saved["name"] == "Denied section"
    assert saved["sort_number"] is None
    assert saved["time_info"] == "21:15:07"
