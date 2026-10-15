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
    status = client.get(f"/api/v2/recipes/{recipe['id']}/fulfillment", headers=api_headers).json()
    # Grocy checks each ingredient row independently for fulfillment.
    assert status["need_fulfilled"] is True
    assert status["positions"][0]["amount_needed"] == 1500
    consumed = client.post(f"/api/v2/recipes/{recipe['id']}/consume", headers=api_headers)
    assert consumed.status_code == 204
    logs = client.get(
        "/api/objects/stock_log?query[]=transaction_type=consume", headers=api_headers
    ).json()
    assert logs[0]["amount"] == -1200
    remaining = client.get(f"/api/stock/products/{oats['id']}", headers=api_headers).json()
    assert remaining["stock_amount"] == 0


def test_inventory_counts_the_product_across_locations(client: TestClient, api_headers: dict):
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
    assert sum(r["amount"] for r in rows) == 2


def test_transfer_undo_uses_grocy_defaults_and_preserves_price(
    client: TestClient, api_headers: dict
):
    store = client.post(
        "/api/objects/shopping_locations", headers=api_headers, json={"name": "Transfer store"}
    ).json()["created_object_id"]
    client.post(
        "/api/stock/products/1/add",
        headers=api_headers,
        json={
            "amount": 4,
            "location_id": 2,
            "price": 2.5,
            "best_before_date": "2027-01-01",
            "shopping_location_id": store,
            "note": "Keep this batch",
        },
    )
    client.post("/api/stock/products/1/open", headers=api_headers, json={"amount": 4})
    transfer = client.post(
        "/api/stock/products/1/transfer",
        headers=api_headers,
        json={
            "amount": 4,
            "location_id_from": 2,
            "location_id_to": 1,
        },
    ).json()[0]
    response = client.post(
        f"/api/stock/transactions/{transfer['transaction_id']}/undo", headers=api_headers
    )
    assert response.status_code == 204
    rows = client.get("/api/stock/products/1/entries", headers=api_headers).json()
    assert sum(r["amount"] for r in rows if r["location_id"] == 2 and not r["open"]) == 4
    assert all(r["price"] == 2.5 for r in rows)
    assert all(r["shopping_location_id"] is None and r["note"] == "Keep this batch" for r in rows)


def test_missing_ingredients_do_not_duplicate_shopping_quantities(
    client: TestClient, api_headers: dict
):
    path = "/api/recipes/1/add-not-fulfilled-products-to-shoppinglist"
    assert client.post(path, headers=api_headers, json={}).status_code == 204
    first = client.get("/api/v2/shopping-lists/1", headers=api_headers).json()["items"]
    assert client.post(path, headers=api_headers, json={}).status_code == 204
    second = client.get("/api/v2/shopping-lists/1", headers=api_headers).json()["items"]
    assert [(item["product_id"], item["amount"]) for item in second] == [
        (item["product_id"], item["amount"]) for item in first
    ]


def test_scaled_recipe_routes_keep_selected_servings_and_ingredient_details(client, api_headers):
    client.headers.update(api_headers)
    product = client.post(
        "/api/objects/products",
        json={"name": "Scaled oats", "location_id": 1, "qu_id_stock": 1, "qu_id_purchase": 1},
    ).json()["created_object_id"]
    recipe = client.post(
        "/api/v2/recipes",
        json={
            "name": "Scaled recipe",
            "base_servings": 2,
            "positions": [{"product_id": product, "amount": 4, "qu_id": 1}],
        },
    ).json()["id"]
    assert client.post(f"/api/stock/products/{product}/add", json={"amount": 3}).status_code == 200
    base = f"/api/v2/recipes/{recipe}"
    check = client.get(base + "/fulfillment", params={"servings": 3})
    assert check.status_code == 200, check.text
    assert check.json()["positions"] == [
        {
            "product_id": int(product),
            "amount_needed": 6,
            "amount_available": 3,
            "qu_id": 1,
            "fulfilled": False,
        }
    ]
    assert (
        client.post(
            "/api/users", json={"username": "Scaled reader", "password": "test"}
        ).status_code
        == 204
    )
    reader = client.get("/api/users", params={"query[]": "username=Scaled reader"}).json()[0]["id"]
    assert (
        client.put(f"/api/users/{reader}/permissions", json={"permissions": [9]}).status_code == 204
    )
    key = client.post("/api/v2/api-keys", json={"user_id": reader}).json()["api_key"]
    headers = {"GROCY-API-KEY": key}
    assert client.get(base + "/fulfillment?servings=3", headers=headers).status_code == 200
    for action in ["consume", "add-not-fulfilled-products-to-shoppinglist"]:
        denied = client.post(base + "/" + action + "?servings=3", json={}, headers=headers)
        assert denied.status_code == 403, denied.text
    assert client.get(f"/api/stock/products/{product}").json()["stock_amount"] == 3
    assert (
        client.get("/api/objects/shopping_list", params={"query[]": f"product_id={product}"}).json()
        == []
    )
    assert (
        client.put(
            f"/api/users/{reader}/permissions", json={"permissions": [9, 16, 21]}
        ).status_code
        == 204
    )
    missing = client.post(
        base + "/add-not-fulfilled-products-to-shoppinglist?servings=3", json={}, headers=headers
    )
    assert missing.status_code == 204, missing.text
    items = client.get("/api/objects/shopping_list", params={"query[]": f"product_id={product}"})
    assert len(items.json()) == 1 and items.json()[0]["amount"] == 3
    consumed = client.post(base + "/consume", params={"servings": 1}, headers=headers)
    assert consumed.status_code == 204 and consumed.content == b"", consumed.text
    assert client.get(f"/api/stock/products/{product}").json()["stock_amount"] == 1
