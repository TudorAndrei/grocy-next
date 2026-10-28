"""Stock entry reads retain active lookups, stock identity, and booking actions."""


def test_entries_fields_choices_and_exact_booking_actions(client, api_headers):
    client.headers.update(api_headers)

    def create(table, **values):
        response = client.post(f"/api/objects/{table}", json=values)
        response.raise_for_status()
        return int(response.json()["created_object_id"])

    unit = create("quantity_units", name="Entry piece", name_plural="Entry pieces")
    box = create("quantity_units", name="Entry box")
    location = create("locations", name="Entry shelf")
    other = create("locations", name="Entry cupboard")
    store = create("shopping_locations", name="Entry store")
    product = create(
        "products",
        name="Entry coffee",
        location_id=location,
        qu_id_stock=unit,
        qu_id_purchase=unit,
        qu_id_price=unit,
        default_best_before_days_after_open=3,
    )
    create("quantity_unit_conversions", product_id=product, from_qu_id=box, to_qu_id=unit, factor=6)
    client.put(f"/api/objects/products/{product}", json={"qu_id_price": box}).raise_for_status()
    create(
        "userfields",
        entity="products",
        name="1",
        caption="Origin",
        type="text-single-line",
        show_as_column_in_tables=1,
    )
    create(
        "userfields",
        entity="stock",
        name="1",
        caption="Batch",
        type="text-single-line",
        show_as_column_in_tables=1,
    )
    client.put(f"/api/userfields/products/{product}", json={"1": "Roastery"}).raise_for_status()
    booking = client.post(
        f"/api/stock/products/{product}/add",
        json={
            "amount": 2.5,
            "location_id": location,
            "shopping_location_id": store,
            "price": 1.25,
            "best_before_date": "2999-12-31",
            "purchased_date": "2026-10-25",
            "note": "Mint batch",
        },
    )
    booking.raise_for_status()
    purchase = booking.json()[0]
    client.put(
        f"/api/userfields/stock/{purchase['transaction_id']}", json={"1": "Mint"}
    ).raise_for_status()
    client.post(
        f"/api/stock/products/{product}/add",
        json={"amount": 1, "location_id": other, "note": "Other batch"},
    ).raise_for_status()

    def view():
        response = client.get("/api/v2/stock/entries")
        assert response.status_code == 200, response.text
        return response.json()

    def batch():
        return next(row for row in view()["rows"] if row["stock_id"] == purchase["stock_id"])

    row = batch()
    assert row["amount"] == 2.5 and row["price"] == 1.25
    assert row["qu_factor_price_to_stock"] == 6
    assert row["qu_factor_purchase_to_stock"] == 1
    assert row["purchase_qu_name"] == "Entry piece"
    assert row["product_name"] == "Entry coffee"
    assert row["qu_name"] == "Entry piece" and row["price_qu_name"] == "Entry box"
    assert row["location_name"] == "Entry shelf" and row["shopping_location_name"] == "Entry store"
    assert row["product_values"] == {"1": "Roastery"} and row["stock_values"] == {"1": "Mint"}
    assert row["note"] == "Mint batch" and row["purchased_date"] == "2026-10-25"
    assert row["open"] == 0
    opened = client.post(
        f"/api/stock/products/{product}/open",
        json={"amount": row["amount"], "stock_entry_id": row["stock_id"]},
    )
    opened.raise_for_status()
    assert batch()["open"] == 1
    client.post(f"/api/stock/bookings/{opened.json()[0]['id']}/undo").raise_for_status()
    row = batch()
    assert row["open"] == 0
    consumed = client.post(
        f"/api/stock/products/{product}/consume",
        json={
            "amount": row["amount"],
            "spoiled": True,
            "location_id": row["location_id"],
            "stock_entry_id": row["stock_id"],
            "exact_amount": True,
        },
    )
    consumed.raise_for_status()
    assert all(r["stock_id"] != row["stock_id"] for r in view()["rows"])
    assert any(r["note"] == "Other batch" and r["amount"] == 1 for r in view()["rows"])
    log = client.get(f"/api/stock/bookings/{consumed.json()[0]['id']}").json()
    assert log["spoiled"] == 1 and log["amount"] == -2.5
    client.post(f"/api/stock/bookings/{log['id']}/undo").raise_for_status()
    assert batch()["amount"] == 2.5 and batch()["stock_values"] == {"1": "Mint"}

    for table, identity in [
        ("products", product),
        ("quantity_units", unit),
        ("locations", location),
        ("shopping_locations", store),
    ]:
        client.put(f"/api/objects/{table}/{identity}", json={"active": 0}).raise_for_status()
    hidden = batch()
    assert hidden["product_name"] is None and hidden["qu_name"] is None
    assert hidden["location_name"] is None and hidden["shopping_location_name"] is None
    assert product not in {c["id"] for c in view()["products"]}
    assert location not in {c["id"] for c in view()["locations"]}
    assert store not in {c["id"] for c in view()["stores"]}
