"""Native recipe form inputs, without changing the compatibility write APIs."""

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.sanitizer import render_html
from grocy.core.errors import NotFoundError
from grocy.domains.catalog.custom_data import custom_data_fields
from grocy.domains.catalog.objects import GenericObjectsService
from grocy.domains.stock.barcode_lookup import barcode_lookup_plugin_name


async def _rows(
    session: AsyncSession, query: str, parameters: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    return [dict(row) for row in (await session.execute(text(query), parameters or {})).mappings()]


async def _selected(session: AsyncSession, table: str, identity: int) -> dict[str, Any]:
    # Table names are internal constants; identities remain bound parameters.
    rows = await _rows(session, f"SELECT * FROM {table} WHERE id=:id", {"id": identity})
    if not rows:
        raise NotFoundError("Recipe not found" if table == "recipes" else "Ingredient not found")
    return rows[0]


async def recipe_form_context(session: AsyncSession, recipe_id: int | None) -> dict[str, Any]:
    recipe = await _selected(session, "recipes", recipe_id) if recipe_id is not None else None
    positions = await _rows(
        session, "SELECT * FROM recipes_pos WHERE recipe_id=:id", {"id": recipe_id}
    )
    for position in positions:
        position["note_html"] = render_html(position["note"] or "")
    return {
        "recipe": recipe,
        "positions": positions,
        "nestings": await _rows(
            session, "SELECT * FROM recipes_nestings WHERE recipe_id=:id", {"id": recipe_id}
        ),
        "recipes": await _rows(
            session, "SELECT * FROM recipes WHERE type='normal' ORDER BY name COLLATE NOCASE"
        ),
        "products": await _rows(session, "SELECT * FROM products ORDER BY name COLLATE NOCASE"),
        "units": await _rows(session, "SELECT * FROM quantity_units"),
        "conversions": await _rows(
            session, "SELECT * FROM cache__quantity_unit_conversions_resolved"
        ),
        "fields": await custom_data_fields(session, "recipes"),
        "values": (
            await GenericObjectsService(session).get_userfields("recipes", recipe_id)
            if recipe_id is not None
            else {}
        ),
    }


async def recipe_ingredient_context(
    session: AsyncSession, recipe_id: int, position_id: int | None
) -> dict[str, Any]:
    recipe = await _selected(session, "recipes", recipe_id)
    # Native edit selects the position independently from the requested parent recipe.
    position = (
        await _selected(session, "recipes_pos", position_id) if position_id is not None else None
    )
    active = " WHERE active=1" if position is None else ""
    return {
        "recipe": recipe,
        "position": position,
        "products": await _rows(
            session, "SELECT * FROM products" + active + " ORDER BY name COLLATE NOCASE"
        ),
        "barcodes": await _rows(session, "SELECT * FROM product_barcodes_comma_separated"),
        "units": await _rows(session, "SELECT * FROM quantity_units ORDER BY name COLLATE NOCASE"),
        "conversions": await _rows(
            session, "SELECT * FROM cache__quantity_unit_conversions_resolved"
        ),
        "barcode_lookup_plugin_name": await barcode_lookup_plugin_name(),
    }
