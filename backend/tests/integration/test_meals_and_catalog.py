import pytest
from fastapi.testclient import TestClient


def test_meal_product_units_and_completion(client: TestClient, api_headers: dict):
    client.post("/api/stock/products/2/add", headers=api_headers, json={"amount": 2000})
    meal = client.post(
        "/api/objects/meal_plan",
        headers=api_headers,
        json={
            "day": "2027-01-01",
            "type": "product",
            "product_id": 2,
            "product_amount": 1,
            "product_qu_id": 3,
        },
    )
    assert meal.status_code == 200
    meal_id = meal.json()["created_object_id"]
    response = client.post(f"/api/v2/meal-plan/{meal_id}/consume", headers=api_headers)
    assert response.status_code == 200
    assert response.json()["done"] is True
    assert client.get("/api/stock/products/2", headers=api_headers).json()["stock_amount"] == 1000
    assert (
        client.post(f"/api/v2/meal-plan/{meal_id}/consume", headers=api_headers).status_code == 400
    )


def test_object_validation_filters_and_recipe_cycle(client: TestClient, api_headers: dict):
    bad = client.post(
        "/api/objects/products",
        headers=api_headers,
        json={
            "name": "Bad",
            "location_id": 1,
            "qu_id_purchase": 1,
            "qu_id_stock": 1,
            "due_type": 0,
        },
    )
    assert bad.status_code == 400
    assert (
        client.post("/api/objects/locations", headers=api_headers, json={"name": ""}).status_code
        == 200
    )
    rows = client.get(
        "/api/objects/products?query[]=name~milk&order=name:desc&limit=1", headers=api_headers
    ).json()
    assert len(rows) == 1
    assert rows[0]["name"] == "Whole Milk"
    second = client.post(
        "/api/objects/recipes", headers=api_headers, json={"name": "Second"}
    ).json()["created_object_id"]
    assert (
        client.post(
            "/api/objects/recipes_nestings",
            headers=api_headers,
            json={"recipe_id": 1, "includes_recipe_id": second},
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/objects/recipes_nestings",
            headers=api_headers,
            json={"recipe_id": second, "includes_recipe_id": 1},
        ).status_code
        == 400
    )


def test_print_output_and_equipment_roundtrip(client: TestClient, api_headers: dict):
    equipment = client.post(
        "/api/objects/equipment",
        headers=api_headers,
        json={
            "name": "Coffee maker",
            "instruction_manual_file_name": "manual.pdf",
        },
    )
    assert equipment.status_code == 200
    assert (
        client.get(
            f"/api/objects/equipment/{equipment.json()['created_object_id']}", headers=api_headers
        ).json()["name"]
        == "Coffee maker"
    )
    product = client.get("/api/stock/products/1/printlabel", headers=api_headers)
    assert product.status_code == 200
    assert product.json()["grocycode"] == "grcy:p:1"
    assert product.json()["product"] == "Greek Yogurt"


def test_label_parameters_override_fields_before_due_date(client, api_headers, monkeypatch):
    from grocy.core.config import get_settings

    client.headers.update(api_headers)
    response = client.post(
        "/api/stock/products/1/add", json={"amount": 1, "best_before_date": "2037-01-01"}
    )
    assert response.status_code == 200
    entry = client.get("/api/stock/products/1/entries").json()[0]
    monkeypatch.setattr(
        get_settings(),
        "label_printer_params",
        {
            "font_family": "Mono",
            "product": "Printer name",
            "grocycode": "custom-code",
            "due_date": "parameter",
        },
    )
    response = client.get(f"/api/stock/entry/{entry['id']}/printlabel")
    assert response.status_code == 200
    payload = response.json()
    assert payload["font_family"] == "Mono"
    assert payload["product"] == "Printer name"
    assert payload["grocycode"] == "custom-code"
    assert payload["due_date"] == "DD: 2037-01-01"
    monkeypatch.setattr(get_settings(), "feature_flag_stock_best_before_date_tracking", False)
    assert (
        client.get(f"/api/stock/entry/{entry['id']}/printlabel").json()["due_date"] == "parameter"
    )


@pytest.mark.parametrize("setting", ["thermal_printer_device", "tprinter_connector"])
def test_thermal_printer_device_receives_output(
    client: TestClient, api_headers: dict, tmp_path, monkeypatch, setting
):
    from grocy.core.config import get_settings

    device = tmp_path / "printer"
    monkeypatch.setattr(get_settings(), "thermal_printer_device", str(tmp_path / "legacy-device"))
    monkeypatch.setattr(get_settings(), setting, str(device))
    client.post(
        "/api/stock/shoppinglist/add-product",
        headers=api_headers,
        json={"product_id": 1, "product_amount": 2},
    )
    response = client.get("/api/print/shoppinglist/thermal?printHeader=false", headers=api_headers)
    assert response.status_code == 200
    assert response.json()["result"] == "OK"
    assert device.read_bytes() == b"\x1b@2 Pieces  Greek Yogurt\n\x1bd\x03\x1dVA\x03"
