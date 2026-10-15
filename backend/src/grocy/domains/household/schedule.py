"""Grocy household recurrence rules, including fixed dates and rollover."""

from datetime import datetime, timedelta

from grocy.db.models.household import Chore

UNSCHEDULED = datetime(2999, 12, 31, 23, 59, 59)
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def next_execution(
    chore: Chore,
    last: datetime | None,
    average_hours: float | None,
    now: datetime,
    *,
    weekly_last: datetime | None = None,
) -> datetime | None:
    interval = chore.period_interval or 1
    if chore.rescheduled_date:
        due = chore.rescheduled_date
    elif last is None:
        due = chore.start_date or chore.row_created_timestamp or now
    elif chore.period_type == "manually":
        due = UNSCHEDULED
    elif chore.period_type == "hourly":
        due = last + timedelta(hours=interval)
    elif chore.period_type == "daily":
        due = last + timedelta(days=interval)
    elif chore.period_type == "weekly":
        days = {part.strip().lower() for part in (chore.period_config or "").split(",")}
        anchor = (weekly_last or last) + timedelta(days=1 + 7 * (interval - 1))
        candidates = [
            anchor + timedelta(days=(index - anchor.weekday()) % 7)
            for index, name in enumerate(WEEKDAYS)
            if name in days
        ]
        due = min(candidates) if candidates else None
    elif chore.period_type == "monthly":
        index = last.year * 12 + last.month - 1 + interval
        year, month = divmod(index, 12)
        due = datetime(year, month + 1, 1) + timedelta(days=(chore.period_days or 1) - 1)
    elif chore.period_type == "yearly":
        anniversary = chore.start_date or last
        # Adding days to the first of the month also handles leap day anniversaries.
        due = datetime(
            last.year + interval, anniversary.month, 1, last.hour, last.minute, last.second
        ) + timedelta(days=anniversary.day - 1)
    elif chore.period_type == "adaptive":
        due = last + timedelta(hours=average_hours or 0)
    else:
        due = None
    if due is None:
        return None
    if chore.track_date_only:
        due = due.replace(hour=23, minute=59, second=59, microsecond=0)
    if chore.rollover and due < now:
        due = datetime.combine(now.date(), due.time())
    return due
