import pytest
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


@pytest.mark.parametrize(("first_price", "average"), [(2, 3), (2.25, 3.8)])
def test_purchase_history_keeps_dates_weighted_prices_and_undo(
    client: TestClient, api_headers: dict, first_price: float, average: float
):
    base = "/api/stock/products/1"
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
        result = client.post(f"{base}/add", headers=api_headers, json=body)
        assert result.status_code == 200
    details = client.get(base, headers=api_headers).json()
    assert details["last_purchased"] == "2027-01-10"
    assert details["last_price"] == first_price
    assert details["avg_price"] == average
    assert details["current_price"] == details["oldest_price"] == 10
    assert details["stock_value"] == 4 * first_price + 10
    assert details["average_shelf_life_days"] == 20.5
    history = client.get(f"{base}/price-history", headers=api_headers).json()
    assert [row["date"] for row in history] == ["2027-01-10", "2027-01-01"]
    average_row = client.get("/api/objects/products_average_price", headers=api_headers).json()[0]
    assert average_row["price"] == average
    assert (
        client.post(
            f"/api/stock/bookings/{result.json()[0]['id']}/undo", headers=api_headers
        ).status_code
        == 204
    )
    restored = client.get(base, headers=api_headers).json()
    assert restored["avg_price"] == restored["current_price"] == first_price
    assert restored["stock_value"] == 4 * first_price
