"""Resolved conversion pages read saved cache rows and active unit labels."""

from sqlalchemy import text

from grocy.db.session import get_session_factory


def test_resolved_conversions_keep_cache_precision_global_scope_and_inactive_units(
    client, api_headers
):
    path = "/api/v2/quantity-unit-conversions/resolved"
    assert client.get(path).status_code == 401
    client.headers.update(api_headers)

    def create(entity, **values):
        response = client.post(f"/api/objects/{entity}", json=values)
        response.raise_for_status()
        return int(response.json()["created_object_id"])

    unit = create("quantity_units", name="Resolved piece", name_plural="Resolved pieces")
    box = create("quantity_units", name="Resolved box")
    hidden = create("quantity_units", name="Resolved inactive", active=0)
    product = create(
        "products", name="Resolved tea", location_id=1, qu_id_stock=unit, qu_id_purchase=box
    )
    create("quantity_unit_conversions", from_qu_id=hidden, to_qu_id=box, factor=5)

    async def retain_saved_cache():
        async with get_session_factory()() as session:
            await session.execute(
                text(
                    "UPDATE cache__quantity_unit_conversions_resolved SET factor=:factor "
                    "WHERE product_id=:product AND from_qu_id=:unit AND to_qu_id=:box"
                ),
                {"factor": "0.123456789123456", "product": product, "unit": unit, "box": box},
            )
            await session.execute(
                text(
                    "INSERT INTO cache__quantity_unit_conversions_resolved "
                    "(from_qu_id,to_qu_id,factor) VALUES (:box,:hidden,'0.2')"
                ),
                {"box": box, "hidden": hidden},
            )
            await session.commit()

    assert client.portal is not None
    client.portal.call(retain_saved_cache)

    def read(**params):
        response = client.get(path, params=params)
        assert response.status_code == 200, response.text
        return response.json()

    view = read(product=product)
    assert view["product"] == {"id": product, "name": "Resolved tea"}
    assert len(view["rows"]) == 7
    saved = next(row for row in view["rows"] if (row["from_qu_id"], row["to_qu_id"]) == (unit, box))
    assert saved["factor"] == "0.123456789123456"
    assert any(row["from_qu_id"] == hidden for row in view["rows"])
    assert hidden not in {row["id"] for row in view["units"]}
    assert (
        next(row for row in view["units"] if row["id"] == unit)["name_plural"] == "Resolved pieces"
    )
    assert read(product=f"{product}.0")["rows"] == view["rows"]
    global_view = read()
    assert global_view["product"] is None
    assert [(row["from_qu_id"], row["to_qu_id"]) for row in global_view["rows"]] == [
        (box, hidden),
    ]
    assert read(product="missing") == global_view
    assert read(product="") == global_view
