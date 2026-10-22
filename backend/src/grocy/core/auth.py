import base64
import os
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy import or_, select, text, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.core.actor import Actor
from grocy.core.config import get_settings
from grocy.core.errors import GrocyError, UnauthorizedError
from grocy.core.permissions import resolve_permissions
from grocy.core.time import server_timezone
from grocy.db.models.users import ApiKey, ImportedApiKey, User, UserPermission
from grocy.db.session import get_session_factory


class _MissingKeyUser(UnauthorizedError):
    """A selected credential has no user, so no later credential can replace it."""


async def get_db_session(request: Request) -> AsyncGenerator[AsyncSession]:
    if session := getattr(request.state, "grocy_session", None):
        yield session
        return
    factory = get_session_factory()
    async with factory() as session:
        if request.method not in {
            "GET",
            "HEAD",
            "OPTIONS",
        } and get_settings().database_url.startswith("sqlite"):
            await session.execute(text("BEGIN IMMEDIATE"))
            session.info["write_lock"] = True
        yield session


async def require_api_key(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    grocy_api_key: Annotated[str | None, Header(alias="GROCY-API-KEY")] = None,
) -> Actor:
    actor = await authenticate_request(request, session, grocy_api_key)
    require_request_permission(request, actor)
    return actor


async def authenticated_api_key(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    grocy_api_key: Annotated[str | None, Header(alias="GROCY-API-KEY")] = None,
) -> Actor:
    # Native controllers check permissions at their original exception boundary.
    return await authenticate_request(request, session, grocy_api_key)


async def authenticate_request(
    request: Request, session: AsyncSession, grocy_api_key: str | None = None
) -> Actor:
    if actor := getattr(request.state, "grocy_actor", None):
        return actor
    settings = get_settings()
    if (
        settings.use_native_php
        and not request.url.path.startswith("/api/v2/")
        and request.url.path != "/api/health"
    ):
        return await authenticate_native_request(request, session)
    key = grocy_api_key or request.headers.get(settings.api_key_header)
    calendar_secret = (
        request.query_params.get("secret") if request.url.path == "/api/calendar/ical" else None
    )
    candidates = [
        (key, "default"),
        (key, "grocy-next"),
        (request.query_params.get(settings.api_key_header), "default"),
        (request.query_params.get(settings.api_key_header), "grocy-next"),
        (calendar_secret, "special-purpose-calendar-ical"),
        (calendar_secret, "calendar"),
    ]
    if not any(candidate for candidate, _ in candidates):
        raise UnauthorizedError("Missing API key")
    for candidate, key_type in candidates:
        if not candidate:
            continue
        try:
            actor = await authenticate_key(session, candidate, key_type=key_type)
        except _MissingKeyUser:
            raise
        except UnauthorizedError:
            continue
        return actor
    raise UnauthorizedError("Invalid API key")


async def authenticate_native_request(request: Request, session: AsyncSession) -> Actor:
    import json

    from grocy.api.compatibility.responses import native_action_response

    header_name = get_settings().api_key_header.lower().encode()
    raw_header = b", ".join(
        value.strip(b" \t")
        for name, value in request.scope["headers"]
        if name.lower() == header_name
    )
    try:
        header = raw_header.decode()
    except UnicodeDecodeError:
        header = ""
    context = getattr(request.state, "native_context", {})
    bypass = context.get("mode", "production") in {"dev", "demo", "prerelease"} or context.get(
        "disable_auth", False
    )
    if not bypass and header not in {"", "0"}:
        try:
            return await authenticate_key(session, header, key_type="grocy-next")
        except _MissingKeyUser:
            raise
        except UnauthorizedError:
            pass
    response = await native_action_response(
        request,
        session,
        "authenticate",
        "",
        1,
        arguments={"header": get_settings().api_key_header},
        body=b"",
    )
    body = json.loads(bytes(response.body))
    if response.status_code != 200:
        raise GrocyError(
            body["error_message"],
            status_code=response.status_code,
            code=None,
            details=body.get("error_details"),
        )
    if body["selected"]:
        if body["user_id"] is None:
            raise _MissingKeyUser("Invalid API key")
        if context.get("direct_database"):
            return Actor(
                user_id=body["user_id"],
                username="",
                is_admin=False,
            )
        return await actor_for_user(session, body["user_id"], allow_missing=bypass)
    # Application keys retain their extension expiry rules and calendar scope.
    for key, key_type in [
        (body["header"], "grocy-next"),
        (body["query_key"], "grocy-next"),
        (body["secret"] if request.url.path == "/api/calendar/ical" else None, "calendar"),
    ]:
        if not isinstance(key, str):
            continue
        try:
            key = base64.b64decode(key).decode()
        except UnicodeDecodeError:
            continue
        if key in {"", "0"}:
            continue
        try:
            return await authenticate_key(session, key, key_type=key_type)
        except _MissingKeyUser:
            raise
        except UnauthorizedError:
            continue
    raise UnauthorizedError("Invalid API key")


def require_request_permission(request: Request, actor: Actor) -> None:
    permission = request_permission(request, actor.user_id)
    try:
        actor.require(permission)
    except GrocyError:
        path = request.url.path.removeprefix("/api/")
        action = path.rsplit("/", 1)[-1]
        # These upstream controllers catch PermissionMissingException and return JSON.
        if path.startswith("chores/") and action in {"execute", "undo"}:
            raise GrocyError(f"Permission missing: {permission}", code=None) from None
        if path.startswith("users/") and action == "permissions":
            raise GrocyError(
                f"Permission missing: {permission}", status_code=403, code=None
            ) from None
        raise


async def authenticate_key(
    session: AsyncSession, key: str, *, key_type: str | None = None
) -> Actor:
    if key_type == "special-purpose-calendar-ical":
        local_time = datetime.now(server_timezone()).strftime("%Y-%m-%d %H:%M:%S")
        valid = ApiKey.expires > local_time
    else:
        now = datetime.now(UTC).replace(tzinfo=None)
        valid = or_(ApiKey.expires.is_(None), ApiKey.expires >= now)
    stmt = (
        select(ApiKey.id, ApiKey.user_id, User.id, valid)
        .select_from(ApiKey)
        .outerjoin(User, ApiKey.user_id == User.id)
        .where(
            ApiKey.api_key == key,
            ApiKey.key_type == key_type
            if key_type is not None
            else ApiKey.key_type.in_(["default", "grocy-next"]),
        )
    )
    identity = (await session.execute(stmt)).first()
    if identity is None:
        raise UnauthorizedError("Invalid API key")
    api_key_id, user_id, existing_user_id, is_valid = identity
    if key_type not in {"special-purpose-calendar-ical", "calendar"}:
        try:
            imported = await session.scalar(
                select(ImportedApiKey.api_key_id).where(ImportedApiKey.api_key_id == api_key_id)
            )
        except OperationalError:
            imported = None
        if imported is not None:
            expires = await session.scalar(select(ApiKey.expires).where(ApiKey.id == api_key_id))
            if expires is None:
                raise UnauthorizedError("Invalid API key")
    if not is_valid:
        raise UnauthorizedError("API key expired")
    stamp = datetime.now(server_timezone()).replace(tzinfo=None)
    database = session.get_bind().engine.url.database
    path: Path | None = None
    preserve_mtime = None
    if database and database != ":memory:":
        path = Path(database)
        if path.exists():
            preserve_mtime = path.stat()
    await session.execute(
        update(ApiKey).where(ApiKey.api_key == key).values(last_used=stamp)
    )
    await session.commit()
    if preserve_mtime is not None and path is not None:
        os.utime(path, (preserve_mtime.st_atime, preserve_mtime.st_mtime))
    if existing_user_id is None:
        raise _MissingKeyUser("Invalid API key")
    return await actor_for_user(session, user_id, key=key)


async def actor_for_user(
    session: AsyncSession, user_id: int, *, key: str | None = None, allow_missing: bool = False
) -> Actor:
    result = await session.execute(select(User.username).where(User.id == user_id))
    username = result.scalar_one_or_none() if allow_missing else result.scalar_one()
    session.info["actor_user_id"] = user_id
    ids = set(
        (
            await session.execute(
                select(UserPermission.permission_id).where(UserPermission.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    return Actor(
        user_id=user_id,
        username=username or "",
        api_key=key,
        is_admin=1 in ids,
        permissions=resolve_permissions(ids),
    )


def request_permission(request: Request, user_id: int | None = None) -> str:
    path = request.scope.get("grocy_api_path", request.url.path).removeprefix("/api/")
    action = path.rsplit("/", 1)[-1]
    write = request.method not in {"GET", "HEAD", "OPTIONS"}
    if (
        path.startswith(
            ("v2/mcp", "v2/files/", "v2/user/settings", "user/settings", "files/", "system")
        )
        or path == "user"
    ):
        return ""
    if path.startswith("v2/api-keys"):
        return "ADMIN"
    if path.startswith("users"):
        if action == "permissions":
            return "ADMIN"
        if not write:
            return "USERS_READ"
        if request.method == "POST":
            return "USERS_CREATE"
        if request.method == "PUT" and action == str(user_id):
            return "USERS_EDIT_SELF"
        return "USERS_EDIT"
    if not path.startswith("v2/"):
        if "/external-lookup/" in path:
            return "MASTER_DATA_EDIT"
        if not write:
            return ""
        if (path.startswith("recipes/") and action == "copy") or (
            path.startswith("chores/") and action == "calculate-next-assignments"
        ):
            return ""
        if path.startswith("chores/") and "/merge/" in path:
            return "MASTER_DATA_EDIT"
    if write:
        actions = {
            ("chores", "execute"): "CHORE_TRACK_EXECUTION",
            ("chores", "undo"): "CHORE_UNDO_EXECUTION",
            ("batteries", "charge"): "BATTERIES_TRACK_CHARGE_CYCLE",
            ("batteries", "undo"): "BATTERIES_UNDO_CHARGE_CYCLE",
            ("tasks", "complete"): "TASKS_MARK_COMPLETED",
            ("tasks", "undo"): "TASKS_UNDO_EXECUTION",
        }
        if permission := actions.get((path.split("/")[0], action)):
            return permission
    if path.startswith(("recipes/", "v2/recipes/")) and write:
        if action == "consume":
            return "STOCK_CONSUME"
        if action == "add-not-fulfilled-products-to-shoppinglist":
            return "SHOPPINGLIST_ITEMS_ADD"
    if path.startswith("stock/shoppinglist"):
        return (
            "SHOPPINGLIST_ITEMS_DELETE"
            if action in {"clear", "remove-product"}
            else "SHOPPINGLIST_ITEMS_ADD"
        )
    if path.startswith("v2/shopping"):
        return "SHOPPINGLIST"
    if path.startswith("stock"):
        if "/external-lookup/" in path:
            return "MASTER_DATA_EDIT"
        if write and (action == "undo" or path.startswith("stock/entry/") or "/merge/" in path):
            return "STOCK_EDIT"
        actions = {
            "add": "PURCHASE",
            "consume": "CONSUME",
            "open": "OPEN",
            "inventory": "INVENTORY",
            "transfer": "TRANSFER",
        }
        return f"STOCK_{actions[action]}" if write and action in actions else "STOCK"
    if path.startswith("chores/") and action == "reschedule":
        return "MASTER_DATA_EDIT"
    if "nutrition" in path:
        return "STOCK" if not write or action == "proposals" else "MASTER_DATA_EDIT"
    if "meal-plan" in path:
        return "RECIPES_MEALPLAN"
    if path.startswith("objects/"):
        entity = path.split("/")[1]
        if entity == "api_keys":
            return "ADMIN"
        if entity == "permission_hierarchy":
            return ""
        if write and entity in {"shopping_list", "shopping_lists"}:
            return (
                "SHOPPINGLIST_ITEMS_DELETE"
                if request.method == "DELETE"
                else "SHOPPINGLIST_ITEMS_ADD"
            )
        if write and entity in {
            "chores",
            "batteries",
            "tasks",
            "task_categories",
            "meal_plan_sections",
        }:
            return "MASTER_DATA_EDIT"
        groups = {
            "meal_plan": "RECIPES_MEALPLAN",
            "meal_plan_sections": "RECIPES_MEALPLAN",
            "recipes": "RECIPES",
            "recipes_pos": "RECIPES",
            "recipes_nestings": "RECIPES",
            "chores": "CHORES",
            "chores_log": "CHORES",
            "tasks": "TASKS",
            "task_categories": "TASKS",
            "batteries": "BATTERIES",
            "battery_charge_cycles": "BATTERIES",
            "equipment": "EQUIPMENT",
            "shopping_list": "SHOPPINGLIST",
            "shopping_lists": "SHOPPINGLIST",
        }
        return groups.get(entity, "MASTER_DATA_EDIT" if write else "STOCK")
    for prefix, permission in (
        ("recipes", "RECIPES"),
        ("v2/recipes", "RECIPES"),
        ("chores", "CHORES"),
        ("tasks", "TASKS"),
        ("batteries", "BATTERIES"),
        ("calendar", "CALENDAR"),
    ):
        if path.startswith(prefix):
            return permission
    return "MASTER_DATA_EDIT" if write else "STOCK"


CurrentActor = Annotated[Actor, Depends(require_api_key)]
AuthenticatedActor = Annotated[Actor, Depends(authenticated_api_key)]
