"""Read the calculated entities from the pinned Grocy SQLite definitions."""

from sqlalchemy import text

from grocy.core.permissions import PERMISSIONS
from grocy.db.compatibility_views import configure_compatibility_queries

VIEW_ENTITIES = {
    "stock_current_locations",
    "products_last_purchased",
    "products_average_price",
    "quantity_unit_conversions_resolved",
    "recipes_pos_resolved",
    "product_barcodes_view",
    "permission_hierarchy",
}


async def list_view(session, entity: str) -> list[dict]:
    if entity == "permission_hierarchy":
        return [
            {"id": pid, "name": name, "parent": parent}
            for pid, (name, parent) in PERMISSIONS.items()
        ]
    if entity not in VIEW_ENTITIES:
        return []
    await configure_compatibility_queries(session)
    rows = (await session.execute(text(f'SELECT * FROM "{entity}"'))).mappings().all()
    result = [dict(row) for row in rows]
    if entity == "products_average_price":
        for row in result:
            row["avg_price"] = row["price"]
    return result
