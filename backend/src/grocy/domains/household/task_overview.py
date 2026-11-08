"""Presentation data selected by the pinned TasksController::Overview page."""

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.php import empty, loose_equals, numeric_value, php_date, php_string
from grocy.db.compatibility_views import configure_compatibility_queries
from grocy.domains.household.service import HouseholdService
from grocy.domains.users.service import UsersService


def _due_type(due: Any, now: datetime, days: Any) -> str:
    if empty(due):
        return ""
    value = php_string(due)
    yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d 23:59:59")
    today = now.strftime("%Y-%m-%d 23:59:59")
    if value < yesterday:
        return "overdue"
    if value <= today:
        return "duetoday"
    interval = numeric_value(days)
    if interval > 0:
        try:
            threshold = (now + timedelta(days=interval)).strftime("%Y-%m-%d 23:59:59")
        except OverflowError:
            threshold = "9999-12-31 23:59:59"
        if value <= threshold:
            return "duesoon"
    return ""


async def task_overview(
    session: AsyncSession, user_id: int, parameters: dict[Any, Any]
) -> dict[str, Any]:
    await configure_compatibility_queries(session)
    include_done = "include_done" in parameters and parameters["include_done"] is not None
    statement = (
        "SELECT * FROM tasks ORDER BY name COLLATE NOCASE"
        if include_done
        else "SELECT * FROM tasks_current"
    )
    records = (await session.execute(text(statement))).mappings().all()
    categories = [
        dict(row)
        for row in (
            await session.execute(
                text(
                    "SELECT id,name FROM task_categories WHERE active=1 "
                    "ORDER BY name COLLATE NOCASE"
                )
            )
        ).mappings()
    ]
    users = await HouseholdService(session).users()
    fields = (
        (
            await session.execute(
                text(
                    "SELECT object_id,name,value FROM userfield_values_resolved "
                    "WHERE entity='tasks'"
                )
            )
        )
        .mappings()
        .all()
    )
    settings = await UsersService(session).settings(user_id)
    days = settings["tasks_due_soon_days"]
    now = datetime.fromisoformat(php_date())
    rows = []
    for record in records:
        category_id = record["category_id"]
        assigned_id = record["assigned_to_user_id"]
        category = next((row for row in categories if loose_equals(row["id"], category_id)), None)
        user = next((row for row in users if loose_equals(row["id"], assigned_id)), None)
        has_category = not loose_equals(category_id, None)
        rows.append(
            {
                "id": record["id"],
                "name": record["name"],
                "due_date": None if record["due_date"] is None else php_string(record["due_date"]),
                "done": record["done"],
                "due_type": _due_type(record["due_date"], now, days),
                "category_id": category_id,
                "has_category": has_category,
                "category_name": category["name"] if has_category and category else None,
                "assigned_to_user_id": assigned_id,
                "assigned_name": user["display_name"]
                if user and not loose_equals(assigned_id, None)
                else None,
                "custom_values": {
                    field["name"]: field["value"]
                    for field in fields
                    if loose_equals(field["object_id"], record["id"])
                },
            }
        )
    return {"rows": rows, "categories": categories, "next_days": days, "include_done": include_done}
