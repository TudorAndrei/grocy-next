from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from grocy.core.actor import Actor
from grocy.core.config import get_settings
from grocy.core.errors import GrocyError, UnauthorizedError
from grocy.core.permissions import resolve_permissions
from grocy.db.models.users import ApiKey, UserPermission
from grocy.db.session import get_session_factory


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


async def authenticate_request(
    request: Request, session: AsyncSession, grocy_api_key: str | None = None
) -> Actor:
    if actor := getattr(request.state, "grocy_actor", None):
        return actor
    settings = get_settings()
    key = grocy_api_key or request.headers.get(settings.api_key_header)
    calendar_secret = (
        request.query_params.get("secret") if request.url.path == "/api/calendar/ical" else None
    )
    candidates = [
        (key, "default"),
        (request.query_params.get(settings.api_key_header), "default"),
        (calendar_secret, "calendar"),
    ]
    if not any(candidate for candidate, _ in candidates):
        raise UnauthorizedError("Missing API key")
    for candidate, key_type in candidates:
        if not candidate:
            continue
        try:
            actor = await authenticate_key(session, candidate, key_type=key_type)
        except UnauthorizedError:
            continue
        return actor
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


async def authenticate_key(session: AsyncSession, key: str, *, key_type: str = "default") -> Actor:
    stmt = (
        select(ApiKey)
        .options(selectinload(ApiKey.user))
        .where(ApiKey.api_key == key, ApiKey.key_type == key_type)
    )
    row = (await session.execute(stmt)).scalars().first()
    if row is None:
        raise UnauthorizedError("Invalid API key")
    if row.expires is not None and row.expires < datetime.now(UTC).replace(tzinfo=None):
        raise UnauthorizedError("API key expired")
    session.info["actor_user_id"] = row.user_id
    ids = set(
        (
            await session.execute(
                select(UserPermission.permission_id).where(UserPermission.user_id == row.user_id)
            )
        )
        .scalars()
        .all()
    )
    return Actor(
        user_id=row.user_id,
        username=row.user.username,
        api_key=key,
        is_admin=1 in ids,
        permissions=resolve_permissions(ids),
    )


def request_permission(request: Request, user_id: int | None = None) -> str:
    path = request.url.path.removeprefix("/api/")
    action = path.rsplit("/", 1)[-1]
    write = request.method not in {"GET", "HEAD", "OPTIONS"}
    if path.startswith(("v2/mcp", "user/settings", "files/", "system")) or path == "user":
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
    if path.startswith("recipes/") and write:
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
