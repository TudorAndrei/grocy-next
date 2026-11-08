"""Native meal-plan section list and selected-form presentation reads."""

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.core.errors import NotFoundError


async def mealplan_sections(session: AsyncSession) -> list[dict[str, Any]]:
    # Sort in SQLite before the PDO-style read turns stored empty TEXT into null.
    rows = await session.execute(
        text("SELECT * FROM meal_plan_sections WHERE id>0 ORDER BY sort_number")
    )
    return [dict(row) for row in rows.mappings()]


async def mealplan_section_editor(
    session: AsyncSession, section_id: int | None
) -> dict[str, Any] | None:
    if section_id is None:
        return None
    result = await session.execute(
        text("SELECT * FROM meal_plan_sections WHERE id=:id"), {"id": section_id}
    )
    row = result.mappings().first()
    if row is None:
        raise NotFoundError("Meal plan section not found")
    return dict(row)
