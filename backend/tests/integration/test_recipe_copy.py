from fastapi.testclient import TestClient


def test_recipe_copy_duplicates_positions_and_nestings(
    client: TestClient, api_headers: dict[str, str]
) -> None:
    products = client.get("/api/objects/products", headers=api_headers).json()
    product_id = products[0]["id"]
    units = client.get("/api/objects/quantity_units", headers=api_headers).json()
    unit_id = units[0]["id"]

    nested = client.post(
        "/api/objects/recipes",
        headers=api_headers,
        json={"name": "Nested sauce", "base_servings": 2},
    ).json()["created_object_id"]
    source = client.post(
        "/api/objects/recipes",
        headers=api_headers,
        json={
            "name": "Main dish",
            "description": "With sauce",
            "base_servings": 4,
        },
    ).json()["created_object_id"]
    client.post(
        "/api/objects/recipes_pos",
        headers=api_headers,
        json={
            "recipe_id": source,
            "product_id": product_id,
            "amount": 2.5,
            "qu_id": unit_id,
            "note": "fresh",
            "ingredient_group": "base",
            "price_factor": 1.5,
        },
    )
    client.post(
        "/api/objects/recipes_nestings",
        headers=api_headers,
        json={"recipe_id": source, "includes_recipe_id": nested, "servings": 1},
    )

    copied = client.post(f"/api/recipes/{source}/copy", headers=api_headers)
    assert copied.status_code == 200, copied.text
    copy_id = copied.json()["created_object_id"]
    assert copy_id != str(source)

    recipe = client.get(f"/api/objects/recipes/{copy_id}", headers=api_headers).json()
    assert recipe["name"] == "Copy of Main dish"
    assert recipe["description"] == "With sauce"
    assert recipe["base_servings"] == 4

    positions = client.get(
        "/api/objects/recipes_pos",
        headers=api_headers,
        params=[("query[]", f"recipe_id={copy_id}")],
    ).json()
    assert len(positions) == 1
    assert positions[0]["product_id"] == product_id
    assert positions[0]["amount"] == 2.5
    assert positions[0]["qu_id"] == unit_id
    assert positions[0]["note"] == "fresh"
    assert positions[0]["ingredient_group"] == "base"
    assert positions[0]["price_factor"] == 1.5

    nestings = client.get(
        "/api/objects/recipes_nestings",
        headers=api_headers,
        params=[("query[]", f"recipe_id={copy_id}")],
    ).json()
    assert len(nestings) == 1
    assert nestings[0]["includes_recipe_id"] == int(nested)
    assert nestings[0]["servings"] == 1
