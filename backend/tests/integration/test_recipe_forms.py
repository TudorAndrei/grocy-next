import pytest
from sqlalchemy import text

from grocy.core.config import get_settings
from grocy.db.session import get_session_factory


def create(client, table, **values):
    response = client.post(f"/api/objects/{table}", json=values)
    response.raise_for_status()
    return int(response.json()["created_object_id"])


@pytest.fixture
def recipe_forms(client, api_headers):
    client.headers.update(api_headers)
    stock = create(client, "quantity_units", name="Context Zulu", name_plural="Context Zulus")
    purchase = create(client, "quantity_units", name="Context alpha")
    hidden = create(client, "quantity_units", name="Context Hidden", active=0)
    active = create(
        client,
        "products",
        name="Context Zulu product",
        location_id=1,
        qu_id_stock=stock,
        qu_id_purchase=purchase,
    )
    inactive = create(
        client,
        "products",
        name="Context alpha product",
        location_id=1,
        qu_id_stock=stock,
        qu_id_purchase=purchase,
        active=0,
    )
    first = create(
        client,
        "recipes",
        name="Context Zulu recipe",
        description="<p>Raw preparation</p>",
        base_servings=2.5,
        desired_servings=5,
        product_id=active,
    )
    other = create(client, "recipes", name="Context alpha recipe")
    special = create(client, "recipes", name="Context hidden recipe", type="mealplan-day")
    position = create(
        client,
        "recipes_pos",
        recipe_id=first,
        product_id=active,
        amount=1.25,
        qu_id=stock,
        note="<em>Raw note</em>",
        ingredient_group="Sauce",
        variable_amount="to taste",
        price_factor=0.5,
        round_up=1,
    )
    foreign_position = create(
        client, "recipes_pos", recipe_id=other, product_id=inactive, amount=3, qu_id=stock
    )
    nesting = create(
        client, "recipes_nestings", recipe_id=first, includes_recipe_id=other, servings=2.5
    )
    create(client, "product_barcodes", product_id=inactive, barcode="CONTEXT-CODE")
    create(client, "product_barcodes", product_id=active, barcode="ACTIVE-CODE")
    create(
        client,
        "userfields",
        entity="recipes",
        name="last",
        caption="Last",
        type="text-single-line",
        sort_number=3,
    )
    create(
        client,
        "userfields",
        entity="recipes",
        name="first",
        caption="First",
        type="text-single-line",
    )
    create(
        client,
        "userfields",
        entity="products",
        name="first",
        caption="Product first",
        type="text-single-line",
    )
    client.put(
        f"/api/userfields/recipes/{first}", json={"first": "Recipe-only value"}
    ).raise_for_status()
    client.put(
        f"/api/userfields/products/{active}", json={"first": "Do not leak"}
    ).raise_for_status()

    async def retain_cache():
        async with get_session_factory()() as session:
            await session.execute(
                text(
                    "UPDATE cache__quantity_unit_conversions_resolved SET factor='0.123456789123' "
                    "WHERE product_id=:product AND from_qu_id=:stock AND to_qu_id=:purchase"
                ),
                {"product": active, "stock": stock, "purchase": purchase},
            )
            await session.execute(
                text(
                    "INSERT INTO cache__quantity_unit_conversions_resolved"
                    "(product_id,from_qu_id,to_qu_id,factor) VALUES (NULL,:stock,:hidden,'7')"
                ),
                {"stock": stock, "hidden": hidden},
            )
            await session.commit()

    assert client.portal is not None
    client.portal.call(retain_cache)
    return {
        "client": client,
        "stock": stock,
        "purchase": purchase,
        "hidden": hidden,
        "active": active,
        "inactive": inactive,
        "first": first,
        "other": other,
        "special": special,
        "position": position,
        "foreign_position": foreign_position,
        "nesting": nesting,
    }


def test_recipe_editor_context_reads_native_collections_saved_cache_and_namespace(recipe_forms):
    data = recipe_forms
    client = data["client"]
    response = client.get("/api/v2/recipes/editor", params={"recipe_id": data["first"]})
    response.raise_for_status()
    view = response.json()
    assert view["recipe"]["description"] == "<p>Raw preparation</p>"
    assert view["recipe"]["base_servings"] == 2.5
    assert view["recipe"]["product_id"] == data["active"]
    assert [row["id"] for row in view["positions"]] == [data["position"]]
    assert view["positions"][0]["note"] == "<em>Raw note</em>"
    assert view["positions"][0]["price_factor"] == 0.5
    assert view["positions"][0]["round_up"] == 1
    assert [row["id"] for row in view["nestings"]] == [data["nesting"]]
    assert view["nestings"][0]["servings"] == 2.5
    assert [
        row["id"]
        for row in view["recipes"]
        if row["id"] in {data["first"], data["other"], data["special"]}
    ] == [data["other"], data["first"]]
    assert [
        row["id"] for row in view["products"] if row["id"] in {data["active"], data["inactive"]}
    ] == [data["inactive"], data["active"]]
    assert [
        row["id"]
        for row in view["units"]
        if row["id"] in {data["stock"], data["purchase"], data["hidden"]}
    ] == [data["stock"], data["purchase"], data["hidden"]]
    saved = next(
        row
        for row in view["conversions"]
        if row["product_id"] == data["active"]
        and row["from_qu_id"] == data["stock"]
        and row["to_qu_id"] == data["purchase"]
    )
    assert saved["factor"] == "0.123456789123"
    assert any(row["product_id"] is None and row["factor"] == "7" for row in view["conversions"])
    assert [field["name"] for field in view["fields"]] == ["first", "last"]
    assert view["values"] == {"first": "Recipe-only value", "last": None}
    assert "not_check_stock_fulfillment_for_recipes" in view["products"][0]
    assert "row_created_timestamp" in view["positions"][0]
    created = client.get("/api/v2/recipes/editor").json()
    assert created["recipe"] is None
    assert created["positions"] == created["nestings"] == []
    assert created["values"] == {}
    assert client.get("/api/v2/recipes/editor?recipe_id=2147483647").status_code == 404


def test_recipe_form_note_projection_formats_imported_markup_without_changing_storage(recipe_forms):
    data = recipe_forms
    client = data["client"]
    raw = '<em>Fold gently</em><script>alert(1)</script><img src="photo.jpg" onerror="alert(1)">'

    async def import_note():
        async with get_session_factory()() as session:
            await session.execute(
                text("UPDATE recipes_pos SET note=:note WHERE id=:id"),
                {"note": raw, "id": data["position"]},
            )
            await session.commit()

    assert client.portal is not None
    client.portal.call(import_note)
    row = client.get("/api/v2/recipes/editor", params={"recipe_id": data["first"]}).json()[
        "positions"
    ][0]
    assert row["note"] == raw
    assert "<em>Fold gently</em>" in row["note_html"]
    assert "<script" not in row["note_html"]
    assert "onerror" not in row["note_html"]
    assert client.get(f"/api/objects/recipes_pos/{data['position']}").json()["note"] == raw


def test_recipe_ingredient_context_preserves_unscoped_selection_and_mode_specific_references(
    recipe_forms,
):
    data = recipe_forms
    client = data["client"]
    path = "/api/v2/recipes/ingredient-editor"
    create_view = client.get(path, params={"recipe_id": data["first"]})
    create_view.raise_for_status()
    view = create_view.json()
    assert view["position"] is None
    assert data["active"] in {row["id"] for row in view["products"]}
    assert data["inactive"] not in {row["id"] for row in view["products"]}
    assert [
        row["id"]
        for row in view["units"]
        if row["id"] in {data["stock"], data["purchase"], data["hidden"]}
    ] == [data["purchase"], data["hidden"], data["stock"]]
    assert any(
        row["product_id"] == data["active"] and row["barcodes"] == "ACTIVE-CODE"
        for row in view["barcodes"]
    )
    assert data["inactive"] not in {row["product_id"] for row in view["barcodes"]}
    assert isinstance(view["barcode_lookup_plugin_name"], str)
    edited = client.get(
        path, params={"recipe_id": data["first"], "position_id": data["foreign_position"]}
    ).json()
    assert edited["recipe"]["id"] == data["first"]
    assert edited["position"]["recipe_id"] == data["other"]
    assert edited["position"]["id"] == data["foreign_position"]
    assert data["inactive"] in {row["id"] for row in edited["products"]}
    assert edited["conversions"] == view["conversions"]
    assert (
        client.get(path, params={"recipe_id": data["first"], "position_id": 2147483647}).status_code
        == 404
    )
    assert (
        client.get(
            path, params={"recipe_id": 2147483647, "position_id": data["position"]}
        ).status_code
        == 404
    )


def test_recipe_form_contexts_are_authenticated_presentation_reads(
    recipe_forms, api_headers, monkeypatch
):
    data = recipe_forms
    client = data["client"]
    client.headers.pop("GROCY-API-KEY")
    paths = [
        "/api/v2/recipes/editor",
        f"/api/v2/recipes/ingredient-editor?recipe_id={data['first']}",
    ]
    for path in paths:
        assert client.get(path).status_code == 401
    monkeypatch.setattr(get_settings(), "default_permissions", [])
    client.post(
        "/api/users", headers=api_headers, json={"username": "Recipe form reader", "password": ""}
    ).raise_for_status()
    identity = next(
        row["id"]
        for row in client.get("/api/users", headers=api_headers).json()
        if row["username"] == "Recipe form reader"
    )
    key = client.post("/api/v2/api-keys", headers=api_headers, json={"user_id": identity}).json()[
        "api_key"
    ]
    for path in paths:
        assert client.get(path, headers={"GROCY-API-KEY": key}).status_code == 200
    assert client.get("/api/users", headers={"GROCY-API-KEY": key}).status_code == 403
