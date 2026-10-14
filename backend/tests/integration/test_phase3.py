from fastapi.testclient import TestClient


def test_quantity_unit_conversion_via_objects(
    client: TestClient,
    api_headers: dict[str, str],
) -> None:
    units = client.get("/api/objects/quantity_units", headers=api_headers).json()
    by_name = {u["name"]: u["id"] for u in units}
    conversions = client.get(
        "/api/objects/quantity_unit_conversions",
        headers=api_headers,
    ).json()
    assert any(
        c["from_qu_id"] == by_name["Kilogram"] and c["to_qu_id"] == by_name["Gram"]
        for c in conversions
    )


def test_stock_transfer_inventory_open_undo(
    client: TestClient,
    api_headers: dict[str, str],
) -> None:
    products = client.get("/api/objects/products", headers=api_headers).json()
    yogurt = next(p for p in products if p["name"] == "Greek Yogurt")
    locations = client.get("/api/objects/locations", headers=api_headers).json()
    fridge = next(loc for loc in locations if loc["name"] == "Fridge")
    pantry = next(loc for loc in locations if loc["name"] == "Pantry")

    purchased = client.post(
        f"/api/stock/products/{yogurt['id']}/add",
        headers=api_headers,
        json={"amount": 4, "location_id": fridge["id"]},
    )
    assert purchased.status_code == 200
    booking_id = purchased.json()[0]["id"]

    opened = client.post(
        f"/api/stock/products/{yogurt['id']}/open",
        headers=api_headers,
        json={"amount": 1},
    )
    assert opened.status_code == 200
    details = client.get(f"/api/stock/products/{yogurt['id']}", headers=api_headers).json()
    assert details["stock_amount"] == 4
    assert details["stock_amount_opened"] == 1

    transferred = client.post(
        f"/api/stock/products/{yogurt['id']}/transfer",
        headers=api_headers,
        json={
            "amount": 1,
            "location_id_from": fridge["id"],
            "location_id_to": pantry["id"],
        },
    )
    assert transferred.status_code == 200

    inventory = client.post(
        f"/api/stock/products/{yogurt['id']}/inventory",
        headers=api_headers,
        json={"new_amount": 2},
    )
    assert inventory.status_code == 200
    assert sum(row["amount"] for row in inventory.json()) == -2

    undone = client.post(
        f"/api/stock/bookings/{booking_id}/undo",
        headers=api_headers,
    )
    assert undone.status_code == 400


def test_recipe_fulfillment_and_consume(
    client: TestClient,
    api_headers: dict[str, str],
) -> None:
    recipes = client.get("/api/objects/recipes", headers=api_headers).json()
    assert recipes
    recipe = recipes[0]
    fulfillment = client.get(
        f"/api/recipes/{recipe['id']}/fulfillment",
        headers=api_headers,
    )
    assert fulfillment.status_code == 200
    assert fulfillment.json()["need_fulfilled"] is False

    catalog = client.get("/api/objects/products", headers=api_headers).json()
    products = {p["name"]: p for p in catalog}
    for name, amount in [("Greek Yogurt", 2), ("Rolled Oats", 200), ("Whole Milk", 500)]:
        resp = client.post(
            f"/api/stock/products/{products[name]['id']}/add",
            headers=api_headers,
            json={"amount": amount},
        )
        assert resp.status_code == 200

    fulfillment = client.get(
        f"/api/recipes/{recipe['id']}/fulfillment",
        headers=api_headers,
    ).json()
    assert fulfillment["need_fulfilled"] is True

    consumed = client.post(
        f"/api/recipes/{recipe['id']}/consume",
        headers=api_headers,
    )
    assert consumed.status_code == 204
    logs = client.get(
        "/api/objects/stock_log?query[]=transaction_type=consume", headers=api_headers
    ).json()
    assert len(logs) == 3


def test_household_chores_tasks_batteries(
    client: TestClient,
    api_headers: dict[str, str],
) -> None:
    chores = client.get("/api/chores", headers=api_headers).json()
    assert chores
    executed = client.post(
        f"/api/chores/{chores[0]['id']}/execute",
        headers=api_headers,
    )
    assert executed.status_code == 200
    undone = client.post(
        f"/api/chores/executions/{executed.json()['id']}/undo",
        headers=api_headers,
    )
    assert undone.status_code == 204

    tasks = client.get("/api/tasks", headers=api_headers).json()
    assert tasks
    completed = client.post(
        f"/api/tasks/{tasks[0]['id']}/complete",
        headers=api_headers,
    )
    assert completed.status_code == 204
    assert (
        client.get(f"/api/objects/tasks/{tasks[0]['id']}", headers=api_headers).json()["done"] == 1
    )

    batteries = client.get("/api/batteries", headers=api_headers).json()
    assert batteries
    charged = client.post(
        f"/api/batteries/{batteries[0]['id']}/charge",
        headers=api_headers,
    )
    assert charged.status_code == 200


def test_mcp_recipes_search(client: TestClient, api_headers: dict[str, str]) -> None:
    response = client.post(
        "/api/v2/mcp/call",
        headers=api_headers,
        json={"tool": "recipes_search", "arguments": {"query": "Yogurt"}},
    )
    assert response.status_code == 200
    assert response.json()
    assert response.json()[0]["name"] == "Yogurt Bowl"


def test_generic_entities_exposed(client: TestClient, api_headers: dict[str, str]) -> None:
    info = client.get("/api/system/info", headers=api_headers).json()
    for entity in [
        "products",
        "locations",
        "quantity_units",
        "recipes",
        "chores",
        "tasks",
        "batteries",
    ]:
        assert entity in info["exposed_entities"]
        response = client.get(f"/api/objects/{entity}", headers=api_headers)
        assert response.status_code == 200
        assert isinstance(response.json(), list)
