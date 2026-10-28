from base64 import b64encode


def create(client, headers, entity, body):
    response = client.post(f"/api/objects/{entity}", headers=headers, json=body)
    assert response.status_code == 200, response.text
    return int(response.json()["created_object_id"])


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
