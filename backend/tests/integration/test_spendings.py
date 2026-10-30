"""Report totals come from purchase history, including edited origin amounts."""

from sqlalchemy import text

from grocy.core.config import get_settings
from grocy.db.session import get_session_factory


def test_spendings_groups_dates_edited_origins_and_undo(client, api_headers):
    client.headers.update(api_headers)

    def create(table, **values):
        response = client.post(f"/api/objects/{table}", json=values)
        response.raise_for_status()
        return int(response.json()["created_object_id"])

    def read(**query):
        response = client.get("/api/v2/stock/reports/spendings", params=query)
        response.raise_for_status()
        return response.json()

    unit = create("quantity_units", name="Spending piece")
    group = create("product_groups", name="Spending active")
    inactive = create("product_groups", name="Spending old", active=0)
    market = create("shopping_locations", name="Spending market")
    old_market = create("shopping_locations", name="Spending old market", active=0)
    products = [
        create(
            "products",
            name=name,
            location_id=1,
            qu_id_stock=unit,
            qu_id_purchase=unit,
            product_group_id=identity,
        )
        for name, identity in [
            ("Spending Apricot", group),
            ("Spending banana", inactive),
            ("Spending Cherry", None),
            ("Spending dates", None),
        ]
    ]
    apricot, banana, cherry, dates = products

    def buy(product, amount, price, date, store=None, **extra):
        response = client.post(
            f"/api/stock/products/{product}/add",
            json={
                "amount": amount,
                "price": price,
                "purchased_date": date,
                "best_before_date": "2999-12-31",
                "shopping_location_id": store,
                **extra,
            },
        )
        response.raise_for_status()
        return response.json()[0]

    first = buy(apricot, 2, 3, "2035-03-01", market)
    buy(apricot, 4, 1.25, "2035-03-31", market)
    buy(apricot, 1, 500, "2035-02-28", market)
    buy(apricot, 1, 100, "2035-04-01", market)
    buy(apricot, 2, 100, "2035-03-10", market, transaction_type="self-production")
    buy(apricot, 2, 0, "2035-03-10", market)
    cancelled = buy(apricot, 2, 100, "2035-03-10", market)
    client.post(f"/api/stock/bookings/{cancelled['id']}/undo").raise_for_status()
    buy(banana, 3, 2, "2035-03-15", old_market)
    client.put(f"/api/objects/products/{banana}", json={"active": 0}).raise_for_status()
    buy(cherry, 1, 4, "2035-03-10")
    client.post(
        f"/api/stock/products/{apricot}/consume",
        json={
            "amount": 1,
            "stock_entry_id": first["stock_id"],
        },
    ).raise_for_status()
    entry = next(
        row
        for row in client.get(f"/api/stock/products/{apricot}/entries").json()
        if row["stock_id"] == first["stock_id"]
    )
    client.put(
        f"/api/stock/entry/{entry['id']}",
        json={
            "amount": 1,
            "price": 8,
            "purchased_date": "2035-03-01",
            "best_before_date": "2999-12-31",
            "shopping_location_id": market,
            "location_id": 1,
            "open": False,
        },
    ).raise_for_status()
    limits = {"start_date": "2035-03-01", "end_date": "2035-03-31"}
    view = read(**limits)
    rows = [row for row in view["rows"] if row["id"] in products]
    assert [(row["name"], row["total"]) for row in rows] == [
        ("Spending Apricot", 21),
        ("Spending banana", 6),
        ("Spending Cherry", 4),
    ]
    assert [row["group_id"] for row in rows] == [group, inactive, None]
    assert group in {row["id"] for row in view["product_groups"]}
    assert inactive not in {row["id"] for row in view["product_groups"]}
    assert read(**limits, product_group=str(group))["rows"] == [rows[0]]
    assert read(**limits, product_group="ungrouped")["rows"] == [rows[2]]
    assert read(**limits, product_group="all")["rows"] == view["rows"]
    assert read(**limits, group_by="invalid")["group_by"] == "product"
    grouped = read(**limits, group_by="productgroup", product_group=str(group))["rows"]
    assert [(row["id"], row["total"]) for row in grouped] == [(None, 4), (group, 21), (inactive, 6)]
    stores = read(**limits, group_by="store", product_group="ungrouped")["rows"]
    assert [(row["id"], row["total"]) for row in stores] == [
        (None, 4),
        (market, 21),
        (old_market, 6),
    ]
    assert read(start_date="2035-03-31", end_date="2035-03-01")["rows"] == []

    async def current_dates():
        async with get_session_factory()() as session:
            return (
                await session.execute(
                    text(
                        "SELECT DATE('now','localtime'),"
                        "DATE('now','localtime','start of month','-1 day')"
                    )
                )
            ).one()

    assert client.portal is not None
    today, previous = client.portal.call(current_dates)
    buy(dates, 1, 5, today)
    buy(dates, 1, 1000, previous)
    default = read()["rows"]
    assert next(row["total"] for row in default if row["id"] == dates) == 5
    # The native default includes future months, unlike an explicit month.
    assert next(row["total"] for row in default if row["id"] == apricot) == 621
    for query in [
        {"start_date": "2035-03-01"},
        {"start_date": "2035-02-29", "end_date": "2035-03-31"},
        {"start_date": "", "end_date": ""},
    ]:
        assert read(**query)["rows"] == default


def test_spendings_requires_login_and_allows_native_read_only_users(
    client, api_headers, monkeypatch
):
    assert client.get("/api/v2/stock/reports/spendings").status_code == 401
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users",
        headers=api_headers,
        json={
            "username": "Spending reader",
            "password": "secret",
        },
    ).raise_for_status()
    identity = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Spending reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": identity}).json()[
        "api_key"
    ]
    response = client.get("/api/v2/stock/reports/spendings", headers={"GROCY-API-KEY": key})
    assert response.status_code == 200, response.text
