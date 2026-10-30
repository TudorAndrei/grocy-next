"""Stock booking forms read the native product scope and saved lookup values."""

import pytest
from sqlalchemy import text

from grocy.db.session import get_session_factory


@pytest.mark.parametrize(
    ("operation", "inactive_unit_visible"), [("purchase", False), ("inventory", True)]
)
def test_booking_editor_keeps_native_choices_and_saved_conversions(
    client, api_headers, operation, inactive_unit_visible
):
    path = f"/api/v2/stock/{operation}/editor"
    assert client.get(path).status_code == 401
    client.headers.update(api_headers)

    def create(table, **values):
        response = client.post(f"/api/objects/{table}", json=values)
        response.raise_for_status()
        return int(response.json()["created_object_id"])

    unit = create("quantity_units", name="Purchase piece", name_plural="Purchase pieces")
    box = create("quantity_units", name="Purchase box", name_plural="Purchase boxes")
    shelf = create("locations", name="Purchase shelf")
    freezer = create("locations", name="Purchase freezer", is_freezer=1)
    store = create("shopping_locations", name="Purchase market")
    old_store = create("shopping_locations", name="Purchase old market")

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

    parent = product("Purchase b parent")
    child = product("Purchase A child", parent_product_id=parent)
    empty = product("Purchase empty")
    tare = product("Purchase c tare", enable_tare_weight_handling=1, tare_weight=2)
    group = product("Purchase group", no_own_stock=1)
    inactive = product("Purchase inactive")
    client.post(f"/api/stock/products/{child}/add", json={"amount": 5}).raise_for_status()
    for identity, code in (
        (child, "Purchase-01"),
        (empty, "Purchase-empty"),
        (group, "Purchase-group"),
        (inactive, "Purchase-inactive"),
    ):
        create("product_barcodes", product_id=identity, barcode=code)
    create("quantity_unit_conversions", product_id=child, from_qu_id=box, to_qu_id=unit, factor=6)
    for entity, identity in (
        ("products", inactive),
        ("locations", shelf),
        ("shopping_locations", old_store),
        ("quantity_units", box),
    ):
        client.put(f"/api/objects/{entity}/{identity}", json={"active": 0}).raise_for_status()

    field_z = create(
        "userfields",
        entity="stock",
        name="purchase_z",
        caption="Z batch",
        type="text-single-line",
        sort_number=1,
        input_required=1,
        default_value="Batch",
        config='{"placeholder": "Batch code"}',
    )
    field_a = create(
        "userfields",
        entity="stock",
        name="purchase_A",
        caption="A batch",
        type="text-single-line",
        sort_number=1,
    )
    field_first = create(
        "userfields",
        entity="stock",
        name="purchase_last_name",
        caption="First",
        type="text-single-line",
        sort_number=0,
    )
    create(
        "userfields",
        entity="products",
        name="purchase_other",
        caption="Other",
        type="text-single-line",
    )

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
    selected = [row for row in view["products"] if row["name"].startswith("Purchase ")]
    assert [row["id"] for row in selected] == [child, parent, tare, empty]
    assert selected[0] == {
        "id": child,
        "name": "Purchase A child",
        "qu_id_stock": unit,
        "qu_id_purchase": unit,
    }
    assert {"id": freezer, "name": "Purchase freezer", "is_freezer": 1} in view["locations"]
    assert shelf not in {row["id"] for row in view["locations"]}
    assert {"id": store, "name": "Purchase market"} in view["stores"]
    assert old_store not in {row["id"] for row in view["stores"]}
    assert (box in {row["id"] for row in view["units"]}) is inactive_unit_visible
    assert (
        next(row for row in view["units"] if row["id"] == unit)["name_plural"] == "Purchase pieces"
    )
    assert {"product_id": empty, "barcodes": "Purchase-empty"} in view["barcodes"]
    assert {"product_id": group, "barcodes": "Purchase-group"} in view["barcodes"]
    assert inactive not in {row["product_id"] for row in view["barcodes"]}
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
    fields = [row for row in view["fields"] if row["name"].startswith("purchase_")]
    assert [row["id"] for row in fields] == [field_first, field_a, field_z]
    assert fields[2] == {
        "id": field_z,
        "name": "purchase_z",
        "caption": "Z batch",
        "type": "text-single-line",
        "input_required": 1,
        "default_value": "Batch",
        "config": '{"placeholder": "Batch code"}',
    }
