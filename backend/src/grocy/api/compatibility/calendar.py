import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Request, Response
from sqlalchemy import select

from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession
from grocy.db.models.catalog import Product
from grocy.db.models.household import Task
from grocy.db.models.mealplan import MealPlanEntry
from grocy.db.models.recipes import Recipe
from grocy.db.models.users import ApiKey
from grocy.domains.household.service import HouseholdService

router = APIRouter(tags=["calendar"])


def _escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace("\r", "")
        .replace("\n", "\\n")
        .replace(",", "\\,")
        .replace(";", "\\;")
    )


def _fold(line: str) -> str:
    parts, current = [], ""
    for char in line:
        if len((current + char).encode()) > 75:
            parts.append(current)
            current = " "
        current += char
    return "\r\n".join([*parts, current])


@router.get("/api/calendar/ical")
async def calendar_ical(_actor: CurrentActor, session: DbSession) -> Response:
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//grocy-next//EN", "CALSCALE:GREGORIAN"]

    def event(uid: str, start: str, title: str, description: str = "") -> None:
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{uid}@grocy-next",
                f"DTSTAMP:{stamp}",
                start,
                f"SUMMARY:{_escape(title)}",
                f"DESCRIPTION:{_escape(description)}",
                "END:VEVENT",
            ]
        )

    meals = (await session.execute(select(MealPlanEntry))).scalars().all()
    for meal in meals:
        if meal.done:
            continue
        title = meal.note or "Meal"
        if meal.recipe_id:
            recipe = await session.get(Recipe, meal.recipe_id)
            title = recipe.name if recipe else title
        elif meal.product_id:
            product = await session.get(Product, meal.product_id)
            title = product.name if product else title
        event(
            f"meal-plan-{meal.id}",
            f"DTSTART;VALUE=DATE:{meal.day.strftime('%Y%m%d')}",
            title,
            meal.note or "",
        )
    tasks = (
        (await session.execute(select(Task).where(Task.due_date.is_not(None), Task.done == 0)))
        .scalars()
        .all()
    )
    for task in tasks:
        if task.due_date:
            event(
                f"task-{task.id}",
                f"DTSTART:{task.due_date.strftime('%Y%m%dT%H%M%S')}",
                task.name,
                task.description or "",
            )
    household = HouseholdService(session)
    for chore in await household.list_chores():
        due = chore["next_estimated_execution_time"]
        if due:
            event(
                f"chore-{chore['id']}",
                f"DTSTART:{datetime.fromisoformat(due).strftime('%Y%m%dT%H%M%S')}",
                chore["name"],
            )
    for battery in await household.list_batteries():
        due = battery["next_estimated_charge_time"]
        if due:
            event(
                f"battery-{battery['id']}",
                f"DTSTART:{datetime.fromisoformat(due).strftime('%Y%m%dT%H%M%S')}",
                f"Charge {battery['name']}",
            )
    lines.append("END:VCALENDAR")
    return Response(
        "\r\n".join(_fold(line) for line in lines) + "\r\n",
        media_type="text/calendar",
        headers={"Content-Disposition": 'attachment; filename="Grocy.ics"'},
    )


@router.get("/api/calendar/ical/sharing-link")
async def calendar_sharing_link(
    request: Request, actor: CurrentActor, session: DbSession
) -> dict[str, str]:
    key = await session.scalar(
        select(ApiKey).where(ApiKey.user_id == actor.user_id, ApiKey.key_type == "calendar")
    )
    if key is None:
        key = ApiKey(
            user_id=actor.user_id,
            api_key=secrets.token_urlsafe(32),
            key_type="calendar",
            description="Calendar subscription",
        )
        session.add(key)
        await session.commit()
    return {"url": f"{request.base_url}api/calendar/ical?secret={key.api_key}"}
