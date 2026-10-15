import json
import time
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

CONTRACT = Path(__file__).resolve().parents[3] / "contracts" / "grocy.openapi.json"


@pytest.mark.parametrize("zone", ["UTC", "Europe/Bucharest"])
def test_system_time_uses_server_zone(client: TestClient, api_headers: dict, monkeypatch, zone):
    try:
        with monkeypatch.context() as environment:
            environment.setenv("TZ", zone)
            time.tzset()
            response = client.get("/api/system/time", headers=api_headers, params={"offset": 3600})
            assert response.status_code == 200
            payload = response.json()
            assert payload["timezone"] == zone
            expected = datetime.fromtimestamp(payload["timestamp"], ZoneInfo(zone))
            assert payload["time_local"] == expected.strftime("%Y-%m-%d %H:%M:%S")
            assert payload["time_utc"] == expected.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S")
            assert (
                abs(
                    (
                        datetime.fromisoformat(payload["time_local_sqlite3"])
                        - expected.replace(tzinfo=None)
                    ).total_seconds()
                )
                < 2
            )
            changed = client.get("/api/system/db-changed-time", headers=api_headers).json()
            changed_time = datetime.strptime(changed["changed_time"], "%Y-%m-%d %H:%M:%S")
            assert (
                abs(
                    (
                        changed_time - datetime.now(ZoneInfo(zone)).replace(tzinfo=None)
                    ).total_seconds()
                )
                < 2
            )
    finally:
        time.tzset()


@pytest.mark.parametrize("zone", ["UTC", "Europe/Bucharest"])
def test_calendar_times_keep_server_zone_and_daylight_changes(
    client: TestClient, api_headers: dict, monkeypatch, zone
):
    client.headers.update(api_headers)
    section = client.post(
        "/api/objects/meal_plan_sections", json={"name": "Evening", "time_info": "18:00"}
    ).json()["created_object_id"]
    for day, note in (("2027-01-04", "Winter time"), ("2027-07-04", "Summer time")):
        assert (
            client.post(
                "/api/objects/meal_plan",
                json={"type": "note", "day": day, "note": note, "section_id": section},
            ).status_code
            == 200
        )
    with monkeypatch.context() as environment:
        environment.setenv("TZ", zone)
        response = client.get("/api/calendar/ical")
    assert response.status_code == 200
    calendar = response.text.replace("\r\n ", "")
    assert f"TZID:{zone}\r\n" in calendar
    events = [
        block
        for block in calendar.split("BEGIN:VEVENT")
        if "Winter time" in block or "Summer time" in block
    ]
    assert len(events) == 2
    for block in events:
        scheduled = "20270104T180000" if "Winter time" in block else "20270704T180000"
        prefix, suffix = ("", "Z") if zone == "UTC" else (f";TZID={zone}", "")
        assert f"DTSTART{prefix}:{scheduled}{suffix}\r\n" in block
        assert f"DTEND{prefix}:{scheduled}{suffix}\r\n" in block
    if zone == "Europe/Bucharest":
        assert "BEGIN:DAYLIGHT\r\n" in calendar
        assert "TZOFFSETTO:+0300\r\n" in calendar


def test_contract_entities_and_derived_records(client: TestClient, api_headers: dict):
    spec = json.loads(CONTRACT.read_text())
    entities = spec["components"]["schemas"]["ExposedEntity"]["enum"]
    no_listing = spec["components"]["schemas"]["ExposedEntityNoListing"]["enum"]
    for entity in entities:
        response = client.get(f"/api/objects/{entity}", headers=api_headers)
        assert response.status_code == (400 if entity in no_listing else 200), entity
        if entity not in no_listing:
            assert isinstance(response.json(), list), entity
    bought = client.post(
        "/api/stock/products/1/add",
        headers=api_headers,
        json={"amount": 3, "price": 2, "note": "weekly shop"},
    )
    assert bought.status_code == 200
    assert isinstance(bought.json(), list)
    assert bought.json()[0]["note"] == "weekly shop"
    details = client.get("/api/stock/products/1", headers=api_headers).json()
    assert details["product"]["name"] == "Greek Yogurt"
    assert details["quantity_unit_stock"]["name"] == "Piece"
    assert details["last_price"] == 2
    average = client.get("/api/objects/products_average_price", headers=api_headers).json()
    assert average[0]["price"] == 2
    booking = bought.json()[0]["id"]
    assert (
        client.post(f"/api/stock/bookings/{booking}/undo", headers=api_headers).status_code == 204
    )
    assert client.get("/api/stock/products/1", headers=api_headers).json()["stock_amount"] == 0


def test_custom_fields_and_records_roundtrip(client: TestClient, api_headers: dict):
    entity = client.post(
        "/api/objects/userentities",
        headers=api_headers,
        json={"name": "warranties", "caption": "Warranties"},
    ).json()
    definition = client.post(
        "/api/objects/userfields",
        headers=api_headers,
        json={
            "entity": "userobjects",
            "name": "serial",
            "caption": "Serial number",
            "type": "text",
        },
    )
    assert definition.status_code == 200
    row = client.post(
        "/api/objects/userobjects",
        headers=api_headers,
        json={
            "userentity_id": entity["created_object_id"],
        },
    ).json()
    object_id = row["created_object_id"]
    saved = client.put(
        f"/api/userfields/userobjects/{object_id}", headers=api_headers, json={"serial": "ABC123"}
    )
    assert saved.status_code == 204
    values = client.get(f"/api/userfields/userobjects/{object_id}", headers=api_headers)
    assert values.json() == {"serial": "ABC123"}
    updated = client.put(
        f"/api/userfields/userobjects/{object_id}", headers=api_headers, json={"serial": "XYZ789"}
    )
    assert updated.status_code == 204
    fetched = client.get(f"/api/objects/userobjects/{object_id}", headers=api_headers)
    assert fetched.json()["userfields"]["serial"] == "XYZ789"


def test_tare_weight_and_open_undo_preserve_stock(client: TestClient, api_headers: dict):
    updated = client.put(
        "/api/objects/products/2",
        headers=api_headers,
        json={"enable_tare_weight_handling": 1, "tare_weight": 100},
    )
    assert updated.status_code == 204
    bought = client.post("/api/stock/products/2/add", headers=api_headers, json={"amount": 1100})
    assert bought.json()[0]["amount"] == 1000
    consumed = client.post(
        "/api/stock/products/2/consume", headers=api_headers, json={"amount": 600}
    )
    assert consumed.json()[0]["amount"] == -500
    client.post(
        "/api/stock/products/1/add",
        headers=api_headers,
        json={"amount": 4, "best_before_date": "2027-01-01"},
    )
    opened = client.post(
        "/api/stock/products/1/open", headers=api_headers, json={"amount": 1}
    ).json()
    assert (
        client.post(f"/api/stock/bookings/{opened[0]['id']}/undo", headers=api_headers).status_code
        == 204
    )
    logs = client.get(
        "/api/objects/stock_log?query[]=product_id=1&query[]=transaction_type=purchase",
        headers=api_headers,
    ).json()
    assert (
        client.post(f"/api/stock/bookings/{logs[0]['id']}/undo", headers=api_headers).status_code
        == 204
    )
    # Grocy leaves the closed split after undo of its original purchase.
    assert client.get("/api/stock/products/1", headers=api_headers).json()["stock_amount"] == 3


def test_calculated_due_status_uses_each_users_settings(client: TestClient, api_headers: dict):
    from datetime import date, timedelta

    assert (
        client.post(
            "/api/stock/products/1/add",
            headers=api_headers,
            json={
                "amount": 2,
                "best_before_date": (date.today() + timedelta(days=3)).isoformat(),
            },
        ).status_code
        == 200
    )
    assert (
        client.put(
            "/api/v2/user/settings", headers=api_headers, json={"stock_due_soon_days": "1"}
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/users", headers=api_headers, json={"username": "Due status user", "password": ""}
        ).status_code
        == 204
    )
    user_id = next(
        user["id"]
        for user in client.get("/api/users", headers=api_headers).json()
        if user["username"] == "Due status user"
    )
    assert (
        client.put(
            f"/api/users/{user_id}/permissions", headers=api_headers, json={"permission_ids": [1]}
        ).status_code
        == 204
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": user_id}).json()[
        "api_key"
    ]
    other_headers = {"GROCY-API-KEY": key}
    assert (
        client.put(
            "/api/v2/user/settings", headers=other_headers, json={"stock_due_soon_days": "10"}
        ).status_code
        == 200
    )
    path = "/api/objects/recipes_pos_resolved?query[]=recipe_id=1&query[]=product_id=1"
    scores = [
        client.get(path, headers=headers).json()[0]["due_score"]
        for headers in (api_headers, other_headers, api_headers)
    ]
    assert scores == [0, 1, 0]
    assert client.delete("/api/v2/user/settings", headers=other_headers).status_code == 204
    assert client.get("/api/user/settings/stock_due_soon_days", headers=api_headers).json() == {
        "value": "1"
    }
    assert client.get("/api/user/settings/stock_due_soon_days", headers=other_headers).json() == {
        "value": 5
    }
