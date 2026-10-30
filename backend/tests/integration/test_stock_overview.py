"""Overview reader selection follows the pinned page, not a stock/shortage API join."""


def test_overview_selection_settings_and_actual_locations(client, api_headers):
    client.headers.update(api_headers)

    def create(table, **values):
        response = client.post(f"/api/objects/{table}", json=values)
        response.raise_for_status()
        return int(response.json()["created_object_id"])

    unit = create("quantity_units", name="Overview reader piece")
    locations = [
        create("locations", name=f"Overview reader {name}") for name in ["Alpha", "beta", "Old"]
    ]
    groups = [
        create("product_groups", name=f"Overview reader {name}") for name in ["Group", "Old group"]
    ]
    ids = {}
    for name in ["Stock", "Empty", "Missing", "Hidden", "Inactive", "Parent", "Child", "Old unit"]:
        ids[name] = create(
            "products",
            name=f"Overview reader {name}",
            location_id=locations[0],
            qu_id_stock=unit,
            qu_id_purchase=unit,
            product_group_id=groups[0],
            **({"min_stock_amount": 2} if name in {"Missing", "Hidden"} else {}),
            **({"parent_product_id": ids["Parent"]} if name == "Child" else {}),
        )

    for name, amount, location in [
        ("Stock", 2, locations[0]),
        ("Stock", 3, locations[1]),
        ("Stock", 4, locations[2]),
        ("Hidden", 1, locations[1]),
        ("Inactive", 1, locations[0]),
        ("Child", 5, locations[1]),
        ("Old unit", 1, locations[0]),
    ]:
        client.post(
            f"/api/stock/products/{ids[name]}/add",
            json={"amount": amount, "location_id": location, "best_before_date": "2999-12-31"},
        ).raise_for_status()

    old_unit = create("quantity_units", name="Overview reader old piece")
    for table, row_id, values in [
        ("products", ids["Hidden"], {"hide_on_stock_overview": 1}),
        ("products", ids["Inactive"], {"active": 0}),
        ("locations", locations[2], {"active": 0}),
        ("product_groups", groups[1], {"active": 0}),
        ("quantity_units", old_unit, {"active": 0}),
        ("products", ids["Old unit"], {"qu_id_price": old_unit, "product_group_id": groups[1]}),
    ]:
        client.put(f"/api/objects/{table}/{row_id}", json=values).raise_for_status()

    def view():
        response = client.get("/api/v2/stock/overview")
        response.raise_for_status()
        return response.json()

    # Captured from Grocy 4.5.0's page with this catalog and these purchases.
    expected = [ids[name] for name in ["Stock", "Missing", "Parent", "Child", "Old unit"]]
    for setting, show_empty in [
        (False, False),
        ("0", False),
        ("", False),
        (None, False),
        (True, True),
        ("false", True),
        ("on", True),
        (2, True),
    ]:
        client.put(
            "/api/user/settings/stock_overview_show_all_out_of_stock_products",
            json={"value": setting},
        ).raise_for_status()
        data = view()
        selected = [row["product_id"] for row in data["rows"] if row["product_id"] in ids.values()]
        assert selected == sorted([*expected, *([ids["Empty"]] if show_empty else [])])

    rows = {row["product_id"]: row for row in data["rows"]}
    assert rows[ids["Stock"]]["location_names"] == [
        "Overview reader Alpha",
        "Overview reader beta",
        None,
    ]
    assert rows[ids["Stock"]]["product_default_location_name"] == "Overview reader Alpha"
    assert rows[ids["Stock"]]["amount"] == 9
    assert rows[ids["Parent"]]["amount"] == 0
    assert rows[ids["Parent"]]["amount_aggregated"] == 5
    assert rows[ids["Parent"]]["location_names"] == []
    assert rows[ids["Missing"]]["product_missing"] == 1
    assert rows[ids["Missing"]]["best_before_date"] == "2888-12-31"
    assert rows[ids["Old unit"]]["qu_price_name"] == "Overview reader old piece"
    assert rows[ids["Old unit"]]["product_group_name"] == "Overview reader Old group"
    assert [row["name"] for row in data["locations"] if row["id"] in locations] == [
        "Overview reader Alpha",
        "Overview reader beta",
    ]
    assert [row["name"] for row in data["product_groups"] if row["id"] in groups] == [
        "Overview reader Group"
    ]


def test_overview_table_values_keep_native_number_text_units_and_fields(client, api_headers):
    client.headers.update(api_headers)

    def create(table, **values):
        response = client.post(f"/api/objects/{table}", json=values)
        response.raise_for_status()
        return int(response.json()["created_object_id"])

    unit = create(
        "quantity_units",
        name="%s product expires",
        name_plural="%s products expiring",
        plural_forms="%s unit few\n%s unit many\n%s unit fraction",
    )
    box = create("quantity_units", name="Overview table box")
    parent = create(
        "products",
        name="Overview table parent",
        location_id=1,
        qu_id_stock=unit,
        qu_id_purchase=unit,
    )
    child = create(
        "products",
        name="Overview table child",
        location_id=1,
        qu_id_stock=unit,
        qu_id_purchase=unit,
        parent_product_id=parent,
    )
    create("quantity_unit_conversions", product_id=parent, from_qu_id=box, to_qu_id=unit, factor=6)
    client.put(
        f"/api/objects/products/{parent}",
        json={
            "qu_id_price": box,
            "description": "<p>Dark <strong>cocoa</strong></p>",
        },
    ).raise_for_status()
    for product, amount in [(parent, 1.2345678901234567), (child, 2.5)]:
        client.post(
            f"/api/stock/products/{product}/add",
            json={
                "amount": amount,
                "price": 1.25,
                "best_before_date": "2999-12-31",
            },
        ).raise_for_status()
    create(
        "userfields",
        entity="products",
        name="origin",
        caption="Origin",
        type="text-single-line",
        show_as_column_in_tables=1,
    )
    client.put(
        f"/api/userfields/products/{parent}", json={"origin": "Shared brew"}
    ).raise_for_status()
    create("shopping_list", product_id=parent, amount=1, shopping_list_id=1)
    client.put(
        "/api/user/settings/show_icon_on_stock_overview_page_when_product_is_on_shopping_list",
        json={"value": "false"},
    ).raise_for_status()

    client.put(
        f"/api/objects/products/{parent}", json={"calories": "not numeric"}
    ).raise_for_status()

    # Imported stock can retain more precision than a booking request.
    async def saved_amount():
        from sqlalchemy import text

        from grocy.db.session import get_session_factory

        async with get_session_factory()() as session:
            await session.execute(
                text("UPDATE stock SET amount=1.2345678901234567 WHERE product_id=:id"),
                {"id": parent},
            )
            await session.commit()

    client.portal.call(saved_amount)
    for locale, own, aggregate in [
        ("en", "1.2345678901235 products expiring", "3.7345678901235 unit few"),
        ("ru", "1.2345678901235 продукт испортится", "3.7345678901235 unit few"),
    ]:
        client.put("/api/user/settings/locale", json={"value": locale}).raise_for_status()
        response = client.get("/api/v2/stock/overview")
        response.raise_for_status()
        data = response.json()
        row = next(row for row in data["rows"] if row["product_id"] == parent)
        assert row["number_text"]["product_calories"] == "not numeric"
        assert row["number_text"]["amount"] == "1.2345678901235"
        assert row["number_text"]["last_price_display"] == "7.5"
        assert row["unit_label"] == own
        assert row["unit_label_aggregated"] == aggregate
        assert row["product_values"] == {"origin": "Shared brew"}
        assert row["product_description"] == "<p>Dark <strong>cocoa</strong></p>"
        assert row["on_shopping_list"] == 1
        assert data["show_shopping_icon"] is True

    client.put(
        f"/api/userfields/products/0{parent}", json={"origin": "Numeric alias"}
    ).raise_for_status()
    for name, caption in [("1", "Number"), ("01", "Padded number")]:
        create(
            "userfields",
            entity="products",
            name=name,
            caption=caption,
            type="text-single-line",
            show_as_column_in_tables=1,
        )
    client.put(f"/api/userfields/products/{parent}", json={"1": "Number choice"}).raise_for_status()
    response = client.get("/api/v2/stock/overview")
    response.raise_for_status()
    row = next(row for row in response.json()["rows"] if row["product_id"] == parent)
    assert row["product_values"] == {
        "origin": "Numeric alias",
        "1": "Number choice",
        "01": "Number choice",
    }
