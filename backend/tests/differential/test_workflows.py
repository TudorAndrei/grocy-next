"""Public workflows checked against both implementations of the pinned Grocy API."""

import base64
import os
import re
import sqlite3
from io import BytesIO
from uuid import uuid4

import httpx
import pytest


@pytest.fixture(params=["local", "php"])
def api(request, client, api_headers):
    if request.param == "local":
        client.headers.update(api_headers)
        yield client
        return
    url = os.getenv("GROCY_REFERENCE_URL")
    if not url:
        pytest.skip("Set GROCY_REFERENCE_URL for PHP comparison")
    if os.getenv("GROCY_REFERENCE_DISPOSABLE") != "1":
        pytest.fail("The reference database must be disposable")
    with httpx.Client(
        base_url=url,
        headers={"GROCY-API-KEY": os.environ["GROCY_REFERENCE_API_KEY"]},
        timeout=15,
    ) as reference:
        assert reference.get("/api/system/info").json()["grocy_version"]["Version"] == "4.5.0"
        yield reference


def create(api, resource, **fields):
    response = api.post(f"/api/objects/{resource}", json=fields)
    assert response.status_code == 200, response.text
    return int(response.json()["created_object_id"])


def rows(api, entity, **filters):
    response = api.get(
        f"/api/objects/{entity}",
        params=[("query[]", f"{key}={value}") for key, value in filters.items()],
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def catalog(api):
    name = f"Parity {uuid4().hex}"
    unit = create(api, "quantity_units", name=name)
    other = create(api, "quantity_units", name=name + " small")
    location = create(api, "locations", name=name)
    product = create(
        api, "products", name=name, location_id=location, qu_id_stock=unit, qu_id_purchase=unit
    )
    return product, unit, other, location


def test_file_creation_preserves_existing_content(api, tmp_path, monkeypatch):
    from grocy.core.config import get_settings

    monkeypatch.setattr(get_settings(), "files_root", tmp_path)
    name = f"{uuid4().hex}.txt"
    encoded = base64.b64encode(name.encode()).decode()
    path = f"/api/files/productpictures/{encoded}"
    assert api.put(path, content=b"first").status_code == 204
    try:
        assert api.put(path, content=b"second").status_code == 400
        response = api.get(path)
        assert response.content == b"first"
        assert response.headers["content-disposition"] == f'inline; filename="{name}"'
        assert response.headers["cache-control"] == "max-age=2592000"
    finally:
        assert api.delete(path).status_code == 204


def test_picture_mode_preserves_format_and_controls_resize(api, tmp_path, monkeypatch):
    from PIL import Image

    from grocy.core.config import get_settings

    monkeypatch.setattr(get_settings(), "files_root", tmp_path)
    original = BytesIO()
    Image.new("RGB", (100, 50), "red").save(original, "JPEG")
    name = base64.b64encode(f"{uuid4().hex}.jpg".encode()).decode()
    path = f"/api/files/productpictures/{name}"
    assert api.put(path, content=original.getvalue()).status_code == 204
    try:
        assert api.get(path, params={"best_fit_width": 20}).content == original.getvalue()
        response = api.get(
            path,
            params={"force_serve_as": "picture", "best_fit_width": 20, "best_fit_height": 20},
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/jpeg"
        with Image.open(BytesIO(response.content)) as picture:
            assert picture.size == (20, 10)
        assert api.get(path).content == original.getvalue()
    finally:
        assert api.delete(path).status_code == 204


@pytest.mark.parametrize(
    ("values", "query", "order", "expected"),
    [
        (["ABC", "AXXC"], "name~A_C", "id", [0]),
        (["ÄBC", "äBC"], "name~äBC", "id", [1]),
        ([None, "text", "null"], "description!=null", "id", [0, 1]),
        ([None, "text", "null"], "description=null", "id", [0, 2]),
        ([None, "text"], None, "description:asc", [0, 1]),
    ],
)
def test_list_queries_follow_sqlite_comparison_rules(api, values, query, order, expected):
    group = uuid4().hex
    ids = [
        create(
            api,
            "locations",
            name=value if query and query.startswith("name") else f"{group} {index}",
            **({"description": value} if value is not None else {}),
        )
        for index, value in enumerate(values)
    ]
    params = [("order", order), ("query[]", f"id>={ids[0]}"), ("query[]", f"id<={ids[-1]}")]
    if query:
        params.append(("query[]", query))
    response = api.get("/api/objects/locations", params=params)
    assert response.status_code == 200, response.text
    assert [row["id"] for row in response.json()] == [ids[index] for index in expected]


def test_text_filters_keep_leading_zeros(api, catalog):
    product, *_ = catalog
    barcode = create(api, "product_barcodes", product_id=product, barcode="00123")
    response = api.get(
        "/api/objects/product_barcodes",
        params=[("query[]", f"id={barcode}"), ("query[]", "barcode=123")],
    )
    assert response.status_code == 200, response.text
    assert response.json() == []


def test_user_dto_shapes_and_permission_row_ids(api):
    response = api.get("/api/user")
    assert response.status_code == 200
    current = response.json()
    assert isinstance(current, list) and len(current) == 1
    name = uuid4().hex
    assert api.post("/api/users", json={"username": name, "password": "keep"}).status_code == 204
    users = api.get("/api/users", params={"query[]": f"username={name}"}).json()
    assert len(users) == 1
    user = users[0]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", user["row_created_timestamp"])
    assert user["first_name"] is None
    assert user["last_name"] is None
    assert user["picture_file_name"] is None
    assert user["display_name"] == name
    permissions = api.get(f"/api/users/{user['id']}/permissions").json()
    assert len(permissions) == 1
    assert permissions[0]["permission_id"] == 1
    assert permissions[0]["user_id"] == user["id"]
    assert isinstance(permissions[0]["id"], int)


def test_authenticated_access_without_module_permissions(api, catalog):
    product, *_ = catalog
    recipe = create(api, "recipes", name=uuid4().hex)
    chore = create(api, "chores", name=uuid4().hex, period_type="manually")
    username = uuid4().hex
    assert (
        api.post("/api/users", json={"username": username, "password": "test"}).status_code == 204
    )
    user = api.get("/api/users", params={"query[]": f"username={username}"}).json()[0]["id"]
    assert api.put(f"/api/users/{user}/permissions", json={"permissions": []}).status_code == 204
    reference_url = os.getenv("GROCY_REFERENCE_URL")
    if reference_url and api.base_url == httpx.URL(reference_url):
        key = uuid4().hex
        with sqlite3.connect(os.environ["GROCY_REFERENCE_DATABASE"]) as database:
            database.execute(
                "INSERT INTO api_keys (api_key, user_id, expires) "
                "VALUES (?, ?, '2999-12-31 23:59:59')",
                (key, user),
            )
    else:
        key = api.post("/api/v2/api-keys", json={"user_id": user}).json()["api_key"]
    original = api.headers["GROCY-API-KEY"]
    api.headers["GROCY-API-KEY"] = key
    try:
        for path in (
            "/api/stock",
            "/api/stock/volatile",
            f"/api/stock/products/{product}",
            "/api/chores",
            f"/api/chores/{chore}",
            "/api/tasks",
            "/api/batteries",
            f"/api/recipes/{recipe}/fulfillment",
            "/api/recipes/fulfillment",
            "/api/objects/products",
            f"/api/userfields/products/{product}",
            "/api/calendar/ical",
            "/api/calendar/ical/sharing-link",
            "/api/system/config",
        ):
            response = api.get(path)
            assert response.status_code == 200, (path, response.text)
        assert api.get("/api/users").status_code == 403
        assert api.post(f"/api/stock/products/{product}/add", json={"amount": 1}).status_code == 403
        assert api.post("/api/objects/products", json={"name": uuid4().hex}).status_code == 403
        assert api.post(f"/api/recipes/{recipe}/copy").status_code == 200
        response = api.post(
            "/api/chores/executions/calculate-next-assignments", json={"chore_id": chore}
        )
        assert response.status_code == 204, response.text
    finally:
        api.headers["GROCY-API-KEY"] = original


@pytest.mark.parametrize(
    ("method", "suffix", "body"),
    [
        ("GET", "", None),
        ("GET", "/price-history", None),
        ("POST", "/add", {"amount": 1}),
        ("POST", "/consume", {"amount": 1}),
        ("POST", "/open", {"amount": 1}),
        ("POST", "/inventory", {"new_amount": 3}),
        ("POST", "/transfer", {"amount": 1}),
    ],
)
def test_inactive_products_reject_stock_actions(api, catalog, method, suffix, body):
    product, _, _, location = catalog
    path = f"/api/stock/products/{product}"
    assert api.post(path + "/add", json={"amount": 2}).status_code == 200
    assert api.put(f"/api/objects/products/{product}", json={"active": 0}).status_code == 204
    assert api.get(f"/api/objects/products/{product}").json()["active"] == 0
    assert api.get(path + "/entries").status_code == 200
    if suffix == "/transfer":
        destination = create(api, "locations", name=uuid4().hex)
        body = {**body, "location_id_from": location, "location_id_to": destination}
    response = api.request(method, path + suffix, json=body)
    assert response.status_code == 400, response.text


def test_chore_consumption_uses_gross_tare_amount(api, catalog):
    product, *_ = catalog
    assert (
        api.put(
            f"/api/objects/products/{product}",
            json={"enable_tare_weight_handling": 1, "tare_weight": 100},
        ).status_code
        == 204
    )
    path = f"/api/stock/products/{product}"
    assert api.post(path + "/add", json={"amount": 1100}).status_code == 200
    chore = create(
        api,
        "chores",
        name=uuid4().hex,
        period_type="manually",
        consume_product_on_execution=1,
        product_id=product,
        product_amount=600,
    )
    response = api.post(f"/api/chores/{chore}/execute", json={})
    assert response.status_code == 200, response.text
    assert api.get(path).json()["stock_amount"] == 500
    assert (
        api.put(
            f"/api/objects/chores/{chore}",
            json={"product_amount": 2000, "rescheduled_date": "2030-02-03 14:15:16"},
        ).status_code
        == 204
    )
    failed = api.post(f"/api/chores/{chore}/execute", json={})
    assert failed.status_code == 400, failed.text
    assert len(rows(api, "chores_log", chore_id=chore)) == 2
    assert api.get(path).json()["stock_amount"] == 500
    assert (
        api.get(f"/api/objects/chores/{chore}").json()["rescheduled_date"].startswith("2030-02-03")
    )


@pytest.mark.parametrize(
    "entity,action,log_entity",
    [
        ("chores", "execute", "chores_log"),
        ("batteries", "charge", "battery_charge_cycles"),
    ],
)
def test_household_actions_return_the_stored_log(api, entity, action, log_entity):
    item = create(
        api, entity, name=uuid4().hex, **({"period_type": "manually"} if entity == "chores" else {})
    )
    response = api.post(
        f"/api/{entity}/{item}/{action}",
        json={"tracked_time": "2027-02-03 14:15:16"},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["tracked_time"] == "2027-02-03 14:15:16"
    stored = api.get(f"/api/objects/{log_entity}/{payload['id']}").json()
    stored.pop("userfields", None)
    assert payload == stored


def test_least_done_assignment_breaks_ties_by_user_id(api):
    ids = []
    for prefix in ("Z", "A"):
        username = prefix + uuid4().hex
        assert (
            api.post("/api/users", json={"username": username, "password": "test"}).status_code
            == 204
        )
        ids.append(
            api.get("/api/users", params={"query[]": f"username={username}"}).json()[0]["id"]
        )
    chore = create(
        api,
        "chores",
        name=uuid4().hex,
        period_type="manually",
        assignment_type="who-least-did-first",
        assignment_config=",".join(map(str, ids)),
    )
    response = api.post(
        "/api/chores/executions/calculate-next-assignments", json={"chore_id": chore}
    )
    assert response.status_code == 204, response.text
    result = api.get(f"/api/chores/{chore}").json()
    assigned = result["next_execution_assigned_user"]
    assert assigned["id"] == ids[0]
    users = api.get("/api/users", params={"query[]": f"id={ids[0]}"}).json()
    assert assigned == users[0]
    assert (
        api.put(
            f"/api/objects/chores/{chore}",
            json={"rescheduled_next_execution_assigned_to_user_id": ids[1]},
        ).status_code
        == 204
    )
    assert api.get(f"/api/chores/{chore}").json()["next_execution_assigned_user"]["id"] == ids[0]
    response = api.post(
        "/api/chores/executions/calculate-next-assignments", json={"chore_id": chore}
    )
    assert response.status_code == 204, response.text
    assert api.get(f"/api/chores/{chore}").json()["next_execution_assigned_user"]["id"] == ids[1]


def test_stock_unit_change_converts_history_and_undo(api, catalog):
    product, unit, other, _ = catalog
    create(api, "quantity_unit_conversions", from_qu_id=unit, to_qu_id=other, factor=10)
    base = f"/api/stock/products/{product}"
    assert api.post(base + "/add", json={"amount": 2, "price": 4}).status_code == 200
    used = api.post(base + "/consume", json={"amount": 1})
    assert used.status_code == 200, used.text
    assert (
        api.put(f"/api/objects/products/{product}", json={"qu_id_stock": other}).status_code == 204
    )
    details = api.get(base).json()
    assert details["stock_amount"] == 10
    assert details["last_price"] == pytest.approx(0.4)
    logs = rows(api, "stock_log", product_id=product)
    assert sorted(log["amount"] for log in logs) == [-10, 20]
    assert api.post(f"/api/stock/bookings/{used.json()[0]['id']}/undo").status_code == 204
    entries = api.get(base + "/entries").json()
    assert sum(row["amount"] for row in entries) == 20
    assert all(row["price"] == pytest.approx(0.4) for row in entries)


def test_stock_unit_change_requires_conversion_after_purchase(api, catalog):
    product, unit, other, _ = catalog
    base = f"/api/stock/products/{product}"
    assert api.post(base + "/add", json={"amount": 2}).status_code == 200
    response = api.put(f"/api/objects/products/{product}", json={"qu_id_stock": other})
    assert response.status_code == 400, response.text
    assert api.get(f"/api/objects/products/{product}").json()["qu_id_stock"] == unit
    assert api.get(base).json()["stock_amount"] == 2


def test_conversion_inverse_tracks_edits_and_delete(api, catalog):
    _, unit, other, _ = catalog
    conversion = create(
        api, "quantity_unit_conversions", from_qu_id=unit, to_qu_id=other, factor=10
    )
    inverse = rows(api, "quantity_unit_conversions", from_qu_id=other, to_qu_id=unit)
    assert len(inverse) == 1
    assert inverse[0]["factor"] == pytest.approx(0.1)
    assert (
        api.put(
            f"/api/objects/quantity_unit_conversions/{conversion}", json={"factor": 4}
        ).status_code
        == 204
    )
    assert rows(api, "quantity_unit_conversions", from_qu_id=other, to_qu_id=unit)[0][
        "factor"
    ] == pytest.approx(0.25)
    assert api.delete(f"/api/objects/quantity_unit_conversions/{conversion}").status_code == 204
    assert rows(api, "quantity_unit_conversions", from_qu_id=other, to_qu_id=unit) == []


def test_catalog_defaults_and_zero_shopping_amount(api, catalog):
    product, unit, _, _ = catalog
    assert api.get(f"/api/objects/products/{product}").json()["treat_opened_as_out_of_stock"] == 1
    barcode = create(api, "product_barcodes", product_id=product, barcode=uuid4().hex)
    assert api.get(f"/api/objects/product_barcodes/{barcode}").json()["qu_id"] == unit
    recipe = create(api, "recipes", name=uuid4().hex)
    ingredient = create(api, "recipes_pos", recipe_id=recipe, product_id=product, amount=2)
    assert api.get(f"/api/objects/recipes_pos/{ingredient}").json()["qu_id"] == unit
    item = create(api, "shopping_list", product_id=product, amount=0)
    assert api.get(f"/api/objects/shopping_list/{item}").json()["qu_id"] == unit


def test_delete_product_cascades_current_records(api, catalog):
    product, unit, _, _ = catalog
    recipe = create(api, "recipes", name=uuid4().hex, product_id=product)
    create(api, "recipes_pos", recipe_id=recipe, product_id=product, amount=2, qu_id=unit)
    create(api, "product_barcodes", product_id=product, barcode=uuid4().hex)
    create(api, "shopping_list", product_id=product, amount=1)
    assert api.post(f"/api/stock/products/{product}/add", json={"amount": 2}).status_code == 200
    assert api.delete(f"/api/objects/products/{product}").status_code == 204
    assert api.get(f"/api/objects/recipes/{recipe}").json()["product_id"] is None
    for entity in ("stock", "stock_log", "product_barcodes", "shopping_list", "recipes_pos"):
        assert rows(api, entity, product_id=product) == []


def test_meal_plan_internal_recipes_follow_servings(api, catalog):
    product, unit, _, _ = catalog
    recipe = create(api, "recipes", name=uuid4().hex, base_servings=2)
    create(api, "recipes_pos", recipe_id=recipe, product_id=product, amount=6, qu_id=unit)
    day = "2036-03-17"
    entry = create(api, "meal_plan", day=day, type="recipe", recipe_id=recipe, recipe_servings=4)
    day_recipes = rows(api, "recipes", name=day, type="mealplan-day")
    assert len(day_recipes) == 1
    resolved = rows(api, "recipes_pos_resolved", recipe_id=day_recipes[0]["id"])
    assert resolved[0]["recipe_amount"] == 12
    shadow = rows(api, "recipes", name=f"{day}#{entry}", type="mealplan-shadow")
    assert len(shadow) == 1
    assert (
        api.put(f"/api/objects/recipes/{recipe}", json={"product_id": product}).status_code == 204
    )
    assert api.post(f"/api/recipes/{shadow[0]['id']}/consume").status_code == 204
    assert api.get(f"/api/stock/products/{product}").json()["stock_amount"] == 4
    assert (
        api.put(f"/api/objects/meal_plan/{entry}", json={"recipe_servings": 2}).status_code == 204
    )
    day_recipe = rows(api, "recipes", name=day, type="mealplan-day")[0]
    assert rows(api, "recipes_pos_resolved", recipe_id=day_recipe["id"])[0]["recipe_amount"] == 6
    assert api.delete(f"/api/objects/meal_plan/{entry}").status_code == 204
    day_recipe = rows(api, "recipes", name=day, type="mealplan-day")[0]
    assert rows(api, "recipes_pos_resolved", recipe_id=day_recipe["id"]) == []


def test_recipe_shopping_excludes_supplied_product_ids(api, catalog):
    product, unit, _, location = catalog
    other_product = create(
        api,
        "products",
        name=uuid4().hex,
        location_id=location,
        qu_id_stock=unit,
        qu_id_purchase=unit,
    )
    recipe = create(api, "recipes", name=uuid4().hex)
    for product_id in (product, other_product):
        create(api, "recipes_pos", recipe_id=recipe, product_id=product_id, amount=2, qu_id=unit)
    response = api.post(
        f"/api/recipes/{recipe}/add-not-fulfilled-products-to-shoppinglist",
        json={"excludedProductIds": [product]},
    )
    assert response.status_code == 204, response.text
    assert rows(api, "shopping_list", product_id=product) == []
    assert rows(api, "shopping_list", product_id=other_product)[0]["amount"] == 2


def test_inventory_increase_uses_last_price_and_store(api, catalog):
    product, _, _, _ = catalog
    store = create(api, "shopping_locations", name=uuid4().hex)
    base = f"/api/stock/products/{product}"
    assert (
        api.post(
            base + "/add", json={"amount": 2, "price": 3, "shopping_location_id": store}
        ).status_code
        == 200
    )
    inventory = api.post(base + "/inventory", json={"new_amount": 4})
    assert inventory.status_code == 200, inventory.text
    assert inventory.json()[0]["price"] == 3
    assert inventory.json()[0]["shopping_location_id"] == store


def test_stock_entry_label_has_product_details_and_entry(api, catalog):
    product, _, _, _ = catalog
    base = f"/api/stock/products/{product}"
    assert (
        api.post(base + "/add", json={"amount": 2, "best_before_date": "2036-01-01"}).status_code
        == 200
    )
    entry = api.get(base + "/entries").json()[0]
    label = api.get(f"/api/stock/entry/{entry['id']}/printlabel").json()
    assert label["details"]["product"]["id"] == product
    assert label["stock_entry"]["stock_id"] == entry["stock_id"]
    assert label["due_date"] == "DD: 2036-01-01"


def test_recipe_fulfillment_has_costs_calories_and_price_state(api, catalog):
    product, unit, _, _ = catalog
    assert api.put(f"/api/objects/products/{product}", json={"calories": 80}).status_code == 204
    assert (
        api.post(f"/api/stock/products/{product}/add", json={"amount": 3, "price": 2}).status_code
        == 200
    )
    recipe = create(api, "recipes", name=uuid4().hex, base_servings=2)
    create(api, "recipes_pos", recipe_id=recipe, product_id=product, amount=2, qu_id=unit)
    response = api.get(f"/api/recipes/{recipe}/fulfillment")
    assert response.status_code == 200
    result = response.json()
    assert result["costs_per_serving"] == 2
    assert result["calories"] == 80
    assert result["prices_incomplete"] == 0
    assert result["need_fulfilled"] == 1
    assert (
        result["product_names_comma_separated"]
        == api.get(f"/api/objects/products/{product}").json()["name"]
    )


def test_shopping_api_preserves_the_requested_unit(api, catalog):
    product, unit, other, _ = catalog
    create(
        api,
        "quantity_unit_conversions",
        product_id=product,
        from_qu_id=other,
        to_qu_id=unit,
        factor=10,
    )
    assert (
        api.put(f"/api/objects/products/{product}", json={"qu_id_purchase": other}).status_code
        == 204
    )
    body = {"product_id": product, "product_amount": 2, "note": "first"}
    assert api.post("/api/stock/shoppinglist/add-product", json=body).status_code == 204
    item = rows(api, "shopping_list", product_id=product)[0]
    assert (item["amount"], item["qu_id"]) == (2, other)
    assert (
        api.post(
            "/api/stock/shoppinglist/add-product", json={"product_id": product, "product_amount": 1}
        ).status_code
        == 204
    )
    item = rows(api, "shopping_list", product_id=product)[0]
    assert item["amount"] == 3
    assert item["note"] is None


def test_minimum_stock_setting_adds_shopping_after_consumption(api, catalog):
    product, unit, _, _ = catalog
    shopping_list = create(api, "shopping_lists", name=uuid4().hex)
    settings = {
        "shopping_list_auto_add_below_min_stock_amount": True,
        "shopping_list_auto_add_below_min_stock_amount_list_id": shopping_list,
    }
    for key, value in settings.items():
        assert api.put(f"/api/user/settings/{key}", json={"value": value}).status_code == 204
    try:
        assert api.post(f"/api/stock/products/{product}/add", json={"amount": 3}).status_code == 200
        assert (
            api.put(f"/api/objects/products/{product}", json={"min_stock_amount": 2}).status_code
            == 204
        )
        assert (
            api.post(f"/api/stock/products/{product}/consume", json={"amount": 2}).status_code
            == 200
        )
        item = rows(api, "shopping_list", product_id=product)[0]
        assert (item["amount"], item["qu_id"], item["shopping_list_id"]) == (1, unit, shopping_list)
        assert (
            api.post(f"/api/stock/products/{product}/consume", json={"amount": 1}).status_code
            == 200
        )
        assert rows(api, "shopping_list", product_id=product)[0]["amount"] == 2
    finally:
        for key in settings:
            assert api.delete(f"/api/user/settings/{key}").status_code == 204


def test_merge_products_converts_quantities_and_output_references(api, catalog):
    product, unit, other, location = catalog
    keep = create(
        api,
        "products",
        name=uuid4().hex,
        location_id=location,
        qu_id_stock=other,
        qu_id_purchase=other,
    )
    create(
        api,
        "quantity_unit_conversions",
        product_id=product,
        from_qu_id=unit,
        to_qu_id=other,
        factor=10,
    )
    recipe = create(api, "recipes", name=uuid4().hex, product_id=product)
    create(api, "recipes_pos", recipe_id=recipe, product_id=product, amount=2, qu_id=unit)
    assert (
        api.post(f"/api/stock/products/{product}/add", json={"amount": 2, "price": 4}).status_code
        == 200
    )
    merged = api.post(f"/api/stock/products/{keep}/merge/{product}")
    assert merged.status_code == 204, merged.text
    assert api.get(f"/api/stock/products/{keep}").json()["stock_amount"] == 20
    assert api.get(f"/api/objects/recipes/{recipe}").json()["product_id"] == keep
    assert rows(api, "recipes_pos", recipe_id=recipe)[0]["amount"] == 20


def test_presence_only_recipe_keeps_an_unrelated_shopping_unit(api, catalog):
    product, unit, other, location = catalog
    recipe = create(api, "recipes", name=uuid4().hex)
    create(
        api,
        "recipes_pos",
        recipe_id=recipe,
        product_id=product,
        amount=2,
        qu_id=other,
        only_check_single_unit_in_stock=1,
    )
    response = api.post(
        f"/api/recipes/{recipe}/add-not-fulfilled-products-to-shoppinglist", json={}
    )
    assert response.status_code == 204, response.text
    item = rows(api, "shopping_list", product_id=product)[0]
    assert (item["amount"], item["qu_id"]) == (2, other)
    second_product = create(
        api,
        "products",
        name=uuid4().hex,
        location_id=location,
        qu_id_stock=unit,
        qu_id_purchase=other,
    )
    conversions = rows(api, "quantity_unit_conversions", product_id=second_product)
    assert {(row["from_qu_id"], row["to_qu_id"]) for row in conversions} == {
        (unit, other),
        (other, unit),
    }


def test_inventory_counts_all_locations_and_rejects_an_unchanged_count(api, catalog):
    product, _, _, location = catalog
    second = create(api, "locations", name=uuid4().hex)
    base = f"/api/stock/products/{product}"
    for place, amount in ((location, 5), (second, 3)):
        assert (
            api.post(base + "/add", json={"amount": amount, "location_id": place}).status_code
            == 200
        )
    assert (
        api.post(base + "/inventory", json={"new_amount": 2, "location_id": location}).status_code
        == 200
    )
    assert api.get(base).json()["stock_amount"] == 2
    assert api.post(base + "/inventory", json={"new_amount": 2}).status_code == 400


def test_shopping_removal_uses_the_configured_decimal_threshold(api, catalog):
    product, unit, _, _ = catalog
    item = create(api, "shopping_list", product_id=product, amount=1.005, qu_id=unit)
    assert (
        api.put("/api/user/settings/stock_decimal_places_amounts", json={"value": 2}).status_code
        == 204
    )
    try:
        assert (
            api.post(
                "/api/stock/shoppinglist/remove-product",
                json={"product_id": product, "product_amount": 1},
            ).status_code
            == 204
        )
        assert api.get(f"/api/objects/shopping_list/{item}").status_code == 404
    finally:
        assert api.delete("/api/user/settings/stock_decimal_places_amounts").status_code == 204


def test_child_stock_locations_keep_each_product_id(api, catalog):
    product, unit, _, location = catalog
    child = create(
        api,
        "products",
        name=uuid4().hex,
        location_id=location,
        qu_id_stock=unit,
        qu_id_purchase=unit,
        parent_product_id=product,
    )
    for identifier, amount in ((product, 2), (child, 3)):
        assert (
            api.post(f"/api/stock/products/{identifier}/add", json={"amount": amount}).status_code
            == 200
        )
    response = api.get(
        f"/api/stock/products/{product}/locations", params={"include_sub_products": True}
    )
    assert response.status_code == 200
    assert sorted((row["product_id"], row["amount"]) for row in response.json()) == [
        (product, 2),
        (child, 3),
    ]


def test_equivalent_purchases_compact_and_follow_reference_undo(api, catalog):
    product, _, _, _ = catalog
    base = f"/api/stock/products/{product}"
    bookings = []
    for amount in (2, 3):
        response = api.post(
            base + "/add",
            json={"amount": amount, "price": 2, "best_before_date": "2037-01-01", "note": "{"},
        )
        assert response.status_code == 200, response.text
        bookings.append(response.json()[0]["id"])
    entries = api.get(base + "/entries").json()
    assert len(entries) == 1
    assert entries[0]["amount"] == 5
    logs = rows(api, "stock_log", product_id=product)
    assert len({row["stock_id"] for row in logs}) == 1
    for booking, expected in zip(reversed(bookings), (0, 0), strict=True):
        assert api.post(f"/api/stock/bookings/{booking}/undo").status_code == 204
        assert api.get(base).json()["stock_amount"] == expected


def test_stock_custom_fields_use_booking_transactions_and_prevent_compaction(api, catalog):
    product, _, _, _ = catalog
    field = "batch_" + uuid4().hex
    create(api, "userfields", entity="stock", name=field, caption="Batch", type="text-single-line")
    base = f"/api/stock/products/{product}"
    body = {"amount": 2, "price": 2, "best_before_date": "2037-02-01"}
    purchase = api.post(base + "/add", json=body)
    assert purchase.status_code == 200
    entry = api.get(base + "/entries").json()[0]
    path = f"/api/userfields/stock/{entry['stock_id']}"
    response = api.put(
        f"/api/userfields/stock/{purchase.json()[0]['transaction_id']}", json={field: "Batch A"}
    )
    assert response.status_code == 204, response.text
    assert api.get(path).json() == {field: "Batch A"}
    assert api.post(base + "/add", json=body).status_code == 200
    assert len(api.get(base + "/entries").json()) == 2
    stored = api.get(f"/api/objects/stock/{entry['id']}").json()
    assert stored["userfields"] == {field: "Batch A"}


@pytest.mark.parametrize(("mode", "amounts"), [(0, [2.5]), (1, [2.5]), (2, [1, 1])])
def test_stock_labels_follow_php_modes_and_fractional_amounts(api, catalog, mode, amounts):
    product, _, _, _ = catalog
    response = api.post(
        f"/api/stock/products/{product}/add", json={"amount": 2.5, "stock_label_type": mode}
    )
    assert response.status_code == 200, response.text
    assert [row["amount"] for row in response.json()] == amounts
    assert api.get(f"/api/stock/products/{product}").json()["stock_amount"] == sum(amounts)


def test_full_transfer_undo_uses_grocy_default_location_and_open_state(api, catalog):
    product, _, _, default_location = catalog
    source = create(api, "locations", name=uuid4().hex)
    store = create(api, "shopping_locations", name=uuid4().hex)
    base = f"/api/stock/products/{product}"
    assert (
        api.post(
            base + "/add", json={"amount": 3, "location_id": source, "shopping_location_id": store}
        ).status_code
        == 200
    )
    assert api.post(base + "/open", json={"amount": 3}).status_code == 200
    transfer = api.post(
        base + "/transfer",
        json={"amount": 3, "location_id_from": source, "location_id_to": default_location},
    )
    assert transfer.status_code == 200
    assert api.post(f"/api/stock/bookings/{transfer.json()[0]['id']}/undo").status_code == 204
    entry = api.get(base + "/entries").json()[0]
    assert (
        entry["amount"],
        entry["location_id"],
        entry["open"],
        entry["shopping_location_id"],
    ) == (3, default_location, 0, None)


def test_recipe_copy_uses_the_grocy_name_and_serving_defaults(api, catalog):
    product, unit, _, _ = catalog
    name = uuid4().hex
    recipe = create(api, "recipes", name=name, base_servings=2)
    assert (
        api.put(f"/api/objects/recipes/{recipe}", json={"desired_servings": 6}).status_code == 204
    )
    create(
        api, "recipes_pos", recipe_id=recipe, product_id=product, amount=1.5, qu_id=unit, round_up=1
    )
    response = api.post(f"/api/recipes/{recipe}/copy")
    assert response.status_code == 200
    copied = response.json()["created_object_id"]
    row = api.get(f"/api/objects/recipes/{copied}").json()
    assert row["name"] == f"Copy of {name}"
    assert row["desired_servings"] == 2
    ingredient = rows(api, "recipes_pos", recipe_id=copied)[0]
    assert (ingredient["amount"], ingredient["round_up"]) == (1.5, 0)


def test_stock_edit_undo_after_consumption_restores_the_original_amount(api, catalog):
    product, _, _, _ = catalog
    base = f"/api/stock/products/{product}"
    assert api.post(base + "/add", json={"amount": 4, "price": 2}).status_code == 200
    assert api.post(base + "/consume", json={"amount": 1}).status_code == 200
    entry = api.get(base + "/entries").json()[0]
    edited = api.put(
        f"/api/stock/entry/{entry['id']}",
        json={"amount": 5, "price": 3, "open": False, "purchased_date": entry["purchased_date"]},
    )
    assert edited.status_code == 200, edited.text
    assert api.post(base + "/consume", json={"amount": 1}).status_code == 200
    undone = api.post(f"/api/stock/bookings/{edited.json()[0]['id']}/undo")
    assert undone.status_code == 204, undone.text
    assert api.get(base).json()["stock_amount"] == 3
    assert api.get(base + "/entries").json()[0]["price"] == 2
