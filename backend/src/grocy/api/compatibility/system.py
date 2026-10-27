from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from grocy.compatibility.input import json_body
from grocy.compatibility.lessql import query_parameters
from grocy.compatibility.php import PhpJSONResponse, php_error
from grocy.core.auth import CurrentActor
from grocy.core.config import get_settings
from grocy.core.deps import DbSession
from grocy.core.urls import request_base
from grocy.domains.system.service import SystemService, localization
from grocy.domains.users.service import UsersService

router = APIRouter(tags=["system"])


@router.get("/api/system/info")
async def system_info(request: Request, _actor: CurrentActor, session: DbSession) -> dict[str, Any]:
    return await SystemService(session).info(request.headers.get("user-agent", "unknown"))


@router.get("/api/system/db-changed-time")
async def db_changed_time(_actor: CurrentActor, session: DbSession) -> dict[str, str]:
    return SystemService(session).changed_time()


@router.get("/api/system/config")
async def system_config(actor: CurrentActor, session: DbSession) -> dict[str, Any]:
    locale = await UsersService(session).setting(actor.user_id, "locale")
    return SystemService(session).config(locale or get_settings().default_locale)


@router.get("/api/system/time")
async def system_time(request: Request, _actor: CurrentActor, session: DbSession) -> dict[str, Any]:
    parameters = query_parameters(request.scope.get("query_string", b""))
    return await SystemService(session).time(parameters.get("offset", "0"))


@router.get("/api/system/localization-strings")
async def localization_strings(actor: CurrentActor, session: DbSession) -> Response:
    locale = await UsersService(session).setting(actor.user_id, "locale")
    return JSONResponse(
        localization(locale or get_settings().default_locale, get_settings().mode),
        headers={"Cache-Control": "max-age=2592000"},
    )


@router.post("/api/system/log-missing-localization")
async def log_missing_localization(
    request: Request, _actor: CurrentActor, session: DbSession
) -> Response:
    if get_settings().mode == "dev":
        payload = await json_body(request)
        SystemService(session).log_missing_localization(payload.get("text"))
        return Response(status_code=204)
    raise php_error(
        "Slim\\Handlers\\Strategies\\RequestResponse::__invoke(): Return value must be of type "
        "Psr\\Http\\Message\\ResponseInterface, null returned"
    )


@router.get("/api/openapi/specification")
async def openapi_specification(
    request: Request, _actor: CurrentActor, session: DbSession
) -> Response:
    return PhpJSONResponse(await SystemService(session).specification(request_base(request)))
