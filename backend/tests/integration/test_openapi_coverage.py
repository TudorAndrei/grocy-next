import json
import re
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

CONTRACT = Path(__file__).resolve().parents[3] / "contracts" / "grocy.openapi.json"


def _norm(path: str) -> str:
    if path.startswith("/api"):
        path = path[4:]
    return re.sub(r"\{[^}]+\}", "{}", path)


def _spec_operations() -> set[tuple[str, str]]:
    spec = json.loads(CONTRACT.read_text())
    ops: set[tuple[str, str]] = set()
    for path, methods in spec["paths"].items():
        normalized = _norm(path if path.startswith("/") else f"/{path}")
        for method, _op in methods.items():
            if method in ("get", "post", "put", "delete", "patch"):
                ops.add((method.upper(), normalized))
    return ops


def _app_operations(client: TestClient) -> set[tuple[str, str]]:
    assert isinstance(client.app, FastAPI)
    paths = client.app.openapi()["paths"]
    ops: set[tuple[str, str]] = set()
    for path, methods in paths.items():
        if not path.startswith("/api/") or path.startswith("/api/v2") or path == "/api/health":
            continue
        normalized = _norm(path)
        for method in methods:
            if method in ("get", "post", "put", "delete", "patch"):
                ops.add((method.upper(), normalized))
    return ops


def test_all_grocy_openapi_operations_are_mounted(client: TestClient) -> None:
    missing = sorted(_spec_operations() - _app_operations(client))
    assert missing == [], f"Missing OpenAPI operations: {missing}"


def test_core_object_crud_roundtrip(client: TestClient, api_headers: dict[str, str]) -> None:
    created = client.post(
        "/api/objects/locations",
        headers=api_headers,
        json={"name": "Coverage Pantry", "description": "roundtrip"},
    )
    assert created.status_code == 200
    body = created.json()
    object_id = int(body["created_object_id"])

    listed = client.get("/api/objects/locations", headers=api_headers)
    assert listed.status_code == 200
    assert any(row["id"] == object_id for row in listed.json())

    updated = client.put(
        f"/api/objects/locations/{object_id}",
        headers=api_headers,
        json={"name": "Coverage Pantry Updated"},
    )
    assert updated.status_code == 204
    assert (
        client.get(f"/api/objects/locations/{object_id}", headers=api_headers).json()["name"]
        == "Coverage Pantry Updated"
    )

    deleted = client.delete(f"/api/objects/locations/{object_id}", headers=api_headers)
    assert deleted.status_code == 204


def test_system_and_user_surface(client: TestClient, api_headers: dict[str, str]) -> None:
    for path in (
        "/api/system/info",
        "/api/system/config",
        "/api/system/time",
        "/api/system/db-changed-time",
        "/api/system/localization-strings",
        "/api/user",
        "/api/user/settings",
        "/api/users",
        "/api/stock/volatile",
        "/api/calendar/ical",
    ):
        response = client.get(path, headers=api_headers)
        assert response.status_code == 200, path

    setting = client.put(
        "/api/user/settings/locale",
        headers=api_headers,
        json={"value": "en"},
    )
    assert setting.status_code in (200, 204)


def test_recipe_copy_and_task_undo(client: TestClient, api_headers: dict[str, str]) -> None:
    recipes = client.get("/api/objects/recipes", headers=api_headers)
    assert recipes.status_code == 200
    rows = recipes.json()
    if not rows:
        created = client.post(
            "/api/v2/recipes",
            headers=api_headers,
            json={"name": "Coverage Recipe", "base_servings": 1, "positions": []},
        )
        assert created.status_code == 200
        recipe_id = created.json()["id"]
    else:
        recipe_id = rows[0]["id"]

    copied = client.post(f"/api/recipes/{recipe_id}/copy", headers=api_headers)
    assert copied.status_code == 200
    assert copied.json()["created_object_id"] != recipe_id

    task = client.post(
        "/api/objects/tasks",
        headers=api_headers,
        json={"name": "Coverage task"},
    )
    assert task.status_code == 200
    task_id = task.json().get("created_object_id") or task.json()["id"]
    done = client.post(f"/api/tasks/{task_id}/complete", headers=api_headers, json={})
    assert done.status_code == 204
    undone = client.post(f"/api/tasks/{task_id}/undo", headers=api_headers)
    assert undone.status_code == 204
    assert client.get(f"/api/objects/tasks/{task_id}", headers=api_headers).json()["done"] == 0
