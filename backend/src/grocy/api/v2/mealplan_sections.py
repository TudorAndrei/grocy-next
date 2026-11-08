"""Authenticated read contexts for native meal-plan section pages."""

from typing import Any

from fastapi import APIRouter

from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession
from grocy.domains.recipes.sections import mealplan_section_editor, mealplan_sections

router = APIRouter(tags=["mealplan"])


@router.get("/mealplan-sections")
async def get_sections(
    _actor: AuthenticatedActor, session: DbSession
) -> dict[str, list[dict[str, Any]]]:
    return {"rows": await mealplan_sections(session)}


@router.get("/mealplan-sections/editor")
async def get_section_editor(
    _actor: AuthenticatedActor, session: DbSession, section_id: int | None = None
) -> dict[str, Any]:
    return {"section": await mealplan_section_editor(session, section_id)}
