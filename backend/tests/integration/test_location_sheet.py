"""Location sheets use own-stock rows and presence-based out-of-stock limits."""

import json
from pathlib import Path

from sqlalchemy import text

from grocy.core.config import get_settings
from grocy.db.session import get_session_factory


def test_location_sheet_formats_saved_quantities_and_unit_errors_like_native(client, api_headers):
    client.headers.update(api_headers)

    def create(table, **values):
        response = client.post(f"/api/objects/{table}", json=values)
        response.raise_for_status()
        return int(response.json()["created_object_id"])

    unit = create("quantity_units", name="Formatting fixture")
    product = create(
        "products", name="Formatting fixture", location_id=1, qu_id_stock=unit, qu_id_purchase=unit
    )
    client.post(
        f"/api/stock/products/{product}/add", json={"amount": 1, "best_before_date": "2999-12-31"}
    ).raise_for_status()
    cases = json.loads(
        (Path(__file__).parents[1] / "fixtures" / "legacy-unit-formats.json").read_text()
    )["cases"]

    async def saved_case(case):
        async with get_session_factory()() as session:
            await session.execute(
                text("UPDATE stock SET amount=:amount,open=1 WHERE product_id=:id"),
                {"amount": case["value"], "id": product},
            )
            await session.execute(
                text("UPDATE quantity_units SET name=:name,name_plural=:name WHERE id=:id"),
                {"name": case["format"], "id": unit},
            )
            await session.commit()

    assert client.portal is not None
    for case in cases:
        client.portal.call(saved_case, case)
        response = client.get("/api/v2/stock/location-content-sheet")
        if "error" in case:
            assert response.status_code == 500, case
            assert response.json()["error_message"] == case["error"], case
        else:
            response.raise_for_status()
            row = next(
                row
                for location in response.json()["locations"]
                for row in location["products"]
                if row["id"] == product
            )
            assert row["unit_label"] == case["text"], case
            assert row["amount_text"] == row["amount_opened_text"] == case["amount_text"], case
            assert row["amount"] == case["value"], case


def test_location_sheet_keeps_native_locations_order_units_and_zero_stock(client, api_headers):
    client.headers.update(api_headers)

    def create(table, **values):
        response = client.post(f"/api/objects/{table}", json=values)
        response.raise_for_status()
        return int(response.json()["created_object_id"])

    alpha = create("locations", name="Sheet Alpha")
    beta = create("locations", name="sheet beta")
    create("locations", name="Sheet empty location")
    unit = create("quantity_units", name="Sheet piece", name_plural="Sheet pieces")
    old_unit = create(
        "quantity_units", name="Sheet old unit", name_plural="Sheet old units", plural_forms="old"
    )
    ids = {}
    for name in ["Zebra", "apple", "Zero", "Negative", "Empty", "Dormant", "Parent", "child"]:
        ids[name] = create(
            "products",
            name=f"Sheet {name}",
            location_id=beta if name in {"apple", "Empty"} else alpha,
            qu_id_stock=old_unit if name == "apple" else unit,
            qu_id_purchase=old_unit if name == "apple" else unit,
            **({"parent_product_id": ids["Parent"]} if name == "child" else {}),
        )

    def buy(name, amount, location):
        response = client.post(
            f"/api/stock/products/{ids[name]}/add",
            json={"amount": amount, "location_id": location, "best_before_date": "2999-12-31"},
        )
        response.raise_for_status()
        return response.json()[0]

    first = buy("Zebra", 3.75, beta)
    buy("Zebra", 1, alpha)
    client.post(
        f"/api/stock/products/{ids['Zebra']}/open",
        json={"amount": 0.25, "stock_entry_id": first["stock_id"]},
    ).raise_for_status()
    buy("apple", 2, beta)
    zero = buy("Zero", 1, alpha)
    negative = buy("Negative", 1, alpha)
    buy("Dormant", 4, alpha)
    buy("child", 3, alpha)
    client.put(f"/api/objects/products/{ids['Dormant']}", json={"active": 0}).raise_for_status()
    client.put(f"/api/objects/quantity_units/{old_unit}", json={"active": 0}).raise_for_status()
    client.put(f"/api/objects/locations/{beta}", json={"active": 0}).raise_for_status()

    async def imported_amounts():
        # Imported databases can contain saved zero and negative stock rows.
        async with get_session_factory()() as session:
            for booking, amount in [(zero, 0), (negative, -2)]:
                await session.execute(
                    text("UPDATE stock SET amount=:amount WHERE stock_id=:stock_id"),
                    {"amount": amount, "stock_id": booking["stock_id"]},
                )
            await session.commit()

    assert client.portal is not None
    client.portal.call(imported_amounts)

    def read(query=""):
        response = client.get("/api/v2/stock/location-content-sheet" + query)
        response.raise_for_status()
        return [row for row in response.json()["locations"] if row["id"] in {alpha, beta}]

    own = read()
    assert [row["id"] for row in own] == [alpha, beta]
    assert [[row["id"] for row in location["products"]] for location in own] == [
        [ids["Negative"], ids["Zebra"], ids["Zero"], ids["child"]],
        [ids["Zebra"], ids["apple"]],
    ]
    assert [[(row["amount"], row["amount_opened"]) for row in loc["products"]] for loc in own] == [
        [(-2, 0), (1, 0), (0, 0), (3, 0)],
        [(3.75, 0.25), (2, 0)],
    ]
    assert own[1]["products"][1]["unit_name_plural"] == "Sheet old units"
    assert own[1]["products"][1]["unit_active"] == 0
    with_empty = read("?include_out_of_stock=true")
    assert [[row["id"] for row in location["products"]] for location in with_empty] == [
        [ids["Negative"], ids["Parent"], ids["Zebra"], ids["Zero"], ids["child"]],
        [ids["Empty"], ids["Zebra"], ids["apple"]],
    ]
    assert with_empty[0]["products"][1]["amount"] == 0
    for value in ["", "0", "false"]:
        assert read("?include_out_of_stock=" + value) == with_empty


def test_location_sheet_uses_native_plural_rules_and_inactive_unit_fallbacks(client, api_headers):
    client.headers.update(api_headers)

    def create(table, **values):
        response = client.post(f"/api/objects/{table}", json=values)
        response.raise_for_status()
        return int(response.json()["created_object_id"])

    unit = create("quantity_units", name="Plural fixture")
    product = create(
        "products", name="Plural fixture", location_id=1, qu_id_stock=unit, qu_id_purchase=unit
    )
    client.post(
        f"/api/stock/products/{product}/add", json={"amount": 1, "best_before_date": "2999-12-31"}
    ).raise_for_status()
    cases = json.loads(
        (Path(__file__).parents[1] / "fixtures" / "legacy-unit-plurals.json").read_text()
    )["cases"]

    async def saved_case(case):
        async with get_session_factory()() as session:
            await session.execute(
                text("UPDATE stock SET amount=:amount WHERE product_id=:id"),
                {"amount": case["value"], "id": product},
            )
            await session.execute(
                text(
                    "UPDATE quantity_units SET name_plural=:plural,plural_forms=:forms,"
                    "active=:active WHERE id=:id"
                ),
                {
                    "plural": case["plural"],
                    "forms": case["forms"],
                    "active": case["active"],
                    "id": unit,
                },
            )
            await session.commit()

    locale = None
    assert client.portal is not None
    for case in cases:
        if locale != case["locale"]:
            locale = case["locale"]
            client.put("/api/user/settings/locale", json={"value": locale}).raise_for_status()
        client.portal.call(saved_case, case)
        response = client.get("/api/v2/stock/location-content-sheet")
        response.raise_for_status()
        row = next(
            row
            for location in response.json()["locations"]
            for row in location["products"]
            if row["id"] == product
        )
        assert row["unit_label"] == case["text"], case


def test_location_sheet_requires_login_and_allows_native_read_only_users(
    client, api_headers, monkeypatch
):
    assert client.get("/api/v2/stock/location-content-sheet").status_code == 401
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users", headers=api_headers, json={"username": "Sheet reader", "password": "secret"}
    ).raise_for_status()
    identity = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Sheet reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": identity}).json()[
        "api_key"
    ]
    response = client.get("/api/v2/stock/location-content-sheet", headers={"GROCY-API-KEY": key})
    assert response.status_code == 200, response.text
