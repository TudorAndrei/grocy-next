"""Native ProductEditForm owns its selected row and source-ordered references."""

from urllib.parse import quote

import pytest
from sqlalchemy import text

from grocy.core.config import get_settings
from grocy.db.session import get_session_factory


def create(client, headers, table, **values):
    response = client.post(f"/api/objects/{table}", headers=headers, json=values)
    response.raise_for_status()
    return int(response.json()["created_object_id"])


def context(client, headers, row="new", prefix=""):
    response = client.get(
        prefix + "/api/v2/products/native-editor?row=" + quote(row, safe=""), headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()


def execute(client, sql, **parameters):
    async def write():
        async with get_session_factory()() as session:
            await session.execute(text(sql), parameters)
            await session.commit()

    client.portal.call(write)


def test_native_context_reference_rows_match_history_restrictions_and_source_order(
    client, api_headers
):
    lower = create(client, api_headers, "locations", name="a native form shelf")
    upper = create(client, api_headers, "locations", name="Z native form shelf")
    hidden_location = create(client, api_headers, "locations", name="Hidden form shelf", active=0)
    store = create(client, api_headers, "shopping_locations", name="Native form shop")
    hidden_store = create(
        client, api_headers, "shopping_locations", name="Hidden form shop", active=0
    )
    group = create(client, api_headers, "product_groups", name="Native form group")
    hidden_group = create(client, api_headers, "product_groups", name="Hidden form group", active=0)
    linked = create(client, api_headers, "quantity_units", name="Native linked inactive", active=0)
    dormant = create(
        client, api_headers, "quantity_units", name="Native unrelated inactive", active=0
    )
    unrelated = create(client, api_headers, "quantity_units", name="Native unrelated active")
    product = create(
        client,
        api_headers,
        "products",
        name="Native form coffee",
        location_id=lower,
        qu_id_stock=1,
        qu_id_purchase=1,
    )
    parent = create(
        client,
        api_headers,
        "products",
        name="Native form parent",
        location_id=1,
        qu_id_stock=1,
        qu_id_purchase=1,
    )
    inactive_parent = create(
        client,
        api_headers,
        "products",
        name="Inactive form parent",
        location_id=1,
        qu_id_stock=1,
        qu_id_purchase=1,
        active=0,
    )
    child = create(
        client,
        api_headers,
        "products",
        name="Inactive form child",
        location_id=1,
        qu_id_stock=1,
        qu_id_purchase=1,
        parent_product_id=product,
        active=0,
    )
    create(
        client,
        api_headers,
        "quantity_unit_conversions",
        product_id=product,
        from_qu_id=linked,
        to_qu_id=1,
        factor=2,
    )

    new = context(client, api_headers)
    edit = context(client, api_headers, str(product))
    assert new["mode"] == "create" and new["product"] is None
    assert edit["mode"] == "edit" and edit["product"]["id"] == product
    assert not new["options"]["parent_disabled"] and edit["options"]["parent_disabled"]
    assert new["options"]["references"]["location_id"].index(upper) < new["options"]["references"][
        "location_id"
    ].index(lower)
    assert edit["options"]["references"]["location_id"].index(lower) < edit["options"][
        "references"
    ]["location_id"].index(upper)
    assert {linked, dormant, unrelated} <= set(edit["options"]["references"]["qu_id_stock"])
    assert linked not in edit["options"]["references"]["qu_id_purchase"]
    assert unrelated not in edit["options"]["references"]["qu_id_purchase"]
    assert parent in edit["options"]["references"]["parent_product_id"]
    assert not {product, inactive_parent, child} & set(
        edit["options"]["references"]["parent_product_id"]
    )
    for key, visible, hidden in [
        ("locations", lower, hidden_location),
        ("shopping_locations", store, hidden_store),
        ("product_groups", group, hidden_group),
    ]:
        rows = edit["references"][key]
        assert visible in [row["id"] for row in rows]
        assert hidden not in [row["id"] for row in rows]
        assert "active" in next(row for row in rows if row["id"] == visible)
    assert set(edit["options"]["references"]["location_id"]) == {
        row["id"] for row in edit["references"]["locations"]
    }

    purchase = client.post(
        f"/api/stock/products/{product}/add", headers=api_headers, json={"amount": 2}
    ).json()[0]
    client.post(
        f"/api/stock/bookings/{purchase['id']}/undo", headers=api_headers
    ).raise_for_status()
    used = context(client, api_headers, str(product))
    assert set(used["options"]["references"]["qu_id_stock"]) == {1, linked}
    assert linked in [row["id"] for row in used["references"]["quantity_units"]]
    assert unrelated in [row["id"] for row in used["references"]["quantity_units"]]
    assert dormant not in [row["id"] for row in used["references"]["quantity_units"]]
    assert used["options"]["references"]["qu_id_purchase"] == [1]
    # The native context preserves the saved cache's row sequence and raw factors.
    assert [(row["from_qu_id"], row["to_qu_id"]) for row in used["options"]["conversions"]] == [
        (1, 1),
        (1, linked),
        (linked, 1),
    ]
    assert float(used["options"]["conversions"][-1]["factor"]) == 2
    assert (
        client.get(f"/api/stock/products/{product}", headers=api_headers).json()["stock_amount"]
        == 0
    )


def test_native_raw_product_aliases_use_canonical_userfield_identity(client, api_headers):
    product = create(
        client,
        api_headers,
        "products",
        name="Native raw coffee",
        description="<strong>Raw</strong>",
        location_id=1,
        qu_id_stock=1,
        qu_id_purchase=1,
    )
    create(
        client,
        api_headers,
        "userfields",
        entity="products",
        name="later",
        caption="Later",
        type="text-single-line",
        sort_number=2,
    )
    create(
        client,
        api_headers,
        "userfields",
        entity="products",
        name="first",
        caption="First",
        type="file",
        sort_number=1,
    )
    create(
        client,
        api_headers,
        "userfields",
        entity="recipes",
        name="foreign",
        caption="Foreign",
        type="text-single-line",
    )
    client.put(
        f"/api/userfields/products/{product}",
        headers=api_headers,
        json={"first": "Zml4dHVyZS5wZGY=_Rml4dHVyZS5wZGY="},
    ).raise_for_status()
    expected = context(client, api_headers, str(product))
    assert expected["product"]["description"] == "<strong>Raw</strong>"
    assert "row_created_timestamp" in expected["product"]
    assert expected["product"]["userfields"] == {
        "first": "Zml4dHVyZS5wZGY=_Rml4dHVyZS5wZGY=",
        "later": None,
    }
    assert [(row["name"], row["entity"]) for row in expected["fields"]] == [
        ("first", "products"),
        ("later", "products"),
    ]
    for alias in [
        f"00{product}",
        f"{product}e0",
        f"{product}.0",
        f"\t{product}\n",
        f"{product}\x00suffix",
    ]:
        assert context(client, api_headers, alias) == expected
    for invalid in ["missing", "New", f"0x{product:x}", f"[{product}]", f"\u00a0{product}\u00a0"]:
        response = client.get(
            "/api/v2/products/native-editor?row=" + quote(invalid, safe=""), headers=api_headers
        )
        assert response.status_code == 404, (invalid, response.text)


@pytest.mark.parametrize("imported_id", [0, -7])
def test_native_product_context_accepts_imported_nonpositive_ids(client, api_headers, imported_id):
    product = create(
        client,
        api_headers,
        "products",
        name="Imported native coffee",
        location_id=1,
        qu_id_stock=1,
        qu_id_purchase=1,
    )
    execute(client, "UPDATE products SET id=:target WHERE id=:id", target=imported_id, id=product)
    result = context(client, api_headers, f"{imported_id}\x00suffix")
    assert result["mode"] == "edit" and result["product"]["id"] == imported_id


def test_native_context_uses_actor_preferences_and_authenticated_read_boundary(
    client, api_headers, monkeypatch
):
    product = create(
        client,
        api_headers,
        "products",
        name="No-grant native coffee",
        location_id=1,
        qu_id_stock=1,
        qu_id_purchase=1,
    )
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users",
        headers=api_headers,
        json={"username": "native-product-reader", "password": ""},
    ).raise_for_status()
    user = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "native-product-reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": user}).json()[
        "api_key"
    ]
    headers = {"GROCY-API-KEY": key}
    client.put(
        "/api/user/settings/locale", headers=headers, json={"value": "de"}
    ).raise_for_status()
    client.put(
        "/api/user/settings/stock_decimal_places_amounts", headers=headers, json={"value": 1}
    ).raise_for_status()
    monkeypatch.setattr(get_settings(), "feature_flag_stock", False)
    monkeypatch.setattr(get_settings(), "base_path", "/house.hold/index.php")
    result = context(client, headers, str(product), "/house.hold/index.php")
    assert result["locale"] == "de"
    assert result["user_settings"]["stock_decimal_places_amounts"] == "1"
    assert result["config"]["FEATURE_FLAG_STOCK"] is False
    path = f"/house.hold/index.php/api/v2/products/native-editor?row={product}"
    assert client.get(path).status_code == 401
    assert client.post(path, headers=headers, json={}).status_code == 405
    denied = client.put(
        f"/house.hold/index.php/api/objects/products/{product}",
        headers=headers,
        json={"name": "Denied"},
    )
    assert denied.status_code == 403
    assert (
        context(client, headers, str(product), "/house.hold/index.php")["product"]["name"]
        == "No-grant native coffee"
    )
