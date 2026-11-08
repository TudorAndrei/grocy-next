"""The native ProductEditForm row, choice catalogs, and document settings."""

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.core.errors import NotFoundError
from grocy.db.compatibility_views import configure_compatibility_queries
from grocy.domains.catalog.custom_data import custom_data_fields
from grocy.domains.catalog.objects import GenericObjectsService
from grocy.domains.system.service import SystemService
from grocy.domains.users.service import UsersService


async def native_product_editor(
    session: AsyncSession, row: str, user_id: int, accept_language: str
) -> dict[str, Any]:
    await configure_compatibility_queries(session)

    async def rows(
        statement: str, parameters: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        result = await session.execute(text(statement), parameters or {})
        return [dict(record) for record in result.mappings()]

    product = None
    if row != "new":
        selected = await rows("SELECT * FROM products WHERE id=:id LIMIT 1", {"id": row})
        if not selected:
            raise NotFoundError("Product not found")
        product = selected[0]
        # The rendered form sets EditObjectId to product.id before UserfieldsForm.Load.
        # Using its raw route alias here would select a different TEXT object ID.
        values = await GenericObjectsService(session).get_userfields("products", product["id"])
        product["userfields"] = values or None

    identity = product["id"] if product is not None else None
    parameters = {"id": identity}
    connected = (
        "id IN (SELECT to_qu_id FROM cache__quantity_unit_conversions_resolved "
        "WHERE product_id=:id)"
    )
    stock_condition = (
        f"{connected} OR NOT EXISTS(SELECT 1 FROM stock_log WHERE product_id=:id)"
        if product is not None
        else "1"
    )
    stock_units = await rows(
        f"SELECT * FROM quantity_units WHERE {stock_condition} ORDER BY name COLLATE NOCASE",
        parameters,
    )
    referenced_units = await rows(
        "SELECT * FROM quantity_units WHERE active=1 "
        + (f"AND {connected} " if product is not None else "")
        + "ORDER BY name COLLATE NOCASE",
        parameters,
    )
    # The template also receives every active unit for its related tables. Keep
    # that catalog alongside inactive units eligible for the Stock unit picker.
    units = await rows(
        f"SELECT * FROM quantity_units WHERE active=1 OR ({stock_condition}) "
        "ORDER BY name COLLATE NOCASE",
        parameters,
    )
    locations = await rows(
        "SELECT * FROM locations WHERE active=1 ORDER BY name"
        + (" COLLATE NOCASE" if product is not None else "")
    )
    stores = await rows(
        "SELECT * FROM shopping_locations WHERE active=1 ORDER BY name COLLATE NOCASE"
    )
    groups = await rows("SELECT * FROM product_groups WHERE active=1 ORDER BY name COLLATE NOCASE")
    parents = await rows(
        "SELECT * FROM products WHERE parent_product_id IS NULL AND active=1 "
        + ("AND id != :id " if product is not None else "")
        + "ORDER BY name COLLATE NOCASE",
        parameters,
    )
    parent_disabled = product is not None and bool(
        await session.scalar(
            text("SELECT EXISTS(SELECT 1 FROM products WHERE parent_product_id=:id)"), parameters
        )
    )
    conversions = (
        await rows(
            "SELECT from_qu_id,to_qu_id,factor FROM cache__quantity_unit_conversions_resolved "
            "WHERE product_id=:id",
            parameters,
        )
        if product is not None
        else []
    )

    def ids(records: list[dict[str, Any]]) -> list[int]:
        return [record["id"] for record in records]

    system = SystemService(session)
    locale = await system.locale(user_id, accept_language)
    return {
        "mode": "edit" if product is not None else "create",
        "product": product,
        "references": {
            "locations": locations,
            "quantity_units": units,
            "shopping_locations": stores,
            "product_groups": groups,
            "products": parents,
        },
        "options": {
            "references": {
                "location_id": ids(locations),
                "default_consume_location_id": ids(locations),
                "shopping_location_id": ids(stores),
                "product_group_id": ids(groups),
                "parent_product_id": ids(parents),
                "qu_id_stock": ids(stock_units),
                "qu_id_purchase": ids(referenced_units),
                "qu_id_consume": ids(referenced_units),
                "qu_id_price": ids(referenced_units),
            },
            "parent_disabled": parent_disabled,
            "conversions": conversions,
        },
        "fields": await custom_data_fields(session, "products"),
        "user_settings": await UsersService(session).settings(user_id),
        "config": system.config(locale),
        "locale": locale,
    }
