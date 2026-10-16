from fastapi import APIRouter, Request, Response

from grocy.api.compatibility.responses import native_action_response
from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession

router = APIRouter(tags=["system"])


@router.get("/api/system/info")
async def system_info(request: Request, actor: AuthenticatedActor, session: DbSession) -> Response:
    return await native_action_response(request, session, "system_info", "", actor.user_id)


@router.get("/api/system/db-changed-time")
async def db_changed_time(
    request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "system_changed", "", actor.user_id)


@router.get("/api/system/config")
async def system_config(
    request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "system_config", "", actor.user_id)


@router.get("/api/system/time")
async def system_time(request: Request, actor: AuthenticatedActor, session: DbSession) -> Response:
    return await native_action_response(request, session, "system_time", "", actor.user_id)


@router.get("/api/system/localization-strings")
async def localization_strings(
    request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "system_strings", "", actor.user_id)


@router.post("/api/system/log-missing-localization")
async def log_missing_localization(
    request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "system_missing", "", actor.user_id)
