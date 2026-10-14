from fastapi.testclient import TestClient


def test_purchase_and_consume(client: TestClient, api_headers: dict[str, str]) -> None:
    products = client.get("/api/objects/products", headers=api_headers).json()
    product_id = products[0]["id"]

    purchased = client.post(
        f"/api/stock/products/{product_id}/add",
        headers=api_headers,
        json={"amount": 3},
    )
    assert purchased.status_code == 200

    details = client.get(f"/api/stock/products/{product_id}", headers=api_headers)
    assert details.status_code == 200
    assert details.json()["stock_amount"] == 3

    consumed = client.post(
        f"/api/stock/products/{product_id}/consume",
        headers=api_headers,
        json={"amount": 1},
    )
    assert consumed.status_code == 200

    details = client.get(f"/api/stock/products/{product_id}", headers=api_headers)
    assert details.json()["stock_amount"] == 2


def test_shopping_list_add(client: TestClient, api_headers: dict[str, str]) -> None:
    products = client.get("/api/objects/products", headers=api_headers).json()
    product_id = products[0]["id"]
    added = client.post(
        "/api/v2/shopping-lists/items",
        headers=api_headers,
        json={"product_id": product_id, "amount": 2},
    )
    assert added.status_code == 200
    listing = client.get("/api/v2/shopping-lists/1", headers=api_headers)
    assert listing.status_code == 200
    assert any(item["product_id"] == product_id for item in listing.json()["items"])
