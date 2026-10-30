from typing import Any

from fastapi import APIRouter, Request, Response

from grocy.compatibility.input import json_body
from grocy.compatibility.lessql import query_parameters
from grocy.compatibility.php import parse_request_body, request_body
from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession
from grocy.domains.users.service import UsersService

router = APIRouter(tags=["users"])


@router.get("/api/user")
async def get_current_user(actor: CurrentActor, session: DbSession) -> list[dict[str, Any]]:
    return await UsersService(session).current_user(actor.user_id)


@router.get("/api/user/settings")
async def get_user_settings(actor: CurrentActor, session: DbSession) -> dict[str, Any]:
    return await UsersService(session).settings(actor.user_id)


@router.get("/api/user/settings/{setting_key}")
async def get_user_setting(
    setting_key: str, actor: CurrentActor, session: DbSession
) -> dict[str, Any]:
    return {"value": await UsersService(session).setting(actor.user_id, setting_key)}


@router.put("/api/user/settings/{setting_key}", status_code=204)
async def put_user_setting(
    setting_key: str, request: Request, actor: CurrentActor, session: DbSession
) -> Response:
    payload = await request_body(request) or {}
    value = payload.get("value")
    if value is None and "value" in payload:
        value = ""
    await UsersService(session).set_setting(actor.user_id, setting_key, value)
    return Response(status_code=204)


@router.delete("/api/user/settings/{setting_key}", status_code=204)
async def delete_user_setting(
    setting_key: str, actor: CurrentActor, session: DbSession
) -> Response:
    await UsersService(session).delete_setting(actor.user_id, setting_key)
    return Response(status_code=204)


@router.get("/api/users")
async def list_users(
    request: Request, _actor: CurrentActor, session: DbSession
) -> list[dict[str, Any]]:
    return await UsersService(session).list_users(request.scope["query_string"])


@router.post("/api/users", status_code=204)
async def create_user(request: Request, _actor: CurrentActor, session: DbSession) -> Response:
    await UsersService(session).create_user(await json_body(request))
    return Response(status_code=204)


@router.put("/api/users/{user_id}", status_code=204)
async def update_user(
    user_id: str, request: Request, _actor: CurrentActor, session: DbSession
) -> Response:
    await UsersService(session).update_user(user_id, await request_body(request) or {})
    return Response(status_code=204)


@router.delete("/api/users/{user_id}", status_code=204)
async def delete_user(user_id: str, _actor: CurrentActor, session: DbSession) -> Response:
    await UsersService(session).delete_user(user_id)
    return Response(status_code=204)


@router.get("/api/users/{user_id}/permissions")
async def get_user_permissions(
    user_id: str, _actor: CurrentActor, session: DbSession
) -> list[dict[str, Any]]:
    return await UsersService(session).permissions(user_id)


@router.post("/api/users/{user_id}/permissions", status_code=204)
async def add_user_permission(
    user_id: str, request: Request, _actor: CurrentActor, session: DbSession
) -> Response:
    payload = await request_body(request, caught=True) or {}
    await UsersService(session).add_permission(user_id, payload.get("permission_id"))
    return Response(status_code=204)


@router.put("/api/users/{user_id}/permissions", status_code=204)
async def set_user_permissions(
    user_id: str, request: Request, _actor: CurrentActor, session: DbSession
) -> Response:
    media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    raw = await request.body()
    if media_type == "application/json" or media_type.endswith("+json"):
        payload = parse_request_body(raw, filter_values=False) or {}
    elif media_type == "application/x-www-form-urlencoded":
        payload = query_parameters(raw)
    else:
        payload = {}
    await UsersService(session).set_permissions(user_id, payload.get("permissions"))
    return Response(status_code=204)
