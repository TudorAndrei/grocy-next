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


async def list_view(session, entity: str, *, object_id: int | str | None = None) -> list[dict]:
    if entity == "permission_hierarchy":
        numeric_id = None
        if object_id is not None:
            # The native permission IDs are INTEGER columns. Apply the same
            # affinity to this in-memory hierarchy through SQLite.
            numeric_id = await session.scalar(
                text("SELECT CAST(:key AS NUMERIC) WHERE CAST(:key AS NUMERIC) = :key"),
                {"key": str(object_id)},
            )
        return [
            {"id": pid, "name": name, "parent": parent}
            for pid, (name, parent) in PERMISSIONS.items()
            if object_id is None or pid == numeric_id
        ]
    if entity not in VIEW_ENTITIES:
        return []
    await configure_compatibility_queries(session)
    query = f'SELECT * FROM "{entity}"'
    parameters = {}
    if object_id is not None:
        query += " WHERE id = :object_id LIMIT 1"
        parameters["object_id"] = str(object_id)
    rows = (await session.execute(text(query), parameters)).mappings().all()
    result = [dict(row) for row in rows]
    if entity == "products_average_price":
        for row in result:
            row["avg_price"] = row["price"]
    return result
