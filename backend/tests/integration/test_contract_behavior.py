import json
from pathlib import Path

from fastapi.testclient import TestClient

CONTRACT = Path(__file__).resolve().parents[3] / "contracts" / "grocy.openapi.json"


def test_contract_entities_and_derived_records(client: TestClient, api_headers: dict):
    spec = json.loads(CONTRACT.read_text())
    entities = spec["components"]["schemas"]["ExposedEntity"]["enum"]
    for entity in entities:
        response = client.get(f"/api/objects/{entity}", headers=api_headers)
        assert response.status_code == 200, entity
        assert isinstance(response.json(), list), entity
    bought = client.post(
        "/api/stock/products/1/add",
        headers=api_headers,
        json={"amount": 3, "price": 2, "note": "weekly shop"},
    )
    assert bought.status_code == 200
    assert isinstance(bought.json(), list)
    assert bought.json()[0]["note"] == "weekly shop"
    details = client.get("/api/stock/products/1", headers=api_headers).json()
    assert details["product"]["name"] == "Greek Yogurt"
    assert details["quantity_unit_stock"]["name"] == "Piece"
    assert details["last_price"] == 2
    average = client.get("/api/objects/products_average_price", headers=api_headers).json()
    assert average[0]["avg_price"] == 2
    booking = bought.json()[0]["id"]
    assert (
        client.post(f"/api/stock/bookings/{booking}/undo", headers=api_headers).status_code == 204
    )
    assert client.get("/api/stock/products/1", headers=api_headers).json()["stock_amount"] == 0


def test_custom_fields_and_records_roundtrip(client: TestClient, api_headers: dict):
    entity = client.post(
        "/api/objects/userentities",
        headers=api_headers,
        json={"name": "warranties", "caption": "Warranties"},
    ).json()
    definition = client.post(
        "/api/objects/userfields",
        headers=api_headers,
        json={
            "entity": "userobjects",
            "name": "serial",
            "caption": "Serial number",
            "type": "text",
        },
    )
    assert definition.status_code == 200
    row = client.post(
        "/api/objects/userobjects",
        headers=api_headers,
        json={
            "userentity_id": entity["id"],
            "userfields": {"serial": "ABC123"},
        },
    ).json()
    values = client.get(f"/api/userfields/userobjects/{row['id']}", headers=api_headers)
    assert values.json() == {"serial": "ABC123"}
    updated = client.put(
        f"/api/userfields/userobjects/{row['id']}", headers=api_headers, json={"serial": "XYZ789"}
    )
    assert updated.status_code == 204
    fetched = client.get(f"/api/objects/userobjects/{row['id']}", headers=api_headers)
    assert fetched.json()["userfields"]["serial"] == "XYZ789"


def test_tare_weight_and_open_undo_preserve_stock(client: TestClient, api_headers: dict):
    updated = client.put(
        "/api/objects/products/2",
        headers=api_headers,
        json={"enable_tare_weight_handling": 1, "tare_weight": 100},
    )
    assert updated.status_code == 204
    bought = client.post("/api/stock/products/2/add", headers=api_headers, json={"amount": 1100})
    assert bought.json()[0]["amount"] == 1000
    consumed = client.post(
        "/api/stock/products/2/consume", headers=api_headers, json={"amount": 600}
    )
    assert consumed.json()[0]["amount"] == -500
    client.post(
        "/api/stock/products/1/add",
        headers=api_headers,
        json={"amount": 4, "best_before_date": "2027-01-01"},
    )
    opened = client.post(
        "/api/stock/products/1/open", headers=api_headers, json={"amount": 1}
    ).json()
    assert (
        client.post(f"/api/stock/bookings/{opened[0]['id']}/undo", headers=api_headers).status_code
        == 204
    )
    logs = client.get(
        "/api/objects/stock_log?query[]=product_id=1&query[]=transaction_type=purchase",
        headers=api_headers,
    ).json()
    assert (
        client.post(f"/api/stock/bookings/{logs[0]['id']}/undo", headers=api_headers).status_code
        == 204
    )
    assert client.get("/api/stock/products/1", headers=api_headers).json()["stock_amount"] == 0
