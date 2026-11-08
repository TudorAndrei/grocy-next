"""Native user/access presentation extensions; existing API writes keep their own grants."""

from typing import Any

from fastapi import APIRouter, Request

from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession
from grocy.domains.users.presentation import UsersPresentation

router = APIRouter(tags=["users", "access"])


@router.get("/users/overview")
async def users_overview(actor: AuthenticatedActor, session: DbSession) -> dict[str, Any]:
    return await UsersPresentation(session).overview(actor)


@router.get("/users/{user_id}/form-context")
async def user_form_context(
    user_id: str, actor: AuthenticatedActor, session: DbSession
) -> dict[str, Any]:
    return await UsersPresentation(session).form(actor, None if user_id == "new" else user_id)


@router.get("/users/{user_id}/permissions-context")
async def user_permissions_context(
    user_id: str, actor: AuthenticatedActor, session: DbSession
) -> dict[str, Any]:
    return await UsersPresentation(session).permissions(actor, user_id)


@router.get("/access/api-keys-context")
async def api_keys_context(
    actor: AuthenticatedActor, session: DbSession, request: Request
) -> dict[str, Any]:
    return await UsersPresentation(session).keys(actor, request.scope["query_string"])


@router.get("/access/api-keys/new")
async def native_create_key(
    actor: AuthenticatedActor, session: DbSession, request: Request
) -> dict[str, int]:
    return await UsersPresentation(session).create_key(actor, request.scope["query_string"])
