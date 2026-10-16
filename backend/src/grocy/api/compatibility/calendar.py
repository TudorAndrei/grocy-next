from fastapi import APIRouter, Request, Response

from grocy.api.compatibility.responses import native_action_response
from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession

router = APIRouter(tags=["calendar"])


@router.get("/api/calendar/ical")
async def calendar_ical(
    request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "calendar_ical", "", actor.user_id)


@router.get("/api/calendar/ical/sharing-link")
async def calendar_sharing_link(
    request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "calendar_sharing", "", actor.user_id)
