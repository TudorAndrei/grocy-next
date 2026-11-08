"""Native selected stock forms keep raw row identity and stock-ID field lookup."""

from urllib.parse import quote

import pytest
from sqlalchemy import text

from grocy.core.config import get_settings
from grocy.db.session import get_session_factory


def execute(client, sql, **parameters):
    async def write():
        async with get_session_factory()() as session:
            await session.execute(text(sql), parameters)
            await session.commit()

    client.portal.call(write)


@pytest.fixture
def selected_entry(client, api_headers):
    def create(table, **values):
        response = client.post(f"/api/objects/{table}", headers=api_headers, json=values)
        response.raise_for_status()
        return int(response.json()["created_object_id"])

    product = create(
        "products", name="Native selected coffee", location_id=1, qu_id_stock=1, qu_id_purchase=1
    )
    create("locations", name="Hidden native shelf", active=0)
    create("locations", name="Zulu native shelf")
    create("locations", name="alpha native shelf")
    create("shopping_locations", name="Hidden native shop", active=0)
    create("shopping_locations", name="Zulu native shop")
    create("shopping_locations", name="alpha native shop")
    create(
        "userfields",
        entity="stock",
        name="later",
        caption="Later",
        type="text-single-line",
        sort_number=2,
    )
    create(
        "userfields",
        entity="stock",
        name="batch",
        caption="Batch",
        type="text-single-line",
        sort_number=1,
    )
    create(
        "userfields",
        entity="products",
        name="productonly",
        caption="Other namespace",
        type="text-single-line",
    )
    response = client.post(
        f"/api/stock/products/{product}/add",
        headers=api_headers,
        json={"amount": 2.34567, "best_before_date": "2999-12-31", "price": 1.25},
    )
    response.raise_for_status()
    booking = response.json()[0]
    client.put(
        f"/api/userfields/stock/{booking['transaction_id']}",
        headers=api_headers,
        json={"batch": "Saved stock batch"},
    ).raise_for_status()
    row = next(
        item
        for item in client.get("/api/objects/stock", headers=api_headers).json()
        if item["stock_id"] == booking["stock_id"]
    )
    return row


def test_raw_selected_row_aliases_keep_canonical_identity_and_native_form_data(
    client, api_headers, selected_entry
):
    row = selected_entry
    identity = row["id"]
    modern = client.get(f"/api/v2/stock/entries/{identity}/editor", headers=api_headers)
    modern.raise_for_status()
    for alias in (
        str(identity),
        f"000{identity}",
        f"{identity}e0",
        f"{identity}.0",
        f" +{identity} ",
        f"{identity}\x00tail",
        f"\t{identity}\n",
        f"\v{identity}\f",
        f"\r{identity}\t",
    ):
        response = client.get(
            "/api/v2/stock/entries/native-editor?row=" + quote(alias, safe=""),
            headers=api_headers,
        )
        assert response.status_code == 200, (alias, response.text)
        data = response.json()
        assert data == modern.json()
        assert data["entry"]["id"] == identity
        assert data["entry"]["stock_id"] == row["stock_id"]
        assert data["entry"]["amount"] == 2.34567
        assert data["values"] == {"batch": "Saved stock batch", "later": None}
        assert [field["name"] for field in data["fields"]] == ["batch", "later"]
        assert "Hidden native shelf" not in [choice["name"] for choice in data["locations"]]
        assert "Hidden native shop" not in [choice["name"] for choice in data["stores"]]
        assert [
            choice["name"] for choice in data["locations"] if "native shelf" in choice["name"]
        ] == ["alpha native shelf", "Zulu native shelf"]
        assert [choice["name"] for choice in data["stores"] if "native shop" in choice["name"]] == [
            "alpha native shop",
            "Zulu native shop",
        ]
    for missing in (
        "unknown",
        f"0x{identity:x}",
        f"[{identity}]",
        row["stock_id"],
        f"\u00a0{identity}\u00a0",
        f"\u2003{identity}\u2003",
        f"{identity}\u0085",
        "\x00",
    ):
        response = client.get(
            "/api/v2/stock/entries/native-editor?row=" + quote(missing, safe=""),
            headers=api_headers,
        )
        assert response.status_code == 404, (missing, response.text)


@pytest.mark.parametrize("imported_id", [0, -7])
def test_imported_nonpositive_row_ids_are_read_without_positive_id_coercion(
    client, api_headers, selected_entry, imported_id
):
    execute(
        client, "UPDATE stock SET id=:new WHERE id=:old", new=imported_id, old=selected_entry["id"]
    )
    response = client.get(
        f"/api/v2/stock/entries/native-editor?row={imported_id}", headers=api_headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["entry"]["id"] == imported_id
    assert response.json()["entry"]["stock_id"] == selected_entry["stock_id"]
    with_nul = client.get(
        "/api/v2/stock/entries/native-editor?row=" + quote(f"{imported_id}\x00tail", safe=""),
        headers=api_headers,
    )
    assert with_nul.status_code == 200, with_nul.text
    assert with_nul.json() == response.json()


def test_native_selected_read_is_authenticated_without_write_or_feature_grants(
    client, api_headers, selected_entry, monkeypatch
):
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users", headers=api_headers, json={"username": "entry-reader", "password": ""}
    ).raise_for_status()
    user = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "entry-reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": user}).json()[
        "api_key"
    ]
    headers = {"GROCY-API-KEY": key}
    monkeypatch.setattr(get_settings(), "feature_flag_stock", False)
    monkeypatch.setattr(get_settings(), "base_path", "/house.hold")
    path = f"/house.hold/api/v2/stock/entries/native-editor?row={selected_entry['id']}"
    response = client.get(path, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["entry"]["id"] == selected_entry["id"]
    assert client.get(path).status_code == 401
    assert client.post(path, headers=headers, json={}).status_code == 405
    denied = client.put(
        f"/house.hold/api/stock/entry/{selected_entry['id']}", headers=headers, json={"amount": 9}
    )
    assert denied.status_code == 403


def test_first_empty_native_price_object_is_ignored_by_existing_booking_parser(
    client, api_headers, selected_entry
):
    # The pinned script reads window.price (the named input) before its first
    # assignment. JSON includes jQuery event metadata; PHP is_numeric rejects it.
    response = client.put(
        f"/api/stock/entry/{selected_entry['id']}",
        headers=api_headers,
        json={
            "amount": "2.34567",
            "best_before_date": "2999-12-31",
            "purchased_date": selected_entry["purchased_date"],
            "location_id": 1,
            "price": {"jQuery371fixture": {"events": {"keyup": [{"type": "keyup"}]}}},
            "open": False,
            "note": "Native empty price",
        },
    )
    assert response.status_code == 200, response.text
    row = client.get(f"/api/stock/entry/{selected_entry['id']}", headers=api_headers).json()
    assert row["price"] is None
    assert row["note"] == "Native empty price"
