"""Authenticated presentation context for the native meal-plan calendar."""

from typing import Any

from fastapi import APIRouter, Request

from grocy.compatibility.lessql import query_parameters
from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession
from grocy.domains.recipes.calendar import mealplan_calendar

router = APIRouter(tags=["mealplan"])


@router.get("/meal-plan/calendar")
async def calendar(
    request: Request, _actor: AuthenticatedActor, session: DbSession
) -> dict[str, Any]:
    return await mealplan_calendar(session, query_parameters(request.scope["query_string"]))
