"""Lookup lists and stock fields shared by purchase and inventory forms."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.db.compatibility_views import configure_compatibility_queries
from grocy.domains.stock.barcode_lookup import barcode_lookup_plugin_name


async def booking_editor(session: AsyncSession, *, include_inactive_units: bool) -> dict:
    await configure_compatibility_queries(session)

    async def rows(sql: str, parameters: dict | None = None) -> list[dict]:
        result = await session.execute(text(sql), parameters or {})
        return [dict(row) for row in result.mappings()]

    return {
        "barcode_lookup_plugin_name": await barcode_lookup_plugin_name(),
        "products": await rows(
            "SELECT id,name,qu_id_stock,qu_id_purchase FROM products "
            "WHERE active=1 AND no_own_stock=0 ORDER BY name COLLATE NOCASE"
        ),
        "locations": await rows(
            "SELECT id,name,is_freezer FROM locations WHERE active=1 ORDER BY name COLLATE NOCASE"
        ),
        "stores": await rows(
            "SELECT id,name FROM shopping_locations WHERE active=1 ORDER BY name COLLATE NOCASE"
        ),
        "units": await rows(
            "SELECT id,name,name_plural,plural_forms FROM quantity_units "
            "WHERE :all_units OR active=1 ORDER BY name COLLATE NOCASE",
            {"all_units": include_inactive_units},
        ),
        "barcodes": await rows("SELECT product_id,barcodes FROM product_barcodes_comma_separated"),
        # The native picker uses the first matching saved row and its unit names.
        "conversions": await rows(
            "SELECT product_id,from_qu_id,to_qu_id,factor,to_qu_name,to_qu_name_plural "
            "FROM cache__quantity_unit_conversions_resolved"
        ),
        "fields": await rows(
            "SELECT id,name,caption,type,input_required,default_value,config "
            "FROM userfields WHERE entity='stock' ORDER BY sort_number,name COLLATE NOCASE"
        ),
    }
