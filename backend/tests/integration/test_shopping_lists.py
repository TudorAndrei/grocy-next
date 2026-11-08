from base64 import b64encode

from grocy.core.config import get_settings


def create(client, headers, entity, body):
    response = client.post(f"/api/objects/{entity}", headers=headers, json=body)
    assert response.status_code == 200, response.text
    return int(response.json()["created_object_id"])


def test_shopping_display_metadata_keeps_raw_quantity_and_purchase_booking(client, api_headers):
    stock_unit = create(client, api_headers, "quantity_units", {"name": "Display stock unit"})
    display_unit = create(client, api_headers, "quantity_units", {"name": "Display selected unit"})
    product = create(
        client,
        api_headers,
        "products",
        {
            "name": "Shopping display fraction",
            "location_id": 1,
            "qu_id_stock": stock_unit,
            "qu_id_purchase": stock_unit,
        },
    )
    create(
        client,
        api_headers,
        "quantity_unit_conversions",
        {"product_id": product, "from_qu_id": stock_unit, "to_qu_id": display_unit, "factor": 0.25},
    )
    item = create(
        client,
        api_headers,
        "shopping_list",
        {"product_id": product, "amount": 1.2, "qu_id": display_unit, "done": 1},
    )
    client.put(
        "/api/user/settings/shopping_list_round_up", headers=api_headers, json={"value": True}
    ).raise_for_status()
    response = client.get("/api/v2/shopping-lists/1", headers=api_headers)
    response.raise_for_status()
    row = next(row for row in response.json()["items"] if row["id"] == item)
    assert row["stock_amount"] == 1.2
    assert row["display_factor"] == 0.25
    assert row["amount"] == 0.3
    assert (
        client.get(f"/api/objects/shopping_list/{item}", headers=api_headers).json()["amount"]
        == 1.2
    )
    purchased = client.post(f"/api/v2/shopping-lists/1/items/{item}/purchase", headers=api_headers)
    assert purchased.status_code == 200, purchased.text
    assert purchased.json()["purchased"] is True
    assert (
        client.get(f"/api/stock/products/{product}", headers=api_headers).json()["stock_amount"]
        == 1.2
    )


def test_native_list_form_context_is_authenticated_without_write_or_domain_grants(
    client, api_headers, monkeypatch
):
    assert client.get("/api/v2/shopping-lists/editor").status_code == 401
    selected = create(client, api_headers, "shopping_lists", {"name": "Reader list"})
    create(
        client,
        api_headers,
        "userfields",
        {"entity": "shopping_lists", "name": "Delivery", "caption": "Delivery", "type": "date"},
    )
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users", headers=api_headers, json={"username": "List reader", "password": ""}
    ).raise_for_status()
    user = next(
        row
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "List reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": user["id"]}).json()[
        "api_key"
    ]
    reader = {"GROCY-API-KEY": key}
    response = client.get(f"/api/v2/shopping-lists/editor?list_id={selected}", headers=reader)
    assert response.status_code == 200, response.text
    assert response.json()["list"] == {"id": selected, "name": "Reader list"}
    assert response.json()["fields"][0]["name"] == "Delivery"
    assert client.get("/api/v2/shopping-lists/editor", headers=reader).json()["list"] is None
    assert client.get("/api/users", headers=reader).status_code == 403
    assert (
        client.put(
            f"/api/objects/shopping_lists/{selected}", headers=reader, json={"name": "Denied"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/objects/shopping_lists", headers=reader, json={"name": "Denied"}
        ).status_code
        == 403
    )


def test_shopping_list_catalog_editor_and_lifecycle(client, api_headers):
    alpha = create(client, api_headers, "shopping_lists", {"name": "alpha"})
    beta = create(client, api_headers, "shopping_lists", {"name": "Beta"})
    field = create(
        client,
        api_headers,
        "userfields",
        {
            "entity": "shopping_lists",
            "name": "7",
            "caption": "Delivery",
            "type": "text-single-line",
            "default_value": "Door",
            "input_required": 1,
        },
    )
    for done in (0, 1):
        create(
            client,
            api_headers,
            "shopping_list",
            {
                "shopping_list_id": beta,
                "note": "Bags",
                "amount": 1,
                "done": done,
            },
        )
    response = client.get("/api/v2/shopping-lists", headers=api_headers)
    assert response.status_code == 200, response.text
    rows = response.json()
    assert [row["name"] for row in rows] == sorted([row["name"] for row in rows], key=str.casefold)
    assert next(row for row in rows if row["id"] == beta)["item_count"] == 2
    editor = client.get(f"/api/v2/shopping-lists/editor?list_id={beta}", headers=api_headers)
    assert editor.status_code == 200, editor.text
    assert editor.json()["list"] == {"id": beta, "name": "Beta"}
    assert editor.json()["values"] == {"7": None}
    assert editor.json()["fields"][0]["id"] == field
    assert client.get("/api/v2/shopping-lists/editor", headers=api_headers).json()["values"] == {}
    assert (
        client.put(
            f"/api/userfields/shopping_lists/{beta}", headers=api_headers, json={"7": "Side"}
        ).status_code
        == 204
    )
    assert (
        client.put(
            f"/api/objects/shopping_lists/{beta}", headers=api_headers, json={"name": "Weekend"}
        ).status_code
        == 204
    )
    assert client.get(f"/api/v2/shopping-lists/editor?list_id={beta}", headers=api_headers).json()[
        "values"
    ] == {"7": "Side"}
    assert (
        client.post(
            "/api/stock/shoppinglist/clear",
            headers=api_headers,
            json={"list_id": beta, "done_only": True},
        ).status_code
        == 204
    )
    assert (
        len(client.get(f"/api/v2/shopping-lists/{beta}", headers=api_headers).json()["items"]) == 1
    )
    assert (
        client.delete(f"/api/objects/shopping_lists/{beta}", headers=api_headers).status_code == 204
    )
    remaining = client.get("/api/objects/shopping_list", headers=api_headers).json()
    assert all(row["shopping_list_id"] != beta for row in remaining)
    assert client.get(f"/api/v2/shopping-lists/{alpha}", headers=api_headers).status_code == 200
    assert (
        client.get(f"/api/v2/shopping-lists/editor?list_id={beta}", headers=api_headers).status_code
        == 404
    )


def test_shopping_paper_resolves_uploaded_custom_image(client, api_headers, tmp_path, monkeypatch):
    from grocy.core.config import clear_settings_cache

    monkeypatch.setenv("GROCY_FILES_ROOT", str(tmp_path / "files"))
    clear_settings_cache()
    import struct
    import zlib

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    image = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"\0\xff\0\0"))
        + chunk(b"IEND", b"")
    )
    name = b64encode(b"custom.png").decode()
    value = name + "_" + b64encode(b"red.png").decode()
    assert (
        client.put(f"/api/files/userfiles/{name}", headers=api_headers, content=image).status_code
        == 204
    )
    create(
        client,
        api_headers,
        "userfields",
        {
            "entity": "shopping_list",
            "name": "picture",
            "caption": "Picture",
            "type": "image",
            "show_as_column_in_tables": 1,
        },
    )
    item = create(
        client, api_headers, "shopping_list", {"shopping_list_id": 1, "note": "Image", "amount": 1}
    )
    assert (
        client.put(
            f"/api/userfields/shopping_list/{item}", headers=api_headers, json={"picture": value}
        ).status_code
        == 204
    )
    response = client.get("/api/v2/shopping-lists/1/print", headers=api_headers)
    assert response.status_code == 200, response.text
    assert "data:image/png;base64," in response.text


def test_shopping_item_editor_loads_native_fields_units_and_row(client, api_headers):
    create(client, api_headers, "product_barcodes", {"product_id": 1, "barcode": "Form-123"})
    item = create(
        client,
        api_headers,
        "shopping_list",
        {
            "product_id": 1,
            "shopping_list_id": 1,
            "amount": 12,
            "qu_id": 1,
            "note": "Keep cool",
            "done": 1,
        },
    )
    field = create(
        client,
        api_headers,
        "userfields",
        {"entity": "shopping_list", "name": "0", "caption": "Priority", "type": "text-single-line"},
    )
    assert (
        client.put(
            f"/api/userfields/shopping_list/{item}", headers=api_headers, json={"0": "First"}
        ).status_code
        == 204
    )
    response = client.get(
        f"/api/v2/shopping-lists/items/editor?item_id={item}", headers=api_headers
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["item"] == {
        "id": item,
        "shopping_list_id": 1,
        "product_id": 1,
        "amount": 12,
        "qu_id": 1,
        "note": "Keep cool",
    }
    assert data["values"] == {"0": "First"}
    assert data["fields"][0]["id"] == field
    assert data["products"] and data["units"] and data["conversions"]
    assert data["barcode_lookup_plugin_name"] == "Open Food Facts"
    assert next(row for row in data["barcodes"] if row["product_id"] == 1)["barcodes"] == (
        "4006381333931,Form-123"
    )
    inactive = create(
        client,
        api_headers,
        "products",
        {
            "name": "Inactive form product",
            "active": 0,
            "qu_id_stock": 1,
            "qu_id_purchase": 1,
            "location_id": 1,
        },
    )
    assert all(
        row["id"] != inactive
        for row in client.get("/api/v2/shopping-lists/items/editor", headers=api_headers).json()[
            "products"
        ]
    )
    assert (
        client.get("/api/v2/shopping-lists/items/editor", headers=api_headers).json()["item"]
        is None
    )
    assert (
        client.get(
            "/api/v2/shopping-lists/items/editor?item_id=99999", headers=api_headers
        ).status_code
        == 404
    )

    note_item = create(
        client, api_headers, "shopping_list", {"product_id": "", "amount": 1, "note": "Bags"}
    )
    note_editor = client.get(
        f"/api/v2/shopping-lists/items/editor?item_id={note_item}", headers=api_headers
    )
    assert note_editor.status_code == 200, note_editor.text
    assert note_editor.json()["item"]["product_id"] is None
