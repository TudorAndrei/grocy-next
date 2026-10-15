import json
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

GOLDENS = json.loads(
    (Path(__file__).parents[1] / "fixtures/household-grocy-4.5.0.json").read_text()
)


@pytest.mark.parametrize("case", GOLDENS["cases"], ids=lambda case: case["name"])
def test_chore_schedule_matches_pinned_grocy_view(client: TestClient, api_headers: dict, case):
    created = client.post("/api/objects/chores", headers=api_headers, json=case["chore"])
    assert created.status_code == 200, created.text
    chore_id = created.json()["created_object_id"]
    for tracked_time in case["tracked_times"]:
        recorded = client.post(
            f"/api/chores/{chore_id}/execute",
            headers=api_headers,
            json={"tracked_time": tracked_time},
        )
        assert recorded.status_code == 200, recorded.text
    details = client.get(f"/api/chores/{chore_id}", headers=api_headers)
    assert details.status_code == 200
    actual = details.json()["next_estimated_execution_time"]
    expected = case["next_execution"]
    if expected.startswith("TODAY"):
        expected = datetime.now().date().isoformat() + expected[5:]
    assert datetime.fromisoformat(actual) == datetime.fromisoformat(expected)


def test_execution_records_actor_date_and_rotates_assignments(
    client: TestClient, api_headers: dict
):
    assert (
        client.post(
            "/api/users",
            headers=api_headers,
            json={
                "username": "second",
                "password": "",
                "first_name": "Zoe",
            },
        ).status_code
        == 204
    )
    user_id = next(
        user["id"]
        for user in client.get("/api/users", headers=api_headers).json()
        if user["username"] == "second"
    )
    chore = client.post(
        "/api/objects/chores",
        headers=api_headers,
        json={
            "name": "Assigned clean",
            "period_type": "daily",
            "period_interval": 2,
            "track_date_only": 1,
            "assignment_type": "in-alphabetical-order",
            "assignment_config": f"1,{user_id}",
            "start_date": "2027-01-01 10:00:00",
        },
    ).json()["created_object_id"]
    recorded = client.post(
        f"/api/chores/{chore}/execute",
        headers=api_headers,
        json={
            "tracked_time": "2027-01-04 16:20:00",
            "done_by": user_id,
        },
    )
    assert recorded.status_code == 200
    assert recorded.json()["tracked_time"] == "2027-01-04 00:00:00"
    assert recorded.json()["done_by_user_id"] == user_id
    details = client.get(f"/api/chores/{chore}", headers=api_headers).json()
    assert details["tracked_count"] == 1
    assert details["last_done_by"]["id"] == user_id
    assert details["next_execution_assigned_user"]["id"] == 1
    skipped = client.post(
        f"/api/chores/{chore}/execute",
        headers=api_headers,
        json={
            "tracked_time": "2027-01-06 16:20:00",
            "skipped": True,
        },
    )
    assert skipped.status_code == 200
    details = client.get(f"/api/chores/{chore}", headers=api_headers).json()
    assert details["tracked_count"] == 1
    assert details["next_estimated_execution_time"] == "2027-01-08 23:59:59"
    assert (
        client.post(
            f"/api/chores/executions/{skipped.json()['id']}/undo", headers=api_headers
        ).status_code
        == 204
    )
    assert (
        client.get(f"/api/chores/{chore}", headers=api_headers).json()[
            "next_estimated_execution_time"
        ]
        == "2027-01-06 23:59:59"
    )
