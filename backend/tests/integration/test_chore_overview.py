from datetime import datetime, timedelta

from grocy.core.config import get_settings
from grocy.core.time import server_timezone


def test_chore_overview_reads_native_state_safe_names_and_canonical_due_setting(
    client, api_headers, monkeypatch
):
    assert client.get("/api/v2/chores/overview").status_code == 401
    client.headers.update(api_headers)
    client.put("/api/objects/chores/1", json={"active": 0}).raise_for_status()
    now = datetime.now(server_timezone())
    records = {}
    for name, period, start, active in [
        ("Past", "daily", "2000-01-01 00:00:00", 1),
        ("Soon", "daily", (now + timedelta(days=2)).strftime("%Y-%m-%d %H:%M:%S"), 1),
        ("Manual", "manually", None, 1),
        ("Hidden", "daily", "2000-01-01 00:00:00", 0),
    ]:
        response = client.post(
            "/api/objects/chores",
            json={
                "name": name,
                "period_type": period,
                "period_interval": 1,
                "start_date": start,
                "active": active,
                "description": "<strong>Room</strong>\nSecond line",
            },
        )
        response.raise_for_status()
        records[name] = int(response.json()["created_object_id"])
    client.post(
        "/api/objects/userfields",
        json={"entity": "chores", "name": "note", "caption": "Place", "type": "text-single-line"},
    ).raise_for_status()
    client.put(
        f"/api/userfields/chores/{records['Past']}", json={"note": "Kitchen"}
    ).raise_for_status()
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post("/api/users", json={"username": "Viewer", "password": ""}).raise_for_status()
    viewer = next(
        row["id"] for row in client.get("/api/users").json() if row["username"] == "Viewer"
    )
    key = client.post("/api/v2/api-keys", json={"user_id": viewer}).json()["api_key"]
    headers = {"GROCY-API-KEY": key}
    assert client.get("/api/users", headers=headers).status_code == 403
    # The native page is authenticated-only, even when the viewer has no domain grants.
    view = client.get("/api/v2/chores/overview", headers=headers)
    view.raise_for_status()
    payload = view.json()
    assert payload["current_user_id"] == viewer
    assert payload["next_x_days"] == 5
    assert payload["users"] == [
        {"id": 1, "username": "admin", "display_name": "Admin User"},
        {"id": viewer, "username": "Viewer", "display_name": "Viewer"},
    ]
    rows = {row["name"]: row for row in payload["rows"]}
    assert set(rows) == {"Past", "Soon", "Manual"}
    assert rows["Past"]["due_type"] == "overdue"
    assert rows["Past"]["custom_values"] == {"note": "Kitchen"}
    assert rows["Soon"]["due_type"] == "duesoon"
    assert rows["Manual"]["due_type"] == ""
    assert rows["Manual"]["next_estimated_execution_time"] is None
    client.put(
        "/api/user/settings/ chores_due_soon_days", headers=headers, json={"value": 0}
    ).raise_for_status()
    assert client.get("/api/v2/chores/overview", headers=headers).json()["next_x_days"] == 5
    client.put(
        "/api/user/settings/chores_due_soon_days", headers=headers, json={"value": 0}
    ).raise_for_status()
    updated = client.get("/api/v2/chores/overview", headers=headers).json()
    assert updated["next_x_days"] == 0
    assert next(row for row in updated["rows"] if row["name"] == "Soon")["due_type"] == ""
    execution = client.post(
        f"/api/chores/{records['Past']}/execute", json={"tracked_time": "2020-01-02 03:04:05"}
    )
    execution.raise_for_status()
    fresh = client.get("/api/v2/chores/overview", headers=headers).json()
    past = next(row for row in fresh["rows"] if row["name"] == "Past")
    assert past["last_tracked_time"] == "2020-01-02 03:04:05"
    assert past["next_estimated_execution_time"] == "2020-01-03 00:00:00"
    assert past["custom_values"] == {"note": "Kitchen"}
    card = client.get(f"/api/v2/chores/{records['Past']}/card", headers=headers)
    card.raise_for_status()
    assert card.json()["tracked_count"] == 1
    assert "<strong>Room</strong>" in card.json()["description_html"]
    assert "<br>" in card.json()["description_html"]
    path = f"/api/objects/chores/{records['Past']}"
    client.put(
        path,
        json={
            "rescheduled_date": "2099-01-02 03:04:05",
            "rescheduled_next_execution_assigned_to_user_id": viewer,
        },
    ).raise_for_status()
    client.post(
        "/api/chores/executions/calculate-next-assignments", json={"chore_id": records["Past"]}
    ).raise_for_status()
    rescheduled = next(
        row
        for row in client.get("/api/v2/chores/overview", headers=headers).json()["rows"]
        if row["name"] == "Past"
    )
    assert rescheduled["next_estimated_execution_time"] == "2099-01-02 03:04:05"
    assert rescheduled["next_execution_assigned_to_user_id"] == viewer
    assert rescheduled["is_rescheduled"] == 1
    assert rescheduled["is_reassigned"] == 1
    client.put(
        path,
        json={"rescheduled_date": None, "rescheduled_next_execution_assigned_to_user_id": None},
    ).raise_for_status()
    client.post(
        "/api/chores/executions/calculate-next-assignments", json={"chore_id": records["Past"]}
    ).raise_for_status()
    reset = next(
        row
        for row in client.get("/api/v2/chores/overview", headers=headers).json()["rows"]
        if row["name"] == "Past"
    )
    assert reset["next_estimated_execution_time"] == "2020-01-03 00:00:00"
    assert reset["is_rescheduled"] == 0
    assert reset["is_reassigned"] == 0
