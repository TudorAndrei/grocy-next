"""Run state comparisons against a disposable Grocy v4.5.0 server."""

import os
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

REFERENCE_URL = os.getenv("GROCY_REFERENCE_URL")
pytestmark = pytest.mark.skipif(
    not REFERENCE_URL, reason="Set GROCY_REFERENCE_URL for PHP comparison"
)


@pytest.fixture
def reference():
    if os.getenv("GROCY_REFERENCE_DISPOSABLE") != "1":
        pytest.fail(
            "Reference tests require a disposable database. Set GROCY_REFERENCE_DISPOSABLE=1."
        )
    with httpx.Client(
        base_url=REFERENCE_URL or "",
        timeout=15,
        headers={
            "GROCY-API-KEY": os.environ["GROCY_REFERENCE_API_KEY"],
        },
    ) as client:
        info = client.get("/api/system/info")
        info.raise_for_status()
        assert info.json()["grocy_version"]["Version"].lstrip("v") == "4.5.0"
        yield client


def create(client, entity: str, body: dict) -> int:
    response = client.post(f"/api/objects/{entity}", json=body)
    assert response.status_code == 200, response.text
    return response.json()["created_object_id"]


def test_reference_stock_recipe_and_household_state(
    client: TestClient, api_headers: dict, reference
):
    client.headers.update(api_headers)
    snapshots = []
    name = f"Compatibility {uuid4().hex[:8]}"
    for app in (reference, client):
        unit = create(app, "quantity_units", {"name": name, "name_plural": name})
        location = create(app, "locations", {"name": name})
        product = create(
            app,
            "products",
            {"name": name, "location_id": location, "qu_id_purchase": unit, "qu_id_stock": unit},
        )
        base = f"/api/stock/products/{product}"
        bought = app.post(f"{base}/add", json={"amount": 5, "best_before_date": "2027-01-01"})
        assert bought.status_code == 200
        assert isinstance(bought.json(), list)
        assert app.post(f"{base}/consume", json={"amount": 2}).status_code == 200
        stock = app.get(base).json()["stock_amount"]
        recipe = create(app, "recipes", {"name": name, "base_servings": 1, "desired_servings": 1})
        create(
            app,
            "recipes_pos",
            {"recipe_id": recipe, "product_id": product, "amount": 1, "qu_id": unit},
        )
        fulfilled = app.get(f"/api/recipes/{recipe}/fulfillment").json()["need_fulfilled"]
        assert app.post(f"/api/recipes/{recipe}/consume").status_code == 204
        after_recipe = app.get(base).json()["stock_amount"]
        task = create(app, "tasks", {"name": name})
        assert app.post(f"/api/tasks/{task}/complete").status_code == 204
        done = app.get(f"/api/objects/tasks/{task}").json()["done"]
        assert app.post(f"/api/tasks/{task}/undo").status_code == 204
        undone = app.get(f"/api/objects/tasks/{task}").json()["done"]
        chore = create(
            app,
            "chores",
            {"name": name, "period_type": "manually", "assignment_type": "no-assignment"},
        )
        execution = app.post(
            f"/api/chores/{chore}/execute", json={"tracked_time": "2026-10-15 12:00:00"}
        )
        assert execution.status_code == 200
        assert app.post(f"/api/chores/executions/{execution.json()['id']}/undo").status_code == 204
        snapshots.append(
            (float(stock), bool(fulfilled), float(after_recipe), int(done), int(undone))
        )
    assert snapshots[0] == snapshots[1] == (3.0, True, 2.0, 1, 0)
