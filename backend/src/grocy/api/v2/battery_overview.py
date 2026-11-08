"""Native-page presentation reads for the battery overview."""

from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter
from sqlalchemy import text

from grocy.compatibility.php import coerced_int, loose_equals, php_string
from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession, HouseholdSvc
from grocy.core.time import server_timezone
from grocy.domains.users.service import UsersService

router = APIRouter(tags=["household"])


@router.get("/batteries/overview")
async def overview(
    actor: AuthenticatedActor, session: DbSession, household: HouseholdSvc
) -> dict[str, Any]:
    """Project the same initial metadata and due state as BatteriesController."""
    current = await household.current_batteries({})
    raw_days = await UsersService(session).setting(actor.user_id, "batteries_due_soon_days")
    days = coerced_int(php_string(raw_days)) or 0
    now = datetime.now(server_timezone())
    now_text = now.strftime("%Y-%m-%d %H:%M:%S")
    today = now.strftime("%Y-%m-%d 23:59:59")
    soon = (now + timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    values = (
        (
            await session.execute(
                text(
                    "SELECT object_id,name,value FROM userfield_values_resolved "
                    "WHERE entity='batteries'"
                )
            )
        )
        .mappings()
        .all()
    )
    rows = []
    for entry in current:
        battery = entry["battery"]
        if battery is None:
            continue
        date = entry["next_estimated_charge_time"]
        due_type = ""
        if battery["charge_interval_days"] > 0:
            date_text = php_string(date)
            if date_text < now_text:
                due_type = "overdue"
            elif date_text <= today:
                due_type = "duetoday"
            elif days > 0 and date_text <= soon:
                due_type = "duesoon"
        rows.append(
            {
                "id": entry["battery_id"],
                "name": battery["name"],
                "used_in": battery["used_in"],
                "charge_interval_days": battery["charge_interval_days"],
                "last_tracked_time": entry["last_tracked_time"],
                "next_estimated_charge_time": date,
                "due_type": due_type,
                "custom_values": {
                    value["name"]: value["value"]
                    for value in values
                    if loose_equals(value["object_id"], entry["battery_id"])
                },
            }
        )
    return {"rows": rows, "next_x_days": days}
