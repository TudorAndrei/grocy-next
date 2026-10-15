"""Run the pinned Grocy user, permission, and setting controller."""

from fastapi import APIRouter, Request, Response

from grocy.api.compatibility.responses import native_action_response
from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession

router = APIRouter(tags=["users"])


@router.get("/api/user")
async def get_current_user(
    request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "user_current", "", actor.user_id)


@router.get("/api/user/settings")
async def get_user_settings(
    request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "settings", "", actor.user_id)


@router.get("/api/user/settings/{setting_key}")
async def get_user_setting(
    setting_key: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "setting_get", setting_key, actor.user_id)


@router.put("/api/user/settings/{setting_key}", status_code=204)
async def put_user_setting(
    setting_key: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "setting_set", setting_key, actor.user_id)


@router.delete("/api/user/settings/{setting_key}", status_code=204)
async def delete_user_setting(
    setting_key: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(
        request, session, "setting_delete", setting_key, actor.user_id
    )


@router.get("/api/users")
async def list_users(request: Request, actor: AuthenticatedActor, session: DbSession) -> Response:
    return await native_action_response(request, session, "users", "", actor.user_id)


@router.post("/api/users", status_code=204)
async def create_user(request: Request, actor: AuthenticatedActor, session: DbSession) -> Response:
    return await native_action_response(request, session, "user_create", "", actor.user_id)


@router.put("/api/users/{user_id}", status_code=204)
async def update_user(
    user_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "user_edit", user_id, actor.user_id)


@router.delete("/api/users/{user_id}", status_code=204)
async def delete_user(
    user_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "user_delete", user_id, actor.user_id)


@router.get("/api/users/{user_id}/permissions")
async def get_user_permissions(
    user_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "permissions_get", user_id, actor.user_id)


@router.post("/api/users/{user_id}/permissions", status_code=204)
async def add_user_permission(
    user_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "permission_add", user_id, actor.user_id)


@router.put("/api/users/{user_id}/permissions", status_code=204)
async def set_user_permissions(
    user_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await native_action_response(request, session, "permissions_set", user_id, actor.user_id)
