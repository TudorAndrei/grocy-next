import base64
import re
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from grocy.compatibility.input import json_body
from grocy.compatibility.lessql import query_parameters
from grocy.compatibility.php import PhpJSONResponse, php_error, php_json
from grocy.core.auth import AuthenticatedActor, CurrentActor
from grocy.core.config import get_settings
from grocy.core.deps import DbSession
from grocy.core.urls import request_base
from grocy.domains.system.service import SystemService, localization

router = APIRouter(tags=["system"])


async def _legacy_page(request: Request) -> None:
    request.scope["grocy_legacy_base_path"] = True


@router.api_route(
    "/manifest",
    methods=["GET", "HEAD"],
    dependencies=[Depends(_legacy_page)],
    include_in_schema=False,
)
async def manifest(request: Request, _actor: AuthenticatedActor) -> Response:
    parameters = query_parameters(request.scope.get("query_string", b""))
    data = parameters.get("data", "")
    if not isinstance(data, str):
        raise php_error(
            "base64_decode(): Argument #1 ($string) must be of type string, array given"
        )
    encoded = re.sub(rb"[^A-Za-z0-9+/]", b"", data.encode("utf-8", "surrogateescape"))
    if len(encoded) % 4 == 1:
        encoded = encoded[:-1]
    decoded = base64.b64decode(encoded + b"=" * (-len(encoded) % 4))
    pieces = decoded.decode("utf-8", "surrogateescape").split("#")
    # Native json_encode returns an empty body for malformed UTF-8.
    body = php_json(
        {
            "name": "Grocy " + pieces[0],
            "short_name": "Grocy " + pieces[0],
            "icons": [{"src": "./img/icon-1024.png", "sizes": "1024x1024", "type": "image/png"}],
            "start_url": pieces[1] if len(pieces) > 1 else None,
            "background_color": "#333131",
            "theme_color": "#333131",
            "display": "standalone",
        }
    )
    return Response(body, media_type="application/json")


@router.get("/api/system/info")
async def system_info(request: Request, _actor: CurrentActor, session: DbSession) -> dict[str, Any]:
    return await SystemService(session).info(request.headers.get("user-agent", "unknown"))


@router.get("/api/system/db-changed-time")
async def db_changed_time(_actor: CurrentActor, session: DbSession) -> dict[str, str]:
    return SystemService(session).changed_time()


@router.get("/api/system/config")
async def system_config(
    request: Request, actor: CurrentActor, session: DbSession
) -> dict[str, Any]:
    service = SystemService(session)
    locale = await service.locale(
        actor.user_id, ",".join(request.headers.getlist("accept-language"))
    )
    return service.config(locale)


@router.get("/api/system/time")
async def system_time(request: Request, _actor: CurrentActor, session: DbSession) -> dict[str, Any]:
    parameters = query_parameters(request.scope.get("query_string", b""))
    return await SystemService(session).time(parameters.get("offset", "0"))


@router.get("/api/system/localization-strings")
async def localization_strings(
    request: Request, actor: CurrentActor, session: DbSession
) -> Response:
    locale = await SystemService(session).locale(
        actor.user_id, ",".join(request.headers.getlist("accept-language"))
    )
    return JSONResponse(
        localization(locale, get_settings().mode),
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
