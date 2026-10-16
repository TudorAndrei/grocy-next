from decimal import Decimal

from fastapi.testclient import TestClient


def test_nutrition_propose_commit_and_read(
    client: TestClient,
    api_headers: dict[str, str],
) -> None:
    products = client.get("/api/objects/products", headers=api_headers).json()
    product_id = products[0]["id"]

    missing = client.get(
        f"/api/v2/products/{product_id}/nutrition",
        headers=api_headers,
    )
    assert missing.status_code == 404

    proposal_body = {
        "product_id": product_id,
        "expected_revision": 0,
        "basis": {"quantity": "100", "unit": "g"},
        "nutrients": {
            "energy_kcal": "97",
            "protein_g": "9.0",
            "carbohydrates_g": "3.8",
            "sugars_g": "3.8",
            "fat_g": "5.0",
            "saturated_fat_g": "3.2",
            "fiber_g": None,
            "salt_g": "0.10",
        },
        "source": {"type": "packaging_label", "barcode": None},
        "note": "Extracted from user-supplied label photograph",
        "origin": "mcp",
    }
    proposal = client.post(
        "/api/v2/nutrition/proposals",
        headers=api_headers,
        json=proposal_body,
    )
    assert proposal.status_code == 200
    proposal_id = proposal.json()["id"]
    assert proposal.json()["status"] == "pending"

    committed = client.post(
        f"/api/v2/nutrition/proposals/{proposal_id}/approve",
        headers=api_headers,
    )
    assert committed.status_code == 200
    record = committed.json()
    assert record["revision"] == 1
    assert record["nutrients"]["fiber_g"] is None
    assert Decimal(str(record["nutrients"]["energy_kcal"])) == Decimal("97")
    assert Decimal(str(record["nutrients"]["salt_g"])) == Decimal("0.10")

    fetched = client.get(
        f"/api/v2/products/{product_id}/nutrition",
        headers=api_headers,
    )
    assert fetched.status_code == 200
    assert fetched.json()["revision"] == 1

    revisions = client.get(
        f"/api/v2/products/{product_id}/nutrition/revisions",
        headers=api_headers,
    )
    assert revisions.status_code == 200
    assert len(revisions.json()) == 1


def test_nutrition_rejects_sugars_gt_carbs(
    client: TestClient,
    api_headers: dict[str, str],
) -> None:
    products = client.get("/api/objects/products", headers=api_headers).json()
    product_id = products[0]["id"]
    response = client.post(
        "/api/v2/nutrition/proposals",
        headers=api_headers,
        json={
            "product_id": product_id,
            "basis": {"quantity": "100", "unit": "g"},
            "nutrients": {
                "carbohydrates_g": "3",
                "sugars_g": "5",
            },
        },
    )
    assert response.status_code == 422


def test_nutrition_conflict_on_stale_revision(
    client: TestClient,
    api_headers: dict[str, str],
) -> None:
    products = client.get("/api/objects/products", headers=api_headers).json()
    product_id = products[0]["id"]
    upsert = client.put(
        f"/api/v2/products/{product_id}/nutrition",
        headers=api_headers,
        json={
            "expected_revision": 0,
            "basis": {"quantity": "100", "unit": "g"},
            "nutrients": {"energy_kcal": "10", "protein_g": "1"},
            "origin": "web",
        },
    )
    assert upsert.status_code == 200

    conflict = client.post(
        "/api/v2/nutrition/proposals",
        headers=api_headers,
        json={
            "product_id": product_id,
            "expected_revision": 0,
            "basis": {"quantity": "100", "unit": "g"},
            "nutrients": {"energy_kcal": "20"},
        },
    )
    assert conflict.status_code == 200
    assert conflict.json()["status"] == "conflict"

    approve = client.post(
        f"/api/v2/nutrition/proposals/{conflict.json()['id']}/approve",
        headers=api_headers,
    )
    assert approve.status_code == 409


def test_mcp_http_products_search_and_nutrition(
    client: TestClient,
    api_headers: dict[str, str],
) -> None:
    search = client.post(
        "/api/v2/mcp/call",
        headers=api_headers,
        json={"tool": "products_search", "arguments": {"query": "Yogurt"}},
    )
    assert search.status_code == 200
    hits = search.json()
    assert len(hits) >= 1
    product_id = hits[0]["id"]

    propose = client.post(
        "/api/v2/mcp/call",
        headers=api_headers,
        json={
            "tool": "nutrition_propose_update",
            "arguments": {
                "payload": {
                    "product_id": product_id,
                    "expected_revision": 0,
                    "basis": {"quantity": "100", "unit": "g"},
                    "nutrients": {
                        "energy_kcal": "97",
                        "protein_g": "9",
                        "fiber_g": None,
                    },
                    "source": {"type": "packaging_label"},
                    "origin": "mcp",
                }
            },
        },
    )
    assert propose.status_code == 200
    proposal_id = propose.json()["id"]

    commit = client.post(
        "/api/v2/mcp/call",
        headers=api_headers,
        json={
            "tool": "nutrition_commit_update",
            "arguments": {"proposal_id": proposal_id},
        },
    )
    assert commit.status_code == 200
    assert commit.json()["nutrients"]["fiber_g"] is None

    current = client.post(
        "/api/v2/mcp/call",
        headers=api_headers,
        json={
            "tool": "nutrition_get",
            "arguments": {"product_id": product_id},
        },
    )
    assert current.status_code == 200
    assert current.json()["revision"] == 1


def test_native_product_merge_with_nutrition_keeps_core_behavior(client, api_headers):
    client.headers.update(api_headers)
    products = []
    for name in ["Keep nutrition", "Remove nutrition"]:
        response = client.post(
            "/api/objects/products",
            json={"name": name, "location_id": 1, "qu_id_stock": 1, "qu_id_purchase": 1},
        )
        assert response.status_code == 200, response.text
        product = int(response.json()["created_object_id"])
        nutrition = client.put(
            f"/api/v2/products/{product}/nutrition",
            json={
                "expected_revision": 0,
                "basis": {"quantity": "100", "unit": "g"},
                "nutrients": {"energy_kcal": "97"},
                "source": {"type": "manual"},
            },
        )
        assert nutrition.status_code == 200, nutrition.text
        products.append(product)
    keep, remove = products
    before = client.get(f"/api/v2/products/{keep}/nutrition").json()
    removed_nutrition = client.get(f"/api/v2/products/{remove}/nutrition").json()
    from grocy.db.session import get_session_factory

    def execute(statement):
        async def run():
            async with get_session_factory()() as session:
                connection = await session.connection()
                await connection.exec_driver_sql(statement)
                await session.commit()

        client.portal.call(run)

    execute(
        f"CREATE TRIGGER merge_block BEFORE DELETE ON products WHEN OLD.id={remove} "
        "BEGIN SELECT RAISE(ABORT,'Blocked merge'); END"
    )
    blocked = client.post(f"/api/stock/products/{keep}/merge/{remove}")
    assert blocked.status_code == 400, blocked.text
    assert "Blocked merge" in blocked.json()["error_message"]
    assert client.get(f"/api/v2/products/{keep}/nutrition").json() == before
    assert client.get(f"/api/v2/products/{remove}/nutrition").json() == removed_nutrition
    execute("DROP TRIGGER merge_block")
    assert client.post(f"/api/stock/products/{remove}/add", json={"amount": 3}).status_code == 200
    merged = client.post(f"/api/stock/products/{keep}/merge/{remove}")
    assert merged.status_code == 204 and merged.content == b"", merged.text
    assert client.get(f"/api/stock/products/{keep}").json()["stock_amount"] == 3
    assert client.get(f"/api/objects/products/{remove}").status_code == 404
    assert client.get(f"/api/v2/products/{keep}/nutrition").json() == before
