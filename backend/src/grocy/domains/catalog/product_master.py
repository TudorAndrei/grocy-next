"""The native ProductsList catalog, before client-side table filtering."""

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.lessql import query_parameters
from grocy.db.compatibility_views import configure_compatibility_queries
from grocy.domains.catalog.custom_data import custom_data_fields
from grocy.domains.system.service import SystemService
from grocy.domains.users.service import UsersService


async def products_master_context(
    session: AsyncSession, user_id: int, raw_query: bytes, accept_language: str
) -> dict[str, Any]:
    await configure_compatibility_queries(session)
    query = query_parameters(raw_query)
    filters = []
    if query.get("include_disabled") is None:
        filters.append("active=1")
    in_stock = "(SELECT product_id FROM stock_current WHERE amount_aggregated > 0)"
    if query.get("only_in_stock") is not None:
        filters.append("id IN " + in_stock)
    if query.get("only_out_of_stock") is not None:
        filters.append("id NOT IN " + in_stock)
    where = " WHERE " + " AND ".join(filters) if filters else ""
    products = await session.execute(
        text(
            "SELECT id,name,active,picture_file_name,location_id,min_stock_amount,"
            "qu_id_purchase,qu_id_stock,product_group_id,shopping_location_id FROM products"
            + where
            + " ORDER BY name COLLATE NOCASE"
        )
    )
    context: dict[str, Any] = {"products": [dict(row) for row in products.mappings()]}
    for entity in ["locations", "quantity_units", "product_groups", "shopping_locations"]:
        active = " WHERE active=1" if entity == "product_groups" else ""
        rows = await session.execute(
            text(f"SELECT id,name FROM {entity}{active} ORDER BY name COLLATE NOCASE")
        )
        context[entity] = [dict(row) for row in rows.mappings()]
    context["userfields"] = await custom_data_fields(session, "products")
    values = await session.execute(
        text(
            "SELECT object_id,name,value FROM userfield_values_resolved "
            "WHERE entity='products' ORDER BY name COLLATE NOCASE"
        )
    )
    context["userfield_values"] = [dict(row) for row in values.mappings()]
    system = SystemService(session)
    locale = await system.locale(user_id, accept_language)
    context["user_settings"] = await UsersService(session).settings(user_id)
    context["config"] = system.config(locale)
    context["locale"] = locale
    return context
