from sqlalchemy import text

from grocy.db.session import get_session_factory


def test_recipe_overview_selects_normal_recipes_and_resolves_all_three_stock_states(
    client, api_headers
):
    def create(entity, **body):
        response = client.post(f"/api/objects/{entity}", headers=api_headers, json=body)
        assert response.status_code == 200, response.text
        return int(response.json()["created_object_id"])

    product = create(
        "products",
        name="Overview ingredient",
        location_id=1,
        qu_id_stock=1,
        qu_id_purchase=1,
        due_type=2,
    )
    ready = create("recipes", name="ALPHA ready")
    covered = create("recipes", name="beta shopping")
    missing = create("recipes", name="Zulu missing")
    internal = create("recipes", name="Internal plan", type="mealplan-shadow")
    for identity, amount in [(ready, 1), (covered, 8), (missing, 10)]:
        create("recipes_pos", recipe_id=identity, product_id=product, amount=amount, qu_id=1)
    response = client.post(
        f"/api/stock/products/{product}/add",
        headers=api_headers,
        json={"amount": 5, "best_before_date": "2000-01-01"},
    )
    assert response.status_code == 200, response.text
    create("shopping_list", product_id=product, amount=3, qu_id=1)
    response = client.get("/api/v2/recipes/overview", headers=api_headers)
    assert response.status_code == 200, response.text
    rows = response.json()
    selected = [row for row in rows if row["id"] in {ready, covered, missing}]
    assert [row["id"] for row in selected] == [ready, covered, missing]
    assert [row["stock_status"] for row in selected] == [
        "Xenoughinstock",
        "enoughinstockwithshoppinglist",
        "notenoughinstock",
    ]
    assert [row["missing_products_count"] for row in selected] == [0, 1, 1]
    assert all(row["product_names"] == "Overview ingredient" for row in selected)
    assert all(row["due_score"] == 20 for row in selected)
    # Internal recipes remain available to meal planning, but are not list entries.
    assert client.get(f"/api/objects/recipes/{internal}", headers=api_headers).status_code == 200
    assert internal not in {row["id"] for row in rows}


def test_recipe_overview_custom_values_keep_namespace_missing_defaults_and_loose_object_identity(
    client, api_headers
):
    def create(table, **body):
        response = client.post(f"/api/objects/{table}", headers=api_headers, json=body)
        response.raise_for_status()
        return int(response.json()["created_object_id"])

    first = create("recipes", name="Custom first")
    second = create("recipes", name="Custom second")
    internal = create("recipes", name="Custom internal", type="mealplan-shadow")
    for field, kind, default, visible in [
        ("note", "text-single-line", "Unused note default", 1),
        ("rank", "number-decimal", "7.5", 1),
        ("hidden", "text-single-line", None, 0),
        ("zero", "checkbox", "1", 1),
        ("empty", "link", "https://unused.default/", 1),
        ("null_value", "link-with-title", "Unused null default", 1),
    ]:
        create(
            "userfields",
            entity="recipes",
            name=field,
            caption=field,
            type=kind,
            default_value=default,
            show_as_column_in_tables=visible,
        )
    create(
        "userfields",
        entity="products",
        name="note",
        caption="Product note",
        type="text-single-line",
    )
    client.put(
        f"/api/userfields/recipes/{first}",
        headers=api_headers,
        json={
            "rank": "3.75",
            "hidden": "<em>Stored hidden value</em>",
            "zero": "0",
            "empty": "",
            "null_value": None,
        },
    ).raise_for_status()
    # The overview joins GetAllValues by PHP loose object identity, not SQL TEXT equality.
    client.put(
        f"/api/userfields/recipes/00{first}",
        headers=api_headers,
        json={"note": "Recipe value with a loose identity"},
    ).raise_for_status()
    for entity, identity, note in [
        ("recipes", second, "Second recipe value"),
        ("recipes", internal, "Internal recipe value"),
        ("products", first, "Product namespace must not leak"),
    ]:
        client.put(
            f"/api/userfields/{entity}/{identity}", headers=api_headers, json={"note": note}
        ).raise_for_status()

    async def import_saved_values():
        async with get_session_factory()() as session:
            trigger = await session.scalar(
                text(
                    "SELECT sql FROM sqlite_master WHERE type='trigger' "
                    "AND name='prevent_empty_userfields_INS'"
                )
            )
            assert trigger is not None
            # Saved empty TEXT predating the cleanup trigger reads as PDO null;
            # the native NOT NULL column itself never stores a SQL NULL.
            # Restore the native trigger before exercising the context or write API.
            await session.execute(text("DROP TRIGGER prevent_empty_userfields_INS"))
            for name in ["empty", "null_value"]:
                await session.execute(
                    text(
                        "INSERT INTO userfield_values(field_id,object_id,value) "
                        "SELECT id,:object_id,:value FROM userfields "
                        "WHERE entity='recipes' AND name=:name"
                    ),
                    {"object_id": str(first), "value": "", "name": name},
                )
            await session.execute(text(trigger))
            await session.commit()

    assert client.portal is not None
    client.portal.call(import_saved_values)

    response = client.get("/api/v2/recipes/overview", headers=api_headers)
    response.raise_for_status()
    rows = response.json()
    assert isinstance(rows, list)
    by_id = {row["id"]: row for row in rows}
    assert internal not in by_id
    assert by_id[first]["custom_values"] == {
        "note": "Recipe value with a loose identity",
        "rank": "3.75",
        "hidden": "<em>Stored hidden value</em>",
        "zero": "0",
        "empty": None,
        "null_value": None,
    }
    # Missing rows render blank cells; stored-null link rows render empty anchors.
    # Do not inject configured defaults or collapse these two presence states.
    assert by_id[second]["custom_values"] == {"note": "Second recipe value"}
    client.put(
        f"/api/userfields/recipes/{first}",
        headers=api_headers,
        json={"empty": "", "null_value": None},
    ).raise_for_status()
    cleared = next(
        row
        for row in client.get("/api/v2/recipes/overview", headers=api_headers).json()
        if row["id"] == first
    )["custom_values"]
    assert "empty" not in cleared
    assert "null_value" not in cleared
    assert client.get("/api/v2/recipes/overview").status_code == 401
