from fastapi import APIRouter, Request, Response
from sqlalchemy.exc import DBAPIError

from grocy.compatibility.input import database_error
from grocy.compatibility.php import PhpJSONResponse
from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import CalendarSvc
from grocy.core.errors import GrocyError
from grocy.core.urls import request_base

router = APIRouter(tags=["calendar"])


@router.get("/api/calendar/ical")
async def calendar_ical(
    request: Request, actor: AuthenticatedActor, calendar: CalendarSvc
) -> Response:
    languages = ",".join(request.headers.getlist("accept-language"))
    locale = await calendar.locale(actor.user_id, languages)
    try:
        document = await calendar.ical(locale, request_base(request))
    except DBAPIError as error:
        raise GrocyError(database_error(error).message, code=None) from error
    return Response(
        document,
        media_type="text/calendar",
        headers={"Content-Disposition": 'attachment; filename="Grocy.ics"'},
    )


@router.get("/api/calendar/ical/sharing-link")
async def calendar_sharing_link(
    request: Request, actor: AuthenticatedActor, calendar: CalendarSvc
) -> Response:
    try:
        url = await calendar.sharing_link(actor.user_id, request_base(request))
    except DBAPIError as error:
        raise GrocyError(database_error(error).message, code=None) from error
    return PhpJSONResponse({"url": url})
