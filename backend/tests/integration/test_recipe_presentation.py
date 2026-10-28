def test_recipe_cards_keep_nested_order_units_groups_and_separate_ingredient_rows(
    client, api_headers
):
    def create(entity, **body):
        response = client.post(f"/api/objects/{entity}", headers=api_headers, json=body)
        assert response.status_code == 200, response.text
        return int(response.json()["created_object_id"])

    gram = create("quantity_units", name="Test gram", name_plural="Test grams")
    kilo = create("quantity_units", name="Test kilo", name_plural="Test kilos")
    group = create("product_groups", name="Dry goods")
    product = create(
        "products",
        name="Test flour",
        location_id=1,
        qu_id_stock=gram,
        qu_id_purchase=gram,
        product_group_id=group,
    )
    create(
        "quantity_unit_conversions",
        product_id=product,
        from_qu_id=gram,
        to_qu_id=kilo,
        factor=0.001,
    )
    root = create("recipes", name="Main recipe", base_servings=3, desired_servings=6)
    child = create(
        "recipes",
        name="z sauce",
        base_servings=2,
        desired_servings=10,
        description="<h2>Make the sauce</h2>",
    )
    leaf = create(
        "recipes",
        name="Alpha garnish",
        base_servings=1,
        desired_servings=7,
        description="<p><strong>Chop</strong> finely.</p>",
    )
    create("recipes", name="Not included")
    for identity, servings in [(root, 6), (child, 10), (leaf, 7)]:
        saved = client.put(
            f"/api/objects/recipes/{identity}",
            headers=api_headers,
            json={"desired_servings": servings},
        )
        assert saved.status_code == 204, saved.text
    create("recipes_nestings", recipe_id=root, includes_recipe_id=child, servings=3)
    create("recipes_nestings", recipe_id=child, includes_recipe_id=leaf, servings=2)
    create("recipes_nestings", recipe_id=root, includes_recipe_id=leaf, servings=4)
    second = create(
        "recipes_pos",
        recipe_id=root,
        product_id=product,
        amount=250,
        qu_id=kilo,
        ingredient_group="Batter",
        note="Mix gently\nThen rest",
    )
    first = create(
        "recipes_pos",
        recipe_id=root,
        product_id=product,
        amount=100,
        qu_id=gram,
        ingredient_group="Base",
        variable_amount="to taste",
    )
    create("recipes_pos", recipe_id=child, product_id=product, amount=4, qu_id=kilo)
    create(
        "recipes_pos",
        recipe_id=child,
        product_id=product,
        amount=0.5,
        qu_id=kilo,
        ingredient_group="Sauce",
        only_check_single_unit_in_stock=1,
    )
    create("recipes_pos", recipe_id=leaf, product_id=product, amount=5, qu_id=gram)
    bought = client.post(
        f"/api/stock/products/{product}/add",
        headers=api_headers,
        json={"amount": 300, "price": 0.5},
    )
    assert bought.status_code == 200, bought.text
    create("shopping_list", product_id=product, amount=40, qu_id=gram)
    response = client.get(f"/api/v2/recipes/{root}/view", headers=api_headers)
    assert response.status_code == 200, response.text
    view = response.json()
    assert [card["id"] for card in view["cards"]] == [root, leaf, child]
    parent, garnish, sauce = view["cards"]
    assert [row["id"] for row in parent["ingredients"]] == [first, second]
    assert [row["amount"] for row in parent["ingredients"]] == [200, 0.5]
    assert [row["ingredient_group"] for row in parent["ingredients"]] == ["Base", "Batter"]
    assert {row["product_group"] for row in parent["ingredients"]} == {"Dry goods"}
    assert parent["ingredients"][0]["variable_amount"] == "to taste"
    assert parent["ingredients"][1]["note_html"] == "Mix gently<br>Then rest"
    assert parent["ingredients"][1]["missing_amount"] == 200
    assert parent["ingredients"][1]["shopping_amount"] == 40
    assert parent["ingredients"][1]["fulfilled"] is False
    assert parent["ingredients"][0]["fulfilled"] is True
    assert sauce["ingredients"][0]["amount"] == 0.012
    assert sauce["ingredients"][1]["amount"] == 1.5
    # The pinned controller selects the first root position for a shared child.
    # It shows the garnish once and does not add the two nesting paths together.
    assert garnish["ingredients"][0]["amount"] == 40
    assert garnish["preparation_html"] == "<p><strong>Chop</strong> finely.</p>"
    assert sauce["desired_servings"] == 10
    assert (
        client.get(f"/api/objects/recipes/{root}", headers=api_headers).json()["desired_servings"]
        == 6
    )
    assert (
        client.get(f"/api/objects/recipes/{child}", headers=api_headers).json()["desired_servings"]
        == 10
    )
    assert client.get("/api/v2/recipes/2147483647/view", headers=api_headers).status_code == 404
