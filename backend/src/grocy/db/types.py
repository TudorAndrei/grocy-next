"""SQLite values that retain the date precision used by the Grocy API."""

from datetime import date, datetime

from sqlalchemy import Text
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator


def database_time(value: date | datetime | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="seconds")
    return value.isoformat()


class DateOrDateTime(TypeDecorator[date | datetime]):
    """Keep a stored date distinct from a timestamp at midnight."""

    impl = Text
    cache_ok = True

    def process_bind_param(
        self, value: date | datetime | str | None, dialect: Dialect
    ) -> str | None:
        if value is None or isinstance(value, str):
            return value
        return value.isoformat(sep=" ") if isinstance(value, datetime) else value.isoformat()

    def process_result_value(self, value: str | None, dialect: Dialect) -> date | datetime | None:
        if value is None:
            return None
        return date.fromisoformat(value) if len(value) == 10 else datetime.fromisoformat(value)
