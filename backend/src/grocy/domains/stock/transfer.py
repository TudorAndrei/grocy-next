"""Lookup lists for the legacy transfer form."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.db.compatibility_views import configure_compatibility_queries
from grocy.domains.stock.barcode_lookup import barcode_lookup_plugin_name


async def transfer_editor(session: AsyncSession) -> dict:
    await configure_compatibility_queries(session)

    async def rows(sql: str) -> list[dict]:
        result = await session.execute(text(sql))
        return [dict(row) for row in result.mappings()]

    return {
        "barcode_lookup_plugin_name": await barcode_lookup_plugin_name(),
        "products": await rows(
            "SELECT id,name,qu_id_stock,qu_id_purchase FROM products "
            "WHERE active=1 AND no_own_stock=0 AND id IN "
            "(SELECT product_id FROM stock_current WHERE amount_aggregated>0) "
            "ORDER BY name COLLATE NOCASE"
        ),
        "locations": await rows(
            "SELECT id,name,is_freezer FROM locations WHERE active=1 ORDER BY name COLLATE NOCASE"
        ),
        "units": await rows(
            "SELECT id,name,name_plural,plural_forms FROM quantity_units "
            "WHERE active=1 ORDER BY name COLLATE NOCASE"
        ),
        "barcodes": await rows("SELECT product_id,barcodes FROM product_barcodes_comma_separated"),
        # Do not regenerate, filter, sort, or coerce this saved cache. The native
        # amount picker uses the first matching row and the saved unit names.
        "conversions": await rows(
            "SELECT product_id,from_qu_id,to_qu_id,factor,to_qu_name,to_qu_name_plural "
            "FROM cache__quantity_unit_conversions_resolved"
        ),
    }
