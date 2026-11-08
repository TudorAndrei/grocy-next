"""Authenticated native-page reads for the chores overview and its card."""

from typing import Any

from fastapi import APIRouter

from grocy.compatibility.sanitizer import render_html
from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession, HouseholdSvc
from grocy.domains.household.overview import chores_overview

router = APIRouter(tags=["household"])


@router.get("/chores/overview")
async def overview(actor: AuthenticatedActor, session: DbSession) -> dict[str, Any]:
    return await chores_overview(session, actor)


@router.get("/chores/{chore_id}/card")
async def card(
    chore_id: int, _actor: AuthenticatedActor, household: HouseholdSvc
) -> dict[str, Any]:
    details = await household.chore_details(chore_id)
    description = details["chore"]["description"] or ""
    details["description_html"] = render_html(
        description.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br>\n")
    )
    return details
