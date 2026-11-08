from datetime import datetime
from types import SimpleNamespace

import pytest

from grocy.api.v2 import battery_overview
from grocy.core.config import get_settings


@pytest.fixture
def batteries(client, api_headers, monkeypatch):
    client.headers.update(api_headers)
    monkeypatch.setattr(
        battery_overview,
        "datetime",
        SimpleNamespace(now=lambda tz: datetime(2026, 11, 6, 12, tzinfo=tz)),
    )
    client.put("/api/objects/batteries/1", json={"active": 0}).raise_for_status()
    ids = {}
    for name, interval, tracked, active in [
        ("Overdue", 1, "2026-11-04 12:00:00", 1),
        ("Today", 1, "2026-11-05 15:00:00", 1),
        ("Soon", 5, "2026-11-04 12:00:00", 1),
        ("Idle", 0, None, 1),
        ("Untracked", 1, None, 1),
        ("Inactive", 1, "2026-11-04 12:00:00", 0),
    ]:
        created = client.post(
            "/api/objects/batteries",
            json={
                "name": name,
                "used_in": name + " device",
                "charge_interval_days": interval,
                "active": active,
            },
        )
        created.raise_for_status()
        identity = created.json()["created_object_id"]
        ids[name] = int(identity)
        if tracked:
            client.post(
                f"/api/batteries/{identity}/charge", json={"tracked_time": tracked}
            ).raise_for_status()
    client.post(
        "/api/objects/userfields",
        json={"entity": "batteries", "name": "note", "caption": "Note", "type": "text"},
    ).raise_for_status()
    client.put(
        f"/api/userfields/batteries/{ids['Today']}", json={"note": "Keep ready"}
    ).raise_for_status()
    return ids


def test_battery_overview_projects_native_due_states_and_custom_fields(client, batteries):
    response = client.get("/api/v2/batteries/overview")
    response.raise_for_status()
    data = response.json()
    assert data["next_x_days"] == 5
    rows = {row["name"]: row for row in data["rows"]}
    assert set(rows) == {"Overdue", "Today", "Soon", "Idle", "Untracked"}
    assert {name: row["due_type"] for name, row in rows.items()} == {
        "Overdue": "overdue",
        "Today": "duetoday",
        "Soon": "duesoon",
        "Idle": "",
        # PHP compares the untracked NULL date as an empty string in the controller.
        "Untracked": "overdue",
    }
    assert rows["Today"]["id"] == batteries["Today"]
    assert rows["Today"]["used_in"] == "Today device"
    assert rows["Today"]["last_tracked_time"] == "2026-11-05 15:00:00"
    assert rows["Today"]["next_estimated_charge_time"] == "2026-11-06 15:00:00"
    assert rows["Today"]["custom_values"] == {"note": "Keep ready"}
    assert rows["Idle"]["next_estimated_charge_time"] == "2999-12-31 23:59:59"
    assert rows["Untracked"]["next_estimated_charge_time"] is None


def test_battery_overview_reads_canonical_due_soon_setting_not_native_alias(client, batteries):
    client.put(
        "/api/user/settings/%20batteries_due_soon_days", json={"value": 0}
    ).raise_for_status()
    assert client.get("/api/v2/batteries/overview").json()["next_x_days"] == 5
    client.put("/api/user/settings/batteries_due_soon_days", json={"value": 0}).raise_for_status()
    data = client.get("/api/v2/batteries/overview").json()
    assert data["next_x_days"] == 0
    assert next(row for row in data["rows"] if row["name"] == "Soon")["due_type"] == ""
    assert next(row for row in data["rows"] if row["name"] == "Today")["due_type"] == "duetoday"


def test_battery_overview_reflects_existing_native_charge_and_undo_storage(client, batteries):
    identity = batteries["Today"]
    saved = client.post(
        f"/api/batteries/{identity}/charge", json={"tracked_time": "2026-11-06 12:00:00"}
    )
    saved.raise_for_status()
    row = next(
        row
        for row in client.get("/api/v2/batteries/overview").json()["rows"]
        if row["id"] == identity
    )
    assert row["last_tracked_time"] == "2026-11-06 12:00:00"
    assert row["next_estimated_charge_time"] == "2026-11-07 12:00:00"
    client.post(
        f"/api/batteries/charge-cycles/{saved.json()['id']}/undo", json={}
    ).raise_for_status()
    row = next(
        row
        for row in client.get("/api/v2/batteries/overview").json()["rows"]
        if row["id"] == identity
    )
    assert row["last_tracked_time"] == "2026-11-05 15:00:00"
    assert row["custom_values"] == {"note": "Keep ready"}


def test_battery_overview_matches_native_authenticated_read_without_write_permission(
    client, api_headers, monkeypatch
):
    path = "/api/v2/batteries/overview"
    assert client.get(path).status_code == 401
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users", headers=api_headers, json={"username": "Overview reader", "password": ""}
    ).raise_for_status()
    identity = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Overview reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": identity}).json()[
        "api_key"
    ]
    headers = {"GROCY-API-KEY": key}
    assert client.get(path, headers=headers).status_code == 200
    assert client.post("/api/batteries/1/charge", headers=headers, json={}).status_code == 403
