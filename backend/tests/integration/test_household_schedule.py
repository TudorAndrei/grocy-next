from fastapi.testclient import TestClient


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
