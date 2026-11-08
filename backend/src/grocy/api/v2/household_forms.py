"""Limited editor context for household forms; native mutation APIs stay unchanged."""

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter
from sqlalchemy import text

from grocy.compatibility.php import php_date
from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession, HouseholdSvc
from grocy.core.time import server_timezone
from grocy.domains.catalog.objects import GenericObjectsService

router = APIRouter(tags=["household"])


@router.get("/chores/{chore_id}/editor")
async def chore_editor(
    chore_id: int | Literal["new"],
    _actor: AuthenticatedActor,
    session: DbSession,
    household: HouseholdSvc,
) -> dict[str, Any]:
    objects = GenericObjectsService(session)
    chore = None if chore_id == "new" else await objects.read_objects("chores", str(chore_id))
    history = False
    initial_start_date = php_date()
    if isinstance(chore, dict):
        history = bool(
            await session.scalar(
                text("SELECT 1 FROM chores_log WHERE chore_id=:id LIMIT 1"), {"id": chore_id}
            )
        )
        start = chore.get("start_date")
        timezone = server_timezone()
        try:
            parsed_start = (
                datetime.fromisoformat(start) if start else datetime.fromtimestamp(0, timezone)
            )
        except ValueError:
            parsed_start = datetime.fromtimestamp(0, timezone)
        if parsed_start.tzinfo is not None:
            parsed_start = parsed_start.astimezone(timezone)
        initial_start_date = parsed_start.strftime("%Y-%m-%d %H:%M:%S")
    products = await session.execute(
        text(
            "SELECT p.id,p.name,q.name AS stock_unit_name FROM products p "
            "LEFT JOIN quantity_units q ON q.id=p.qu_id_stock ORDER BY p.name COLLATE NOCASE"
        )
    )
    return {
        "chore": chore,
        "has_history": history,
        "initial_start_date": initial_start_date,
        "users": [
            {name: user[name] for name in ("id", "username", "display_name")}
            for user in await household.users()
        ],
        "products": [dict(row) for row in products.mappings()],
    }


@router.get("/tasks/form-context")
async def task_form_context(
    actor: AuthenticatedActor, session: DbSession, household: HouseholdSvc
) -> dict[str, Any]:
    categories = await session.execute(
        text("SELECT id,name FROM task_categories WHERE active=1 ORDER BY name COLLATE NOCASE")
    )
    return {
        "users": await household.tracking_users(),
        "categories": [dict(row) for row in categories.mappings()],
        "current_user_id": actor.user_id,
    }
