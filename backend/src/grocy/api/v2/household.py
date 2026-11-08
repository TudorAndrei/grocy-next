"""Authenticated native household page reads with limited presentation fields."""

from typing import Any

from fastapi import APIRouter, Request

from grocy.compatibility.lessql import query_parameters
from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import HouseholdSvc

router = APIRouter(tags=["household"])


@router.get("/chores/tracking/users")
async def chore_tracking_users(
    _actor: AuthenticatedActor, household: HouseholdSvc
) -> list[dict[str, Any]]:
    return await household.tracking_users()


@router.get("/chores/journal")
async def chore_journal(
    request: Request, _actor: AuthenticatedActor, household: HouseholdSvc
) -> dict[str, Any]:
    return await household.journal("chore", query_parameters(request.scope["query_string"]))


@router.get("/batteries/journal")
async def battery_journal(
    request: Request, _actor: AuthenticatedActor, household: HouseholdSvc
) -> dict[str, Any]:
    return await household.journal("battery", query_parameters(request.scope["query_string"]))
