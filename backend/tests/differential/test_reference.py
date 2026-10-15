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
    return int(response.json()["created_object_id"])


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
        assert app.post(f"/api/tasks/{task}/complete", json={}).status_code == 204
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


def timestamp(value):
    from datetime import datetime

    return datetime.fromisoformat(value) if value else None


def test_reference_household_schedule_and_tracking(
    client: TestClient, api_headers: dict, reference
):
    client.headers.update(api_headers)
    snapshots = []
    name = f"Household {uuid4().hex[:8]}"
    for app in (reference, client):
        chore = create(
            app,
            "chores",
            {
                "name": name,
                "period_type": "weekly",
                "period_interval": 2,
                "period_config": "monday,thursday",
                "start_date": "2027-01-01 10:00:00",
                "track_date_only": 1,
                "rollover": 0,
                "assignment_type": "no-assignment",
            },
        )
        states = []
        for body in (
            {"tracked_time": "2027-01-04 15:00:00"},
            {"tracked_time": "2027-01-14 15:00:00", "skipped": True},
        ):
            result = app.post(f"/api/chores/{chore}/execute", json=body)
            assert result.status_code == 200, result.text
            details = app.get(f"/api/chores/{chore}").json()
            states.append(
                (
                    timestamp(result.json()["tracked_time"]),
                    timestamp(result.json()["scheduled_execution_time"]),
                    timestamp(details["last_tracked"]),
                    int(details["tracked_count"]),
                    timestamp(details["next_estimated_execution_time"]),
                )
            )
        assert app.post(f"/api/chores/executions/{result.json()['id']}/undo").status_code == 204
        states.append(
            timestamp(app.get(f"/api/chores/{chore}").json()["next_estimated_execution_time"])
        )
        response = app.put(f"/api/objects/chores/{chore}", json={"rescheduled_date": "2027-03-01"})
        assert response.status_code == 204, response.text
        states.append(
            timestamp(app.get(f"/api/chores/{chore}").json()["next_estimated_execution_time"])
        )
        battery = create(app, "batteries", {"name": name, "charge_interval_days": 7})
        states.append(app.get(f"/api/batteries/{battery}").json()["next_estimated_charge_time"])
        cycle = app.post(
            f"/api/batteries/{battery}/charge", json={"tracked_time": "2027-01-04 15:00:00"}
        )
        assert cycle.status_code == 200, cycle.text
        details = app.get(f"/api/batteries/{battery}").json()
        states.append(
            (
                timestamp(details["last_charged"]),
                int(details["charge_cycles_count"]),
                timestamp(details["next_estimated_charge_time"]),
            )
        )
        assert (
            app.post(f"/api/batteries/charge-cycles/{cycle.json()['id']}/undo").status_code == 204
        )
        states.append(int(app.get(f"/api/batteries/{battery}").json()["charge_cycles_count"]))
        category = create(app, "task_categories", {"name": name})
        task = create(
            app, "tasks", {"name": name, "category_id": category, "assigned_to_user_id": 1}
        )
        current = next(row for row in app.get("/api/tasks").json() if int(row["id"]) == task)
        states.append((int(current["assigned_to_user"]["id"]), current["category"]["name"]))
        assert (
            app.put(f"/api/objects/task_categories/{category}", json={"active": 0}).status_code
            == 204
        )
        states.append(
            next(row for row in app.get("/api/tasks").json() if int(row["id"]) == task)["category"]
        )
        completed = app.post(
            f"/api/tasks/{task}/complete", json={"done_time": "2027-01-04 15:00:00"}
        )
        assert completed.status_code == 204, completed.text
        states.append(timestamp(app.get(f"/api/objects/tasks/{task}").json()["done_timestamp"]))
        for entity, record_id, kind in (
            ("chores", chore, "chore"),
            ("batteries", battery, "battery"),
        ):
            label = app.get(f"/api/{entity}/{record_id}/printlabel")
            assert label.status_code == 200, label.text
            states.append((label.json()[kind], label.json()["details"][kind]["name"]))
        snapshots.append(states)
    assert snapshots[0] == snapshots[1]


@pytest.mark.parametrize("first_price", [2, 2.25])
def test_reference_purchase_prices_and_catalog_views(
    client: TestClient, api_headers: dict, reference, first_price
):
    client.headers.update(api_headers)
    name = f"Price comparison {uuid4().hex[:8]}"
    snapshots = []
    for app in (reference, client):
        unit = create(app, "quantity_units", {"name": name})
        location = create(app, "locations", {"name": name})
        store = create(app, "shopping_locations", {"name": name})
        product = create(
            app,
            "products",
            {"name": name, "location_id": location, "qu_id_purchase": unit, "qu_id_stock": unit},
        )
        base = f"/api/stock/products/{product}"
        for body in (
            {
                "amount": 4,
                "price": first_price,
                "purchased_date": "2027-01-10",
                "best_before_date": "2027-02-06",
            },
            {
                "amount": 1,
                "price": 10,
                "purchased_date": "2027-01-01",
                "best_before_date": "2027-01-15",
            },
        ):
            result = app.post(f"{base}/add", json={**body, "shopping_location_id": store})
            assert result.status_code == 200, result.text
        details = app.get(base).json()
        states: list[object] = [
            {
                key: details[key]
                for key in (
                    "last_purchased",
                    "last_price",
                    "avg_price",
                    "current_price",
                    "oldest_price",
                    "stock_value",
                    "average_shelf_life_days",
                )
            }
        ]
        history = app.get(f"{base}/price-history").json()
        states.append(
            [
                (row["date"], float(row["price"]), row["shopping_location"]["name"])
                for row in history
            ]
        )
        for entity, keys in (
            (
                "products_last_purchased",
                ("id", "amount", "best_before_date", "purchased_date", "price"),
            ),
            ("products_average_price", ("id", "price")),
            ("stock_current_locations", ("id", "amount", "location_name")),
        ):
            rows = app.get(
                f"/api/objects/{entity}", params={"query[]": f"product_id={product}"}
            ).json()
            states.append([{key: row[key] for key in keys} for row in rows])
        barcode = f"{uuid4().int % 1000000000000:012d}"
        create(app, "product_barcodes", {"product_id": product, "barcode": barcode, "qu_id": unit})
        rows = app.get(
            "/api/objects/product_barcodes_view", params={"query[]": f"product_id={product}"}
        ).json()
        states.append(
            sorted(
                "grocycode" if row["barcode"].startswith("grcy:p:") else "retail" for row in rows
            )
        )
        snapshots.append(states)
    assert snapshots[0] == snapshots[1]


def test_reference_stock_entry_edit_and_undo(client: TestClient, api_headers: dict, reference):
    client.headers.update(api_headers)
    name = f"Entry edit {uuid4().hex[:8]}"
    snapshots = []
    for app in (reference, client):
        unit = create(app, "quantity_units", {"name": name})
        location = create(app, "locations", {"name": name})
        product = create(
            app,
            "products",
            {"name": name, "location_id": location, "qu_id_stock": unit, "qu_id_purchase": unit},
        )
        base = f"/api/stock/products/{product}"
        assert (
            app.post(
                f"{base}/add",
                json={
                    "amount": 4,
                    "price": 2.5,
                    "purchased_date": "2027-01-01",
                    "best_before_date": "2027-02-01",
                    "note": "original",
                },
            ).status_code
            == 200
        )
        assert app.post(f"{base}/consume", json={"amount": 1}).status_code == 200
        entry = app.get(f"{base}/entries").json()[0]
        edited = app.put(
            f"/api/stock/entry/{entry['id']}",
            json={
                "amount": 5,
                "price": 3.25,
                "open": False,
                "purchased_date": "2027-01-04",
                "best_before_date": "2027-02-14",
                "location_id": location,
                "note": "corrected",
            },
        )
        assert edited.status_code == 200, edited.text
        states: list[object] = [
            [(row["transaction_type"], row["amount"], row["price"]) for row in edited.json()]
        ]
        for undo in (False, True):
            if undo:
                response = app.post(f"/api/stock/bookings/{edited.json()[0]['id']}/undo")
                assert response.status_code == 204, response.text
            details = app.get(base).json()
            rows = app.get(f"{base}/entries").json()
            states.append(
                (
                    details["stock_amount"],
                    details["avg_price"],
                    details["last_price"],
                    [
                        (row["amount"], row["price"], row["purchased_date"], row["note"])
                        for row in rows
                    ],
                )
            )
        snapshots.append(states)
    assert snapshots[0] == snapshots[1]


@pytest.mark.parametrize(
    "entity,fields",
    [
        (
            "products",
            {
                "due_type": 2,
                "default_best_before_days_after_freezing": 90,
                "default_best_before_days_after_thawing": 3,
                "calories": 120,
                "cumulate_min_stock_amount_of_sub_products": 1,
                "quick_consume_amount": 2.5,
                "quick_open_amount": 2,
                "hide_on_stock_overview": 1,
                "default_stock_label_type": 2,
                "disable_open": 1,
                "default_purchase_price_type": 2,
            },
        ),
        ("locations", {"active": 0}),
        ("quantity_units", {"active": 0, "plural_forms": "one;many"}),
        ("shopping_locations", {"active": 0}),
        ("product_groups", {"active": 0}),
        ("recipes", {"picture_file_name": "recipe.jpg", "not_check_shoppinglist": 1}),
        ("meal_plan_sections", {"time_info": "Breakfast"}),
        (
            "userfields",
            {
                "entity": "products",
                "caption": "Origin",
                "type": "text",
                "input_required": 1,
                "default_value": "Farm",
            },
        ),
    ],
)
def test_reference_catalog_options(
    client: TestClient, api_headers: dict, reference, entity, fields
):
    client.headers.update(api_headers)
    name = f"Catalog {uuid4().hex[:8]}"
    snapshots = []
    for app in (reference, client):
        body = {"name": name, **fields}
        if entity == "products":
            unit = create(app, "quantity_units", {"name": name})
            location = create(app, "locations", {"name": name})
            body.update(location_id=location, qu_id_purchase=unit, qu_id_stock=unit)
        record_id = create(app, entity, body)
        record = app.get(f"/api/objects/{entity}/{record_id}").json()
        snapshots.append({key: record[key] for key in fields})
        listed = app.get(f"/api/objects/{entity}").json()
        assert any(int(row["id"]) == record_id for row in listed)
    assert snapshots[0] == snapshots[1] == fields
