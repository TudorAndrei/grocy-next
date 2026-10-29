"""The transfer picker retains native product scope and saved conversion values."""

from sqlalchemy import text

from grocy.core.config import get_settings
from grocy.db.session import get_session_factory


def test_transfer_editor_catalog_keeps_aggregate_stock_inactive_sources_and_saved_units(
    client, api_headers
):
    path = "/api/v2/stock/transfer/editor"
    assert client.get(path).status_code == 401
    client.headers.update(api_headers)

    def create(entity, **values):
        response = client.post(f"/api/objects/{entity}", json=values)
        response.raise_for_status()
        return int(response.json()["created_object_id"])

    unit = create("quantity_units", name="Transfer piece", name_plural="Transfer pieces")
    box = create("quantity_units", name="Transfer box", name_plural="Transfer boxes")
    shelf = create("locations", name="Transfer shelf")
    freezer = create("locations", name="Transfer freezer", is_freezer=1)

    def product(name, **values):
        return create(
            "products",
            name=name,
            location_id=shelf,
            qu_id_stock=unit,
            qu_id_purchase=unit,
            qu_id_price=unit,
            **values,
        )

    parent = product("Transfer b parent")
    child = product("Transfer A child", parent_product_id=parent)
    tare = product("Transfer c tare", enable_tare_weight_handling=1, tare_weight=2)
    empty = product("Transfer empty")
    unavailable = product("Transfer inactive")
    aggregate_only = product("Transfer group", no_own_stock=1)
    group_child = product("Transfer d child", parent_product_id=aggregate_only)
    for identity in (child, tare, unavailable, group_child):
        client.post(
            f"/api/stock/products/{identity}/add",
            json={"amount": 5, "location_id": shelf},
        ).raise_for_status()
    for barcode in ("Transfer-01", "Transfer-02"):
        create("product_barcodes", product_id=child, barcode=barcode, amount=2, qu_id=box)
    create("product_barcodes", product_id=empty, barcode="Transfer-empty")
    create("product_barcodes", product_id=unavailable, barcode="Transfer-inactive")
    create("quantity_unit_conversions", product_id=child, from_qu_id=box, to_qu_id=unit, factor=6)
    client.put(f"/api/objects/products/{unavailable}", json={"active": 0}).raise_for_status()
    client.put(f"/api/objects/locations/{shelf}", json={"active": 0}).raise_for_status()
    client.put(f"/api/objects/quantity_units/{box}", json={"active": 0}).raise_for_status()

    async def retain_saved_cache():
        async with get_session_factory()() as session:
            await session.execute(
                text(
                    "UPDATE cache__quantity_unit_conversions_resolved SET factor=:factor,"
                    "to_qu_name='Saved box',to_qu_name_plural='Saved boxes' "
                    "WHERE product_id=:product AND from_qu_id=:unit AND to_qu_id=:box"
                ),
                {"factor": "0.123456789123456", "product": child, "unit": unit, "box": box},
            )
            await session.execute(
                text(
                    "INSERT INTO cache__quantity_unit_conversions_resolved "
                    "(from_qu_id,to_qu_id,factor) VALUES (:box,:unit,'0.125')"
                ),
                {"box": box, "unit": unit},
            )
            await session.commit()

    assert client.portal is not None
    client.portal.call(retain_saved_cache)
    response = client.get(path)
    assert response.status_code == 200, response.text
    view = response.json()
    selected = [row for row in view["products"] if row["name"].startswith("Transfer ")]
    # The native page includes parents with positive aggregate stock and tare products.
    assert [row["id"] for row in selected] == [child, parent, tare, group_child]
    assert selected[0] == {
        "id": child,
        "name": "Transfer A child",
        "qu_id_stock": unit,
        "qu_id_purchase": unit,
    }
    assert shelf not in {row["id"] for row in view["locations"]}
    assert {"id": freezer, "name": "Transfer freezer", "is_freezer": 1} in view["locations"]
    assert box not in {row["id"] for row in view["units"]}
    assert (
        next(row for row in view["units"] if row["id"] == unit)["name_plural"] == "Transfer pieces"
    )
    assert {"product_id": child, "barcodes": "Transfer-01,Transfer-02"} in view["barcodes"]
    assert {"product_id": empty, "barcodes": "Transfer-empty"} in view["barcodes"]
    assert unavailable not in {row["product_id"] for row in view["barcodes"]}
    saved = next(
        row
        for row in view["conversions"]
        if (row["product_id"], row["from_qu_id"], row["to_qu_id"]) == (child, unit, box)
    )
    assert saved["factor"] == "0.123456789123456"
    assert (saved["to_qu_name"], saved["to_qu_name_plural"]) == ("Saved box", "Saved boxes")
    assert any(
        row["product_id"] is None and row["factor"] == "0.125" for row in view["conversions"]
    )
    # The product location reader remains the source for inactive locations with stock.
    locations = client.get(f"/api/stock/products/{child}/locations")
    locations.raise_for_status()
    assert locations.json()[0]["location_id"] == shelf


def test_transfer_editor_allows_authenticated_readers_and_reports_their_own_permissions(
    client, api_headers, monkeypatch
):
    assert client.get("/api/v2/user/permissions").status_code == 401
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users",
        headers=api_headers,
        json={"username": "Transfer reader", "password": "secret"},
    ).raise_for_status()
    identity = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Transfer reader"
    )
    response = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": identity})
    response.raise_for_status()
    headers = {"GROCY-API-KEY": response.json()["api_key"]}
    assert client.get("/api/v2/stock/transfer/editor", headers=headers).status_code == 200
    assert client.get("/api/v2/stock/purchase/editor", headers=headers).status_code == 200
    permissions = client.get("/api/v2/user/permissions", headers=headers)
    permissions.raise_for_status()
    assert permissions.json()["STOCK_TRANSFER"] is False
    assert permissions.json()["ADMIN"] is False
    client.post(
        f"/api/users/{identity}/permissions", headers=api_headers, json={"permission_id": 18}
    ).raise_for_status()
    permissions = client.get("/api/v2/user/permissions", headers=headers).json()
    assert permissions["STOCK_TRANSFER"] is True
    assert permissions["STOCK"] is False
    assert permissions["STOCK_CONSUME"] is False
    assert client.get("/api/v2/stock/transfer/editor", headers=headers).status_code == 200
