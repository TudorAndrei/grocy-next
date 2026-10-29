"""The consume page retains child-stock products and disabled lookup rows."""

from sqlalchemy import text

from grocy.db.session import get_session_factory


def test_consume_editor_keeps_native_scope_order_and_saved_conversions(client, api_headers):
    path = "/api/v2/stock/consume/editor"
    assert client.get(path).status_code == 401
    client.headers.update(api_headers)

    def create(table, **values):
        response = client.post(f"/api/objects/{table}", json=values)
        response.raise_for_status()
        return int(response.json()["created_object_id"])

    unit = create("quantity_units", name="Consume piece", name_plural="Consume pieces")
    box = create("quantity_units", name="Consume box", name_plural="Consume boxes")
    shelf = create("locations", name="Consume shelf")
    freezer = create("locations", name="Consume freezer", is_freezer=1)

    def product(name, **values):
        return create(
            "products",
            name=name,
            location_id=shelf,
            qu_id_stock=unit,
            qu_id_purchase=unit,
            qu_id_consume=unit,
            qu_id_price=unit,
            **values,
        )

    parent = product("Consume a parent", no_own_stock=1)
    child = product("Consume B child", parent_product_id=parent)
    tare = product("Consume c tare", enable_tare_weight_handling=1, tare_weight=2)
    empty = product("Consume empty")
    inactive = product("Consume inactive")
    for identity in (child, tare, inactive):
        client.post(
            f"/api/stock/products/{identity}/add",
            json={"amount": 5, "location_id": shelf},
        ).raise_for_status()
    for identity, code in (
        (child, "Consume-01"),
        (empty, "Consume-empty"),
        (inactive, "Consume-inactive"),
    ):
        create("product_barcodes", product_id=identity, barcode=code)
    create("quantity_unit_conversions", product_id=child, from_qu_id=box, to_qu_id=unit, factor=6)
    for table, identity in (("products", inactive), ("locations", shelf), ("quantity_units", box)):
        client.put(f"/api/objects/{table}/{identity}", json={"active": 0}).raise_for_status()

    recipe_b = create("recipes", name="Consume b meal")
    recipe_a = create("recipes", name="Consume A meal")
    create("recipes", name="Consume special meal", type="special")

    async def retain_saved_cache():
        async with get_session_factory()() as session:
            await session.execute(
                text(
                    "UPDATE cache__quantity_unit_conversions_resolved "
                    "SET factor='0.123456789123456',to_qu_name='Saved box',"
                    "to_qu_name_plural='Saved boxes' "
                    "WHERE product_id=:product AND from_qu_id=:unit AND to_qu_id=:box"
                ),
                {"product": child, "unit": unit, "box": box},
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
    response.raise_for_status()
    view = response.json()
    products = [row for row in view["products"] if row["name"].startswith("Consume ")]
    # Unlike purchase, consume uses binary name order and includes no-own-stock parents.
    assert [row["id"] for row in products] == [child, parent, tare]
    assert products[0] == {
        "id": child,
        "name": "Consume B child",
        "qu_id_stock": unit,
        "qu_id_purchase": unit,
    }
    locations = [row for row in view["locations"] if row["name"].startswith("Consume ")]
    assert locations == [
        {"id": freezer, "name": "Consume freezer", "is_freezer": 1},
        {"id": shelf, "name": "Consume shelf", "is_freezer": 0},
    ]
    units = [row for row in view["units"] if row["name"].startswith("Consume ")]
    assert [(row["id"], row["name_plural"]) for row in units] == [
        (box, "Consume boxes"),
        (unit, "Consume pieces"),
    ]
    assert {"product_id": empty, "barcodes": "Consume-empty"} in view["barcodes"]
    assert inactive not in {row["product_id"] for row in view["barcodes"]}
    recipes = [row for row in view["recipes"] if row["name"].startswith("Consume ")]
    assert recipes == [
        {"id": recipe_a, "name": "Consume A meal"},
        {"id": recipe_b, "name": "Consume b meal"},
    ]
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
