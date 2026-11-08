"""Use the same calendar events for the web agenda and the legacy export."""

from typing import Any

from fastapi import APIRouter, Request

from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import CalendarSvc
from grocy.core.urls import request_base

router = APIRouter(tags=["calendar"])


@router.get("/calendar/events")
async def calendar_events(
    request: Request, actor: AuthenticatedActor, calendar: CalendarSvc
) -> list[dict[str, Any]]:
    languages = ",".join(request.headers.getlist("accept-language"))
    locale = await calendar.locale(actor.user_id, languages)
    return await calendar.events(locale, str(request.base_url).rstrip("/"))


@router.get("/calendar/context")
async def calendar_context(
    request: Request, actor: AuthenticatedActor, calendar: CalendarSvc
) -> dict[str, Any]:
    languages = ",".join(request.headers.getlist("accept-language"))
    return await calendar.context(actor.user_id, languages, request_base(request))
