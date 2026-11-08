"""Native pages render for authenticated readers; their mutation APIs still authorize writes."""

import pytest

from editor_document import EditorDocument
from grocy.core.config import get_settings


@pytest.fixture
def page_reader(client, api_headers, monkeypatch):
    def create(table, **values):
        response = client.post(f"/api/objects/{table}", headers=api_headers, json=values)
        response.raise_for_status()
        return int(response.json()["created_object_id"])

    product = create(
        "products",
        name="Native reader coffee",
        description="<strong>Saved description</strong>",
        location_id=1,
        qu_id_stock=1,
        qu_id_purchase=1,
    )
    client.post(
        f"/api/stock/products/{product}/add",
        headers=api_headers,
        json={"amount": 3, "best_before_date": "2999-12-31", "note": "Reader batch"},
    ).raise_for_status()
    entry = next(
        row
        for row in client.get("/api/objects/stock", headers=api_headers).json()
        if row["product_id"] == product
    )
    chore = create("chores", name="Native reader chore", period_type="daily")
    execution = client.post(f"/api/chores/{chore}/execute", headers=api_headers, json={})
    execution.raise_for_status()
    battery = create("batteries", name="Native reader battery", charge_interval_days=7)
    charge = client.post(f"/api/batteries/{battery}/charge", headers=api_headers, json={})
    charge.raise_for_status()
    category = create("task_categories", name="Native reader category")
    shopping = create("shopping_lists", name="Native reader list", description="Saved notes")
    item = create("shopping_list", shopping_list_id=shopping, product_id=product, amount=2)
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users", headers=api_headers, json={"username": "Native page reader", "password": ""}
    ).raise_for_status()
    user = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Native page reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": user}).json()[
        "api_key"
    ]
    for flag in ["stock", "chores", "tasks", "batteries", "shoppinglist"]:
        monkeypatch.setattr(get_settings(), "feature_flag_" + flag, False)
    return {
        "headers": {"GROCY-API-KEY": key},
        "product": product,
        "entry": entry["id"],
        "chore": chore,
        "execution": execution.json()["id"],
        "battery": battery,
        "charge": charge.json()["id"],
        "category": category,
        "shopping": shopping,
        "item": item,
        "user": user,
    }


def test_native_page_json_reads_expose_saved_data_without_module_grants(client, page_reader):
    data = page_reader
    product, entry, chore = data["product"], data["entry"], data["chore"]
    shopping, item = data["shopping"], data["item"]
    paths = [
        "/api/v2/chores/tracking/users",
        "/api/v2/chores/journal",
        "/api/v2/batteries/journal",
        f"/api/v2/chores/{chore}/editor",
        "/api/v2/tasks/form-context",
        "/api/v2/stock/journal",
        "/api/v2/stock/journal/summary",
        "/api/v2/stock/entries",
        f"/api/v2/stock/entries/{entry}/editor",
        f"/api/v2/products/form-options?product_id={product}",
        "/api/v2/content/products",
        f"/api/v2/content/products/{product}",
        "/api/v2/shopping-lists",
        f"/api/v2/shopping-lists/{shopping}",
        f"/api/v2/shopping-lists/items/editor?item_id={item}",
    ]
    for path in paths:
        assert client.get(path).status_code == 401, path
    responses = {path: client.get(path, headers=data["headers"]) for path in paths}
    assert {
        path: response.status_code
        for path, response in responses.items()
        if response.status_code != 200
    } == {}
    bodies = [responses[path].json() for path in paths]
    assert any(user["id"] == data["user"] for user in bodies[0])
    assert any(row["id"] == data["execution"] for row in bodies[1]["rows"])
    assert any(row["id"] == data["charge"] for row in bodies[2]["rows"])
    assert bodies[3]["chore"]["name"] == "Native reader chore"
    assert bodies[4]["current_user_id"] == data["user"]
    assert any(row["id"] == data["category"] for row in bodies[4]["categories"])
    for body in bodies[5:8]:
        assert any(row["product_id"] == product for row in body["rows"])
    assert bodies[8]["entry"]["product_name"] == "Native reader coffee"
    assert 1 in bodies[9]["references"]["location_id"]
    assert {"id": product, "html": "<strong>Saved description</strong>"} in bodies[10]
    assert bodies[11]["html"] == "<strong>Saved description</strong>"
    assert any(row["id"] == shopping for row in bodies[12])
    assert any(row["id"] == item for row in bodies[13]["items"])
    assert bodies[14]["item"]["id"] == item


def test_native_code_and_paper_reads_are_authenticated_presentation(client, page_reader):
    data = page_reader
    paths = [
        ("/api/v2/recipes/17/grocycode", "/recipe/17/grocycode"),
        (f"/api/v2/products/{data['product']}/grocycode", f"/product/{data['product']}/grocycode"),
        (f"/api/v2/chores/{data['chore']}/grocycode", f"/chore/{data['chore']}/grocycode"),
        (f"/api/v2/batteries/{data['battery']}/grocycode", f"/battery/{data['battery']}/grocycode"),
        (
            f"/api/v2/stock/entries/{data['entry']}/grocycode",
            f"/stockentry/{data['entry']}/grocycode",
        ),
    ]
    for path, legacy in paths:
        assert client.get(path).status_code == 401
        response = client.get(path, headers=data["headers"])
        assert response.status_code == 200, response.text
        assert response.headers["content-type"] == "image/png"
        assert response.content.startswith(b"\x89PNG\r\n\x1a\n")
        assert response.content == client.get(legacy, headers=data["headers"]).content
    for path, text in [
        (f"/api/v2/stock/entries/{data['entry']}/label", "Native reader coffee"),
        (f"/api/v2/shopping-lists/{data['shopping']}/print", "Native reader coffee"),
        (f"/api/v2/shopping-lists/{data['shopping']}/notes/editor", "Saved notes"),
    ]:
        assert client.get(path).status_code == 401
        response = client.get(path, headers=data["headers"])
        assert response.status_code == 200, response.text
        assert response.headers["content-type"].startswith("text/html")
        assert text in response.text


def test_rendering_draft_posts_do_not_authorize_product_or_notes_persistence(
    client, api_headers, page_reader
):
    data = page_reader
    before = client.get(f"/api/objects/products/{data['product']}", headers=api_headers).json()
    draft = "Unsaved presentation draft"
    for path, body in [
        ("/api/v2/content/products/editor", {"html": draft}),
        (f"/api/v2/shopping-lists/{data['shopping']}/print", {"html": draft, "visible": True}),
    ]:
        assert client.post(path, json=body).status_code == 401
        rendered = client.post(path, headers=data["headers"], json=body)
        assert rendered.status_code == 200, rendered.text
        assert draft in rendered.text
    for path, body in [
        (f"/api/objects/products/{data['product']}", {"description": draft}),
        (f"/api/objects/shopping_lists/{data['shopping']}", {"description": draft}),
    ]:
        assert client.put(path, headers=data["headers"], json=body).status_code == 403
    assert (
        client.get(f"/api/objects/products/{data['product']}", headers=api_headers).json() == before
    )
    assert (
        client.get(f"/api/objects/shopping_lists/{data['shopping']}", headers=api_headers).json()[
            "description"
        ]
        == "Saved notes"
    )


def test_native_reads_do_not_grant_neighboring_writes_or_users_page_access(
    client, api_headers, page_reader
):
    data = page_reader
    stock_before = client.get("/api/objects/stock", headers=api_headers).json()
    list_before = client.get("/api/objects/shopping_list", headers=api_headers).json()
    for method, path, body in [
        ("post", f"/api/stock/products/{data['product']}/add", {"amount": 1}),
        ("put", f"/api/stock/entry/{data['entry']}", {"amount": 99}),
        ("post", f"/api/chores/{data['chore']}/execute", {}),
        ("post", f"/api/chores/executions/{data['execution']}/undo", {}),
        ("post", f"/api/batteries/{data['battery']}/charge", {}),
        ("post", f"/api/batteries/charge-cycles/{data['charge']}/undo", {}),
        ("put", f"/api/objects/chores/{data['chore']}", {"name": "Denied"}),
        ("post", "/api/v2/shopping-lists/items", {"product_id": data["product"], "amount": 1}),
        ("post", f"/api/v2/shopping-lists/{data['shopping']}/items/{data['item']}/purchase", {}),
    ]:
        response = client.request(method, path, headers=data["headers"], json=body)
        expected = 400 if path.startswith("/api/chores/") else 403
        assert response.status_code == expected, (path, response.text)
    for path in ["/api/users", "/api/v2/users/overview", "/api/v2/users/new/form-context"]:
        assert client.get(path, headers=data["headers"]).status_code == 403
    assert client.get("/api/objects/stock", headers=api_headers).json() == stock_before
    assert client.get("/api/objects/shopping_list", headers=api_headers).json() == list_before


def test_native_shopping_context_keeps_raw_selection_sql_aliases_and_empty_lists(
    client, page_reader
):
    data = page_reader
    path = "/api/v2/shopping-lists/native-context"
    assert client.get(path).status_code == 401
    for query, selected, matches in [
        ("", 1, False),
        (f"?list=0{data['shopping']}", f"0{data['shopping']}", True),
        (f"?list={data['shopping']}e0", f"{data['shopping']}e0", True),
        (f"?list=invalid&list={data['shopping']}", str(data["shopping"]), True),
        (f"?list={data['shopping']}&list=unknown", "unknown", False),
        ("?list", "", False),
        ("?list=0x2", "0x2", False),
        ("?list=999999", "999999", False),
    ]:
        response = client.get(path + query, headers=data["headers"])
        assert response.status_code == 200, (query, response.text)
        body = response.json()
        assert body["list_id"] == selected
        assert EditorDocument(body["notes_document"]).options["initial"] == (
            "Saved notes" if matches else ""
        )
        if matches:
            assert body["list"]["id"] == data["shopping"]
            assert body["list"]["description"] == "Saved notes"
            assert [row["id"] for row in body["items"]] == [data["item"]]
            assert body["items"][0]["amount"] == body["items"][0]["stock_amount"] == 2
            assert body["items"][0]["display_factor"] == 1
        else:
            assert body["items"] == []
            if selected != 1:
                assert body["list"] is None
    # Preserve the existing modern integer route's not-found contract.
    assert client.get("/api/v2/shopping-lists/999999", headers=data["headers"]).status_code == 404


def test_native_shopping_context_uses_native_row_order_all_units_and_pdo_array_binding(
    client, api_headers, page_reader
):
    data = page_reader

    def create(table, **values):
        response = client.post(f"/api/objects/{table}", headers=api_headers, json=values)
        response.raise_for_status()
        return int(response.json()["created_object_id"])

    unit = create("quantity_units", name="Unused inactive native unit", active=0)
    box = create("quantity_units", name="Native reader box")
    create(
        "quantity_unit_conversions",
        product_id=data["product"],
        from_qu_id=box,
        to_qu_id=1,
        factor=6,
    )
    client.put(
        f"/api/objects/shopping_list/{data['item']}",
        headers=api_headers,
        json={"amount": 12, "qu_id": box, "done": 1},
    ).raise_for_status()
    product = create(
        "products", name="a first native product", location_id=1, qu_id_stock=1, qu_id_purchase=1
    )
    first = create("shopping_list", shopping_list_id=data["shopping"], product_id=product, amount=1)
    note = create(
        "shopping_list", shopping_list_id=data["shopping"], note="First native note", amount=1
    )
    inactive = create(
        "products",
        name="Inactive native choice",
        location_id=1,
        qu_id_stock=1,
        qu_id_purchase=1,
        active=0,
    )
    path = "/api/v2/shopping-lists/native-context"
    response = client.get(path + f"?list={data['shopping']}", headers=data["headers"])
    assert response.status_code == 200, response.text
    body = response.json()
    assert [row["id"] for row in body["items"]] == [note, first, data["item"]]
    converted = body["items"][-1]
    assert converted["amount"] == 2 and converted["stock_amount"] == 12
    assert converted["display_factor"] == pytest.approx(1 / 6)
    assert converted["done"] is True
    assert unit in [row["id"] for row in body["units"]]
    assert product in [row["id"] for row in body["products"]]
    assert inactive not in [row["id"] for row in body["products"]]
    assert any(row["id"] == data["shopping"] for row in body["lists"])
    numeric_array = client.get(path + f"?list[]={data['shopping']}", headers=data["headers"])
    assert numeric_array.status_code == 200, numeric_array.text
    assert numeric_array.json()["list_id"] == {"0": str(data["shopping"])}
    assert [row["id"] for row in numeric_array.json()["items"]] == [note, first, data["item"]]
    assert numeric_array.json()["list"] is None
    for query in ["?list[key]=1", "?list[]=1&list[]=2", "?list[::1]=1"]:
        invalid = client.get(path + query, headers=data["headers"])
        assert invalid.status_code == 500
        assert "column index out of range" in invalid.json()["error_message"]


def test_native_shopping_paper_uses_raw_rows_metadata_and_stock_unit_conversion(
    client, api_headers, page_reader, monkeypatch
):
    data = page_reader
    monkeypatch.setattr(get_settings(), "feature_flag_shoppinglist_multiple_lists", False)
    box = client.post(
        "/api/objects/quantity_units", headers=api_headers, json={"name": "Native paper box"}
    )
    box.raise_for_status()
    box_id = int(box.json()["created_object_id"])
    client.post(
        "/api/objects/quantity_unit_conversions",
        headers=api_headers,
        json={"product_id": data["product"], "from_qu_id": box_id, "to_qu_id": 1, "factor": 6},
    ).raise_for_status()
    client.put(
        f"/api/objects/shopping_list/{data['item']}",
        headers=api_headers,
        json={"amount": 12, "qu_id": box_id, "done": 1},
    ).raise_for_status()
    client.post(
        "/api/objects/shopping_list",
        headers=api_headers,
        json={"shopping_list_id": 1, "note": "Wrong DOM default list", "amount": 1},
    ).raise_for_status()
    monkeypatch.setattr(get_settings(), "base_path", "/pantry")
    path = "/pantry/api/v2/shopping-lists/native-print"
    assert client.get(path).status_code == 401
    for query, has_rows, has_metadata in [
        (f"list=0{data['shopping']}", True, True),
        (f"list={data['shopping']}e0", True, True),
        ("list=unknown", False, False),
        (f"list[]={data['shopping']}", True, False),
    ]:
        response = client.get(
            path + f"?{query}&header=true&grouped=false&layout=table", headers=data["headers"]
        )
        assert response.status_code == 200, response.text
        assert response.headers["content-type"].startswith("text/html")
        assert ("Native reader coffee" in response.text) is has_rows
        assert ('<span data-number="quantity">2</span>' in response.text) is has_rows
        assert ('<h3 class="text-center">Native reader list</h3>' in response.text) is has_metadata
        assert ("Saved notes" in response.text) is has_metadata
        assert "Wrong DOM default list" not in response.text
    assert (
        client.get(
            "/pantry/api/v2/shopping-lists/999999/print", headers=data["headers"]
        ).status_code
        == 404
    )


def test_native_shopping_paper_renders_live_draft_without_persisting_either_list(
    client, api_headers, page_reader
):
    data = page_reader
    before = client.get("/api/objects/shopping_lists", headers=api_headers).json()
    draft = {"html": "<strong>Unpersisted native print draft</strong>", "visible": True}
    path = "/api/v2/shopping-lists/native-print"
    assert client.post(path, json=draft).status_code == 401
    for query, has_rows in [(f"list[]={data['shopping']}", True), ("list=unknown", False)]:
        response = client.post(
            path + f"?{query}&header=false&layout=list", headers=data["headers"], json=draft
        )
        assert response.status_code == 200, response.text
        assert "<strong>Unpersisted native print draft</strong>" in response.text
        assert ("Native reader coffee" in response.text) is has_rows
        assert "Saved notes" not in response.text
        assert '<h3 class="text-center">Native reader list</h3>' not in response.text
    assert client.get("/api/objects/shopping_lists", headers=api_headers).json() == before
