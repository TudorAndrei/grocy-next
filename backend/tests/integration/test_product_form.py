"""Product form choices at the database and authenticated HTTP boundary."""


def test_product_choices_follow_activity_conversions_and_parent_relationships(client, api_headers):
    client.headers.update(api_headers)

    def create(entity, **values):
        response = client.post(f"/api/objects/{entity}", json=values)
        assert response.status_code == 200, response.text
        return int(response.json()["created_object_id"])

    def options(identity=None):
        response = client.get(
            "/api/v2/products/form-options",
            params={} if identity is None else {"product_id": identity},
        )
        assert response.status_code == 200, response.text
        return response.json()

    unit = create("quantity_units", name="Choice piece")
    box = create("quantity_units", name="Choice box")
    crate = create("quantity_units", name="Choice crate")
    inactive = create("quantity_units", name="Choice inactive", active=0)
    unrelated = create("quantity_units", name="Choice unrelated")
    lower = create("locations", name="a choice location")
    upper = create("locations", name="Z choice location")
    hidden = create("locations", name="Hidden choice location", active=0)
    store = create("shopping_locations", name="Choice store")
    hidden_store = create("shopping_locations", name="Hidden choice store", active=0)
    group = create("product_groups", name="Choice group")
    hidden_group = create("product_groups", name="Hidden choice group", active=0)
    product = create(
        "products", name="Choice product", location_id=lower, qu_id_stock=unit, qu_id_purchase=box
    )
    other = create(
        "products", name="Choice parent", location_id=lower, qu_id_stock=unit, qu_id_purchase=unit
    )
    disabled = create(
        "products",
        name="Choice inactive parent",
        location_id=lower,
        qu_id_stock=unit,
        qu_id_purchase=unit,
        active=0,
    )
    child = create(
        "products",
        name="Choice child",
        location_id=lower,
        qu_id_stock=unit,
        qu_id_purchase=unit,
        parent_product_id=other,
    )
    create(
        "products",
        name="Choice inactive child",
        location_id=lower,
        qu_id_stock=unit,
        qu_id_purchase=unit,
        parent_product_id=product,
        active=0,
    )
    conversion = next(
        row
        for row in client.get("/api/objects/quantity_unit_conversions").json()
        if row["product_id"] == product and row["from_qu_id"] == box and row["to_qu_id"] == unit
    )
    client.put(
        f"/api/objects/quantity_unit_conversions/{conversion['id']}", json={"factor": 6}
    ).raise_for_status()
    create("quantity_unit_conversions", from_qu_id=crate, to_qu_id=box, factor=4)
    create(
        "quantity_unit_conversions",
        product_id=product,
        from_qu_id=inactive,
        to_qu_id=unit,
        factor=2,
    )

    before = client.get(f"/api/objects/products/{product}").json()
    new = options()
    edit = options(product)
    assert {unit, box, crate, inactive, unrelated} <= set(new["references"]["qu_id_stock"])
    for key in ("qu_id_purchase", "qu_id_consume", "qu_id_price"):
        assert {unit, box, crate, unrelated} <= set(new["references"][key])
        assert inactive not in new["references"][key]
        assert edit["references"][key] == [box, crate, unit]
    assert set(edit["references"]["qu_id_stock"]) >= {unit, box, crate, inactive, unrelated}
    assert not new["parent_disabled"] and edit["parent_disabled"]
    assert product in new["references"]["parent_product_id"]
    assert other in edit["references"]["parent_product_id"]
    assert not ({product, child, disabled} & set(edit["references"]["parent_product_id"]))
    assert new["references"]["location_id"].index(upper) < new["references"]["location_id"].index(
        lower
    )
    assert edit["references"]["location_id"].index(lower) < edit["references"]["location_id"].index(
        upper
    )
    assert hidden not in edit["references"]["location_id"]
    assert (
        store in edit["references"]["shopping_location_id"]
        and hidden_store not in edit["references"]["shopping_location_id"]
    )
    assert (
        group in edit["references"]["product_group_id"]
        and hidden_group not in edit["references"]["product_group_id"]
    )
    assert (
        next(
            row["factor"]
            for row in edit["conversions"]
            if row["from_qu_id"] == crate and row["to_qu_id"] == unit
        )
        == 24
    )
    assert client.get(f"/api/objects/products/{product}").json() == before

    client.put(
        f"/api/objects/products/{product}", json={"min_stock_amount": "legacy text"}
    ).raise_for_status()
    assert options(product)["references"] == edit["references"]
    client.put(f"/api/objects/products/{product}", json={"min_stock_amount": 0}).raise_for_status()

    booking = client.post(f"/api/stock/products/{product}/add", json={"amount": 2}).json()[0]["id"]
    client.post(f"/api/stock/bookings/{booking}/undo").raise_for_status()
    after_undo = options(product)
    assert after_undo["references"]["qu_id_stock"] == [box, crate, inactive, unit]
    assert client.get(f"/api/stock/products/{product}").json()["stock_amount"] == 0
    assert client.get("/api/v2/products/form-options?product_id=2147483647").status_code == 404
