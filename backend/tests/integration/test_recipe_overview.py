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
