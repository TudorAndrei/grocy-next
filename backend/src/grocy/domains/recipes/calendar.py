"""The native meal-plan page's persisted calendar and recipe read models."""

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.php import (
    filter_int,
    find,
    int_argument,
    is_iso_date,
    php_date,
    php_string,
)
from grocy.compatibility.sanitizer import render_html
from grocy.db.compatibility_views import configure_compatibility_queries
from grocy.domains.stock.service import StockService


async def mealplan_calendar(session: AsyncSession, parameters: dict[Any, Any]) -> dict[str, Any]:
    start = parameters.get("start")
    if start is None or not is_iso_date(start):
        start = php_date()[:10]
    supplied_days = parameters.get("days")
    days = (
        supplied_days
        if isinstance(supplied_days, str) and filter_int(supplied_days) is not None
        else 6
    )
    # Keep validated source text: signed/space-padded integers can produce invalid
    # native DATE modifiers, which deliberately result in an empty range.
    bindings = {"start": start, "before": f"-{days} days", "after": f"+{days} days"}
    timespan = "day BETWEEN DATE(:start,:before) AND DATE(:start,:after)"
    await configure_compatibility_queries(session)

    async def rows(statement: str, values: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        result = await session.execute(text(statement), values or {})
        return [dict(row) for row in result.mappings()]

    recipes = await rows("SELECT * FROM recipes WHERE type='normal'")
    stock = StockService(session)
    events = []
    for entry in await rows("SELECT * FROM meal_plan WHERE " + timespan, bindings):
        recipe = find(recipes, "id", entry["recipe_id"])
        product_details = None
        if entry["product_id"] is not None:
            identity = int_argument(
                php_string(entry["product_id"]),
                "Grocy\\Services\\StockService::GetProductDetails",
                "productId",
            )
            product_details = await stock.product_details(identity, compatibility=True)
        events.append(
            {
                "id": entry["id"],
                "title": recipe["name"] if recipe else "",
                "start": entry["day"],
                "date_format": "date",
                "type": entry["type"],
                "recipe": recipe,
                "entry": entry,
                "note_html": render_html(entry["note"] or ""),
                "product_details": product_details,
            }
        )
    weeks = await rows(
        "SELECT * FROM recipes WHERE type='mealplan-week' "
        "AND name=LTRIM(STRFTIME('%Y-%W',DATE(:start)),'0')",
        {"start": start},
    )
    week = weeks[0] if weeks else None
    internal = (
        " IN (SELECT recipe_id FROM meal_plan_internal_recipe_relation WHERE " + timespan + ") OR "
    )
    recipe_bindings = {**bindings, "week_id": week["id"] if week else 0}
    return {
        "start": start,
        "days": days,
        "events": events,
        "recipes": recipes,
        "internal_recipes": await rows(
            "SELECT * FROM recipes WHERE id" + internal + "id=:week_id", recipe_bindings
        ),
        "recipes_resolved": await rows(
            "SELECT * FROM recipes_resolved WHERE recipe_id" + internal + "recipe_id=:week_id",
            recipe_bindings,
        ),
        "products": await rows("SELECT * FROM products ORDER BY name COLLATE NOCASE"),
        "units": await rows("SELECT * FROM quantity_units ORDER BY name COLLATE NOCASE"),
        "conversions": await rows("SELECT * FROM cache__quantity_unit_conversions_resolved"),
        "sections": await rows("SELECT * FROM meal_plan_sections ORDER BY sort_number"),
        "used_sections": await rows(
            "SELECT * FROM meal_plan_sections WHERE id IN "
            "(SELECT section_id FROM meal_plan WHERE " + timespan + ") ORDER BY sort_number",
            bindings,
        ),
        "week_recipe": week,
    }
