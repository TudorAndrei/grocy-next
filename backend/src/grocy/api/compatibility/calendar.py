from datetime import UTC, datetime

from fastapi import APIRouter, Response
from sqlalchemy import select

from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession
from grocy.db.models.household import Task
from grocy.db.models.mealplan import MealPlanEntry

router = APIRouter(tags=["calendar"])


def _format_dtstamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")


@router.get("/api/calendar/ical")
async def calendar_ical(
    _actor: CurrentActor,
    session: DbSession,
) -> Response:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//grocy-next//EN",
        "CALSCALE:GREGORIAN",
    ]
    meal_rows = (await session.execute(select(MealPlanEntry))).scalars().all()
    for entry in meal_rows:
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:meal-plan-{entry.id}@grocy-next",
                f"DTSTAMP:{_format_dtstamp()}",
                f"DTSTART;VALUE=DATE:{entry.day.strftime('%Y%m%d')}",
                f"SUMMARY:Meal plan #{entry.id}",
                "END:VEVENT",
            ]
        )
    task_rows = (
        await session.execute(select(Task).where(Task.due_date.is_not(None)))
    ).scalars().all()
    for task in task_rows:
        if task.due_date is None:
            continue
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:task-{task.id}@grocy-next",
                f"DTSTAMP:{_format_dtstamp()}",
                f"DTSTART:{task.due_date.strftime('%Y%m%dT%H%M%S')}",
                f"SUMMARY:{task.name}",
                "END:VEVENT",
            ]
        )
    lines.append("END:VCALENDAR")
    body = "\r\n".join(lines) + "\r\n"
    return Response(content=body, media_type="text/calendar")


@router.get("/api/calendar/ical/sharing-link")
async def calendar_sharing_link(_actor: CurrentActor) -> dict[str, str]:
    return {"url": "/api/calendar/ical"}
