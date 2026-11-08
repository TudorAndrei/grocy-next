"""Authenticated, limited presentation reads for the native tasks page."""

from typing import Any

from fastapi import APIRouter, Request

from grocy.compatibility.lessql import query_parameters
from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession
from grocy.domains.household.task_overview import task_overview

router = APIRouter(tags=["household"])


@router.get("/tasks/overview")
async def tasks_page(
    request: Request, actor: AuthenticatedActor, session: DbSession
) -> dict[str, Any]:
    # Native TasksController has no domain-read grant; mutation APIs enforce their own permissions.
    return await task_overview(
        session, actor.user_id, query_parameters(request.scope["query_string"])
    )
