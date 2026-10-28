"""The complete journal read uses native rows, dates, and stock field identity."""

from sqlalchemy import text

from grocy.db.session import get_session_factory


def test_journal_window_products_fields_and_correlated_undo(client, api_headers):
    client.headers.update(api_headers)

    def create(table, **values):
        response = client.post(f"/api/objects/{table}", json=values)
        response.raise_for_status()
        return int(response.json()["created_object_id"])

    unit = create("quantity_units", name="Journal piece", name_plural="Journal pieces")
    location = create("locations", name="Journal shelf")
    target = create("locations", name="Journal other shelf")
    product = create(
        "products",
        name="Journal product",
        location_id=location,
        qu_id_stock=unit,
        qu_id_purchase=unit,
    )
    other = create(
        "products",
        name="Inactive journal product",
        location_id=location,
        qu_id_stock=unit,
        qu_id_purchase=unit,
    )
    bookings = []
    for _ in range(153):
        response = client.post(f"/api/stock/products/{product}/add", json={"amount": 1})
        response.raise_for_status()
        bookings.append(response.json()[0]["id"])
    client.post(f"/api/stock/products/{other}/add", json={"amount": 2}).raise_for_status()
    client.put(f"/api/objects/products/{other}", json={"active": 0}).raise_for_status()
    entry = client.get(f"/api/stock/products/{product}/entries").json()[0]
    create(
        "userfields",
        entity="stock",
        name="1",
        caption="Batch",
        type="text-single-line",
        show_as_column_in_tables=1,
    )
    purchase = client.get(f"/api/objects/stock_log?query[]=stock_id={entry['stock_id']}").json()[0]
    # New stock fields use the booking transaction; the native trigger stores
    # them under each stock ID made by that transaction.
    client.put(
        f"/api/userfields/stock/{purchase['transaction_id']}", json={"1": "Mint"}
    ).raise_for_status()
    assert client.get(f"/api/userfields/stock/{entry['stock_id']}").json() == {"1": "Mint"}
    transfer = client.post(
        f"/api/stock/products/{product}/transfer",
        json={
            "amount": 1,
            "location_id_from": location,
            "location_id_to": target,
            "stock_entry_id": entry["stock_id"],
        },
    )
    transfer.raise_for_status()
    transfer_ids = {row["id"] for row in transfer.json()}
    client.put(f"/api/objects/locations/{target}", json={"active": 0}).raise_for_status()

    async def date_bookings():
        async with get_session_factory()() as session:
            await session.execute(
                text(
                    "UPDATE stock_log "
                    "SET row_created_timestamp=DATE('now','localtime','-7 months') "
                    "WHERE id=:id"
                ),
                {"id": bookings[0]},
            )
            await session.execute(
                text(
                    "UPDATE stock_log "
                    "SET row_created_timestamp=DATE('now','localtime','-6 months') "
                    "WHERE id=:id"
                ),
                {"id": bookings[1]},
            )
            await session.commit()

    assert client.portal is not None
    client.portal.call(date_bookings)

    def read(**query):
        response = client.get("/api/v2/stock/journal", params=query)
        assert response.status_code == 200, response.text
        return response.json()

    view = read(product=product)
    rows = view["rows"]
    assert len(rows) == 153
    assert all(row["product_id"] == product for row in rows)
    assert not ({bookings[0], bookings[1]} & {row["id"] for row in rows})
    assert [row["row_created_timestamp"] for row in rows] == sorted(
        (row["row_created_timestamp"] for row in rows), reverse=True
    )
    assert {row["id"] for row in view["products"]} >= {product}
    assert other not in {row["id"] for row in view["products"]}
    assert target in {row["id"] for row in view["locations"]}
    transferred = [row for row in rows if row["id"] in transfer_ids]
    assert len(transferred) == 2
    assert transferred[0]["correlation_id"] == transferred[1]["correlation_id"]
    assert all(row["custom_values"].get("1") == "Mint" for row in transferred)
    assert all(row["qu_name"] == "Journal piece" for row in rows)
    assert any(row["name"] for row in view["users"])
    assert len(read(product=product, months=12)["rows"]) == 155
    assert len(read(product=product, months="invalid")["rows"]) == 153
    assert len(read(product=f"+{product}", months=9999)["rows"]) == 155
    assert read(product=product, months="+1")["rows"] == []
    assert read(product=product, months=-1)["rows"] == []
    assert read(product=2147483647)["rows"] == []
    assert any(row["product_id"] == other for row in read()["rows"])
    client.post(f"/api/stock/bookings/{transferred[0]['id']}/undo").raise_for_status()
    restored = [row for row in read(product=product)["rows"] if row["id"] in transfer_ids]
    assert all(row["undone"] == 1 and row["undone_timestamp"] for row in restored)
