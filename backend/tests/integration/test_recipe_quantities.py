from fastapi.testclient import TestClient


def test_recipe_units_duplicates_and_partial_consumption(client: TestClient, api_headers: dict):
    products = client.get("/api/objects/products", headers=api_headers).json()
    oats = next(p for p in products if p["name"] == "Rolled Oats")
    units = client.get("/api/objects/quantity_units", headers=api_headers).json()
    kg = next(u["id"] for u in units if u["name"] == "Kilogram")
    gram = next(u["id"] for u in units if u["name"] == "Gram")
    recipe = client.post(
        "/api/v2/recipes",
        headers=api_headers,
        json={
            "name": "Large oats bowl",
            "positions": [
                {"product_id": oats["id"], "amount": 1, "qu_id": kg},
                {"product_id": oats["id"], "amount": 500, "qu_id": gram},
            ],
        },
    ).json()
    client.post(f"/api/stock/products/{oats['id']}/add", headers=api_headers, json={"amount": 1200})
    status = client.get(f"/api/recipes/{recipe['id']}/fulfillment", headers=api_headers).json()
    assert status["need_fulfilled"] is False
    assert status["positions"][0]["amount_needed"] == 1500
    consumed = client.post(f"/api/recipes/{recipe['id']}/consume", headers=api_headers)
    assert consumed.status_code == 204
    logs = client.get(
        "/api/objects/stock_log?query[]=transaction_type=consume", headers=api_headers
    ).json()
    assert logs[0]["amount"] == -1200
    remaining = client.get(f"/api/stock/products/{oats['id']}", headers=api_headers).json()
    assert remaining["stock_amount"] == 0


def test_inventory_at_one_location_preserves_other_stock(client: TestClient, api_headers: dict):
    client.post(
        "/api/stock/products/1/add", headers=api_headers, json={"amount": 5, "location_id": 1}
    )
    client.post(
        "/api/stock/products/1/add", headers=api_headers, json={"amount": 3, "location_id": 2}
    )
    response = client.post(
        "/api/stock/products/1/inventory",
        headers=api_headers,
        json={"new_amount": 2, "location_id": 1},
    )
    assert response.status_code == 200
    rows = client.get("/api/stock/products/1/entries", headers=api_headers).json()
    assert sum(r["amount"] for r in rows if r["location_id"] == 1) == 2
    assert sum(r["amount"] for r in rows if r["location_id"] == 2) == 3


def test_transfer_undo_restores_open_and_price(client: TestClient, api_headers: dict):
    client.post(
        "/api/stock/products/1/add",
        headers=api_headers,
        json={"amount": 4, "location_id": 1, "price": 2.5, "best_before_date": "2027-01-01"},
    )
    client.post("/api/stock/products/1/open", headers=api_headers, json={"amount": 4})
    transfer = client.post(
        "/api/stock/products/1/transfer",
        headers=api_headers,
        json={
            "amount": 2,
            "location_id_from": 1,
            "location_id_to": 2,
        },
    ).json()[0]
    response = client.post(
        f"/api/stock/transactions/{transfer['transaction_id']}/undo", headers=api_headers
    )
    assert response.status_code == 204
    rows = client.get("/api/stock/products/1/entries", headers=api_headers).json()
    assert sum(r["amount"] for r in rows if r["location_id"] == 1 and r["open"]) == 4
    assert all(r["price"] == 2.5 for r in rows)


def test_missing_ingredients_do_not_duplicate_shopping_quantities(
    client: TestClient, api_headers: dict
):
    path = "/api/recipes/1/add-not-fulfilled-products-to-shoppinglist"
    assert client.post(path, headers=api_headers).status_code == 204
    first = client.get("/api/v2/shopping-lists/1", headers=api_headers).json()["items"]
    assert client.post(path, headers=api_headers).status_code == 204
    second = client.get("/api/v2/shopping-lists/1", headers=api_headers).json()["items"]
    assert [(item["product_id"], item["amount"]) for item in second] == [
        (item["product_id"], item["amount"]) for item in first
    ]
