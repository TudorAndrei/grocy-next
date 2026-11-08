import sqlite3

import pytest
from sqlalchemy import text

from grocy.core.config import get_settings
from grocy.db.session import get_session_factory


@pytest.fixture(params=["chore", "battery"])
def journal(request, client, api_headers):
    kind = request.param
    entity = "chores" if kind == "chore" else "batteries"
    log = "chores_log" if kind == "chore" else "battery_charge_cycles"
    months = 12 if kind == "chore" else 24
    client.headers.update(api_headers)
    client.put(f"/api/objects/{entity}/1", json={"active": 0}).raise_for_status()
    records = []
    for name, active in [("Alpha", 1), ("z Last", 1), ("Hidden", 0)]:
        body = {"name": name, "active": active}
        if kind == "chore":
            body.update(period_type="daily", track_date_only=1)
        response = client.post(f"/api/objects/{entity}", json=body)
        response.raise_for_status()
        records.append(int(response.json()["created_object_id"]))
    client.post(
        "/api/objects/userfields",
        json={"entity": log, "name": "note", "caption": "Journal note", "type": "text"},
    ).raise_for_status()

    async def seed_logs():
        async with get_session_factory()() as session:
            # Raw SQL keeps the date-only boundary and old creation timestamp intact.
            # Log table and foreign-key column are fixed by this parameterized fixture.
            for identity, record, expression, undone in [
                (901, records[0], "DATE('now','localtime','-1 day') || ' 12:00:00'", 0),
                (902, records[1], "DATE('now','localtime') || ' 12:00:00'", 1),
                (903, records[2], "DATE('now','localtime') || ' 06:00:00'", 0),
                (904, records[0], f"DATE(DATE('now','localtime'),'-{months} months')", 0),
                (905, records[0], f"DATE(DATE('now','localtime'),'-{months + 1} months')", 0),
                (906, records[0], "'2999-01-01 10:00:00'", 0),
            ]:
                await session.execute(
                    text(
                        f"INSERT INTO {log}(id,{kind}_id,tracked_time,undone,"
                        "undone_timestamp,row_created_timestamp) "
                        f"VALUES (:id,:record,{expression},:undone,"
                        "CASE WHEN :undone=1 THEN '2020-01-01 00:00:00' END,"
                        "'2000-01-01 00:00:00')"
                    ),
                    {"id": identity, "record": record, "undone": undone},
                )
            if kind == "chore":
                await session.execute(
                    text(
                        "UPDATE chores_log SET skipped=1,done_by_user_id=1,"
                        "scheduled_execution_time='2000-01-01 00:00:00' WHERE id=901"
                    )
                )
            await session.commit()

    assert client.portal is not None
    client.portal.call(seed_logs)
    client.put(f"/api/userfields/{log}/901", json={"note": "Proof"}).raise_for_status()

    def read(**query):
        response = client.get(f"/api/v2/{entity}/journal", params=query)
        response.raise_for_status()
        return response.json()

    return kind, entity, log, records, read


def test_household_journal_uses_tracking_dates_preserves_states_and_refreshes_after_undo(
    journal, client
):
    kind, _entity, _log, records, read = journal
    view = read()
    assert view["months"] == ("12" if kind == "chore" else "24")
    assert view["selected_id"] is None
    assert [row["id"] for row in view["rows"]] == [906, 902, 903, 901]
    assert [row["name"] for row in view["records"]] == ["Alpha", "z Last"]
    assert {row["id"] for row in view["records"]} == set(records[:2])
    assert next(row for row in view["rows"] if row["id"] == 903)["record_name"] is None
    undone = next(row for row in view["rows"] if row["id"] == 902)
    assert undone["undone"] == 1
    assert undone["undone_timestamp"] == "2020-01-01 00:00:00"
    first = next(row for row in view["rows"] if row["id"] == 901)
    assert first["record_id"] == records[0]
    assert first["record_name"] == "Alpha"
    assert first["custom_values"] == {"note": "Proof"}
    assert first["skipped"] == (1 if kind == "chore" else 0)
    assert first["track_date_only"] == (1 if kind == "chore" else 0)
    assert first["scheduled_execution_time"] == ("2000-01-01 00:00:00" if kind == "chore" else None)
    assert first["done_by_user_id"] == (1 if kind == "chore" else None)
    assert view["users"] == (
        [{"id": 1, "username": "admin", "display_name": "Admin User"}] if kind == "chore" else []
    )
    action = "chores/executions" if kind == "chore" else "batteries/charge-cycles"
    client.post(f"/api/{action}/901/undo", json={}).raise_for_status()
    refreshed = next(row for row in read()["rows"] if row["id"] == 901)
    assert refreshed["undone"] == 1
    assert refreshed["undone_timestamp"]
    assert refreshed["custom_values"] == {"note": "Proof"}


def test_household_journal_retains_raw_php_integer_filter_semantics(journal):
    kind, _entity, _log, records, read = journal
    assert [row["id"] for row in read(months="9999")["rows"]] == [906, 902, 903, 901, 904, 905]
    assert [row["id"] for row in read(months="0")["rows"]] == [906, 902, 903]
    for invalid in ["01", "invalid", "9223372036854775808", "1' OR 1=1 --"]:
        assert [row["id"] for row in read(months=invalid)["rows"]] == [906, 902, 903, 901]
    for accepted_raw in ["+1", "-1", " 1 "]:
        view = read(months=accepted_raw)
        assert view["months"] == accepted_raw
        assert view["rows"] == []
    assert [row["id"] for row in read(**{kind: f"+{records[0]}"})["rows"]] == [906, 901]
    assert read(**{kind: "-1"})["rows"] == []
    assert read(**{kind: str(records[0])})["selected_id"] == records[0]
    for invalid in [f"0{records[0]}", "all", "1 OR 1=1"]:
        view = read(**{kind: invalid})
        assert view["selected_id"] is None
        assert [row["id"] for row in view["rows"]] == [906, 902, 903, 901]
    assert read(**{"months[]": "0", f"{kind}[]": str(records[0])})["selected_id"] is None


@pytest.mark.parametrize("kind", ["chores", "batteries"])
def test_household_journal_requires_authentication_not_domain_or_action_grants(
    client, api_headers, monkeypatch, kind
):
    path = f"/api/v2/{kind}/journal"
    assert client.get(path).status_code == 401
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users", headers=api_headers, json={"username": "Journal reader", "password": ""}
    ).raise_for_status()
    user = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Journal reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": user}).json()[
        "api_key"
    ]
    headers = {"GROCY-API-KEY": key}
    for permission in [None, 5, 7, 10, 11, 24, 25, 26, 27]:
        client.put(
            f"/api/users/{user}/permissions",
            headers=api_headers,
            json={"permissions": [] if permission is None else [permission]},
        ).raise_for_status()
        response = client.get(path, headers=headers)
        assert response.status_code == 200, response.text


def test_household_journal_uses_sqlite_month_overflow(journal, client):
    kind, _entity, log, records, read = journal

    async def freeze_calendar():
        # Freeze only SQLite's clock input; SQLite itself still applies calendar modifiers.
        oracle = sqlite3.connect(":memory:", check_same_thread=False)

        def calendar_date(*arguments):
            if arguments and arguments[0] == "now":
                arguments = ("2028-03-31", *(item for item in arguments[1:] if item != "localtime"))
            placeholders = ",".join("?" for _argument in arguments)
            return oracle.execute(f"SELECT DATE({placeholders})", arguments).fetchone()[0]

        async with get_session_factory()() as session:
            connection = await session.connection()

            def register_date(sync):
                database = sync.connection.dbapi_connection
                assert database is not None
                database.create_function("date", -1, calendar_date)

            await connection.run_sync(register_date)
            await session.execute(text(f"DELETE FROM {log}"))
            for identity, tracked in [
                (901, "2028-03-01"),
                (902, "2028-03-02"),
                (903, "2028-03-03"),
            ]:
                await session.execute(
                    text(
                        f"INSERT INTO {log}(id,{kind}_id,tracked_time) "
                        "VALUES (:id,:record,:tracked)"
                    ),
                    {"id": identity, "record": records[0], "tracked": tracked},
                )
            await session.commit()

    assert client.portal is not None
    client.portal.call(freeze_calendar)
    # March 31 minus one month overflows February 29 to March 2; equality is excluded.
    assert [row["id"] for row in read(months="1")["rows"]] == [903]
