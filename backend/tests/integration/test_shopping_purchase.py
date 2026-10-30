import pytest
from sqlalchemy import text

from grocy.db.session import get_session_factory


def test_legacy_shopping_actions_check_credentials_before_input_and_keep_saved_items(
    client, api_headers
):
    client.headers.update(api_headers)
    assert (
        client.post(
            "/api/users", json={"username": "No shopping access", "password": "test"}
        ).status_code
        == 204
    )
    user = client.get("/api/users", params={"query[]": "username=No shopping access"}).json()[0][
        "id"
    ]
    client.put(f"/api/users/{user}/permissions", json={"permissions": []})
    key = client.post("/api/v2/api-keys", json={"user_id": user}).json()["api_key"]
    client.post("/api/objects/shopping_list", json={"product_id": 1, "amount": 2})
    before = client.get("/api/objects/shopping_list").json()
    client.headers.pop("GROCY-API-KEY")
    for headers, status in (({}, 401), ({"GROCY-API-KEY": key}, 403)):
        for action in (
            "add-product",
            "remove-product",
            "clear",
            "add-missing-products",
            "add-overdue-products",
            "add-expired-products",
        ):
            response = client.post(
                "/api/stock/shoppinglist/" + action,
                content=b"{",
                headers={**headers, "Content-Type": "text/plain"},
            )
            assert response.status_code == status, response.text
    assert client.get("/api/objects/shopping_list", headers=api_headers).json() == before


def test_checked_legacy_shopping_amount_is_displayed_and_purchased_once(client, api_headers):
    client.headers.update(api_headers)
    case = client.post("/api/objects/quantity_units", json={"name": "Case"}).json()[
        "created_object_id"
    ]
    assert (
        client.post(
            "/api/objects/quantity_unit_conversions",
            json={"product_id": 1, "from_qu_id": case, "to_qu_id": 1, "factor": 6},
        ).status_code
        == 200
    )
    item = client.post(
        "/api/objects/shopping_list",
        json={"shopping_list_id": 1, "product_id": 1, "amount": 12, "qu_id": case, "done": 1},
    ).json()["created_object_id"]
    assert client.get("/api/v2/shopping-lists/1").json()["items"][0]["amount"] == 2
    paper = client.get("/api/v2/shopping-lists/1/print")
    assert '<span data-number="quantity">2</span>' in paper.text
    path = f"/api/v2/shopping-lists/1/items/{item}/purchase"
    response = client.post(path)
    assert response.status_code == 200, response.text
    assert response.json()["purchased"] is True
    assert client.get("/api/stock/products/1").json()["stock_amount"] == 12
    assert client.post(path).json()["purchased"] is False
    assert client.get("/api/stock/products/1").json()["stock_amount"] == 12
    assert client.get("/api/v2/shopping-lists/1").json()["items"] == []


@pytest.mark.parametrize(("done", "list_id", "status"), [(0, 1, 400), (1, 2, 404)])
def test_shopping_purchase_keeps_an_unchecked_item_or_another_list(
    client, api_headers, done, list_id, status
):
    client.headers.update(api_headers)
    client.post("/api/objects/shopping_lists", json={"name": "Other list"})
    item = client.post(
        "/api/objects/shopping_list",
        json={"shopping_list_id": 1, "product_id": 1, "amount": 2, "done": done},
    ).json()["created_object_id"]
    assert (
        client.post(f"/api/v2/shopping-lists/{list_id}/items/{item}/purchase").status_code == status
    )
    assert client.get("/api/stock/products/1").json()["stock_amount"] == 0
    assert len(client.get("/api/v2/shopping-lists/1").json()["items"]) == 1


def test_failed_shopping_purchase_keeps_stock_and_item_for_retry(client, api_headers):
    client.headers.update(api_headers)
    item = client.post(
        "/api/objects/shopping_list",
        json={"shopping_list_id": 1, "product_id": 1, "amount": 2, "done": 1},
    ).json()["created_object_id"]

    async def block_delete(block):
        async with get_session_factory()() as session:
            if block:
                await session.execute(
                    text(
                        "CREATE TRIGGER block_receipt BEFORE DELETE ON shopping_list "
                        "BEGIN SELECT RAISE(ABORT, 'Receipt cannot be saved'); END"
                    )
                )
            else:
                await session.execute(text("DROP TRIGGER block_receipt"))
            await session.commit()

    client.portal.call(block_delete, True)
    path = f"/api/v2/shopping-lists/1/items/{item}/purchase"
    assert client.post(path).status_code == 409
    assert client.get("/api/stock/products/1").json()["stock_amount"] == 0
    assert len(client.get("/api/v2/shopping-lists/1").json()["items"]) == 1
    client.portal.call(block_delete, False)
    assert client.post(path).status_code == 200
    assert client.get("/api/stock/products/1").json()["stock_amount"] == 2


@pytest.mark.parametrize("permissions", [[22], [15]])
def test_shopping_purchase_requires_purchase_and_delete_permissions(
    client, api_headers, permissions
):
    client.headers.update(api_headers)
    assert (
        client.post("/api/users", json={"username": "Shopper", "password": "test"}).status_code
        == 204
    )
    user = client.get("/api/users", params={"query[]": "username=Shopper"}).json()[0]["id"]
    client.put(f"/api/users/{user}/permissions", json={"permissions": permissions})
    key = client.post("/api/v2/api-keys", json={"user_id": user}).json()["api_key"]
    item = client.post(
        "/api/objects/shopping_list",
        json={"shopping_list_id": 1, "product_id": 1, "amount": 2, "done": 1},
    ).json()["created_object_id"]
    assert (
        client.post(
            f"/api/v2/shopping-lists/1/items/{item}/purchase", headers={"GROCY-API-KEY": key}
        ).status_code
        == 403
    )
    assert client.get("/api/stock/products/1").json()["stock_amount"] == 0
    assert len(client.get("/api/v2/shopping-lists/1").json()["items"]) == 1


def test_extension_shopping_add_stores_stock_quantity_for_native_consumers(client, api_headers):
    client.headers.update(api_headers)
    case = client.post("/api/objects/quantity_units", json={"name": "Case"}).json()[
        "created_object_id"
    ]
    assert (
        client.post(
            "/api/objects/quantity_unit_conversions",
            json={"product_id": 1, "from_qu_id": case, "to_qu_id": 1, "factor": 6},
        ).status_code
        == 200
    )
    created = client.post(
        "/api/v2/shopping-lists/items", json={"product_id": 1, "amount": 2, "qu_id": int(case)}
    )
    assert created.status_code == 200, created.text
    item = created.json()["id"]
    assert created.json()["amount"] == 2
    saved = client.get(f"/api/objects/shopping_list/{item}").json()
    assert saved["amount"] == 12 and saved["qu_id"] == int(case)
    assert client.get("/api/v2/shopping-lists/1").json()["items"][0]["amount"] == 2
    client.put(f"/api/objects/shopping_list/{item}", json={"done": 1})
    assert client.post(f"/api/v2/shopping-lists/1/items/{item}/purchase").status_code == 200
    assert client.get("/api/stock/products/1").json()["stock_amount"] == 12
