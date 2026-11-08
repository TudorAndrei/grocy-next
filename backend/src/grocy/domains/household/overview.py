"""Presentation context of the pinned chores overview, separate from native writes."""

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.php import coerced_int, empty, loose_equals, php_string
from grocy.core.actor import Actor
from grocy.core.time import server_timezone
from grocy.domains.household.service import HouseholdService
from grocy.domains.users.service import UsersService


async def chores_overview(session: AsyncSession, actor: Actor) -> dict[str, Any]:
    household = HouseholdService(session)
    rows = await household.current_chores({})
    days = (
        coerced_int(
            php_string(await UsersService(session).setting(actor.user_id, "chores_due_soon_days"))
        )
        or 0
    )
    now = datetime.now(server_timezone())
    now_text = now.strftime("%Y-%m-%d %H:%M:%S")
    today = now.strftime("%Y-%m-%d 23:59:59")
    soon = (now + timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    masters = (
        (
            await session.execute(
                text(
                    "SELECT id,name,period_type,track_date_only FROM chores "
                    "ORDER BY name COLLATE NOCASE"
                )
            )
        )
        .mappings()
        .all()
    )
    by_id = {row["id"]: row for row in masters}
    values = (
        (
            await session.execute(
                text(
                    "SELECT object_id,name,value FROM userfield_values_resolved "
                    "WHERE entity='chores'"
                )
            )
        )
        .mappings()
        .all()
    )
    for row in rows:
        master = by_id.get(row["chore_id"])
        row["name"] = master["name"] if master else None
        row["period_type"] = master["period_type"] if master else None
        date = row["next_estimated_execution_time"]
        row["due_type"] = (
            "overdue"
            if not empty(date) and date < now_text
            else "duetoday"
            if not empty(date) and date <= today
            else "duesoon"
            if not empty(date) and days > 0 and date <= soon
            else ""
        )
        row["custom_values"] = {
            value["name"]: value["value"]
            for value in values
            if loose_equals(value["object_id"], row["chore_id"])
        }
        # The page only needs these safe names, never the raw users table.
        row.pop("next_execution_assigned_user", None)
    return {
        "rows": rows,
        "users": [
            {name: user[name] for name in ("id", "username", "display_name")}
            for user in await household.users()
        ],
        "next_x_days": days,
        "current_user_id": actor.user_id,
    }
