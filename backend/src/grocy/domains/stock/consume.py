"""Lookup lists for the legacy consume page, including aggregate-only products."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.db.compatibility_views import configure_compatibility_queries
from grocy.domains.stock.barcode_lookup import barcode_lookup_plugin_name


async def consume_editor(session: AsyncSession) -> dict:
    await configure_compatibility_queries(session)

    async def rows(sql: str) -> list[dict]:
        result = await session.execute(text(sql))
        return [dict(row) for row in result.mappings()]

    return {
        "barcode_lookup_plugin_name": await barcode_lookup_plugin_name(),
        # Consume includes no-own-stock parents and uses the native binary name order.
        "products": await rows(
            "SELECT id,name,qu_id_stock,qu_id_purchase FROM products "
            "WHERE active=1 AND id IN "
            "(SELECT product_id FROM stock_current WHERE amount_aggregated>0) ORDER BY name"
        ),
        "locations": await rows(
            "SELECT id,name,is_freezer FROM locations ORDER BY name COLLATE NOCASE"
        ),
        "units": await rows(
            "SELECT id,name,name_plural,plural_forms FROM quantity_units "
            "ORDER BY name COLLATE NOCASE"
        ),
        "barcodes": await rows("SELECT product_id,barcodes FROM product_barcodes_comma_separated"),
        # Keep saved order, factor text, unit names, and disconnected rows intact.
        "conversions": await rows(
            "SELECT product_id,from_qu_id,to_qu_id,factor,to_qu_name,to_qu_name_plural "
            "FROM cache__quantity_unit_conversions_resolved"
        ),
        "recipes": await rows(
            "SELECT id,name FROM recipes WHERE type='normal' ORDER BY name COLLATE NOCASE"
        ),
    }
