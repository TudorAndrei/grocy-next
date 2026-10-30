"""Keep year-zero dates accepted by the pinned Grocy API and SQLite."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Never, Self, overload

from sqlalchemy import Date
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator


class LegacyDate(date):
    # The Gregorian calendar repeats every 400 years. Use that cycle for arithmetic.
    def __new__(cls, year: int, month: int, day: int) -> Self:
        return super().__new__(cls, year + 400, month, day)

    @property
    def year(self) -> int:
        return super().year - 400

    def isoformat(self) -> str:
        year = f"{self.year:04d}" if self.year >= 0 else f"-{abs(self.year):04d}"
        return f"{year}-{self.month:02d}-{self.day:02d}"

    def __str__(self) -> str:
        return self.isoformat()

    def toordinal(self) -> int:
        return super().toordinal() - 146097

    def __eq__(self, other: object) -> bool:
        return isinstance(other, date) and self.toordinal() == other.toordinal()

    def __ne__(self, other: object) -> bool:
        return not self == other

    def __lt__(self, other: date) -> bool:
        return self.toordinal() < other.toordinal()

    def __le__(self, other: date) -> bool:
        return self.toordinal() <= other.toordinal()

    def __gt__(self, other: date) -> bool:
        return self.toordinal() > other.toordinal()

    def __ge__(self, other: date) -> bool:
        return self.toordinal() >= other.toordinal()

    def __hash__(self) -> int:
        return (
            hash(date(self.year, self.month, self.day))
            if self.year > 0
            else hash((self.year, self.month, self.day))
        )

    def __add__(self, other: timedelta) -> Self:
        shifted = date(super().year, self.month, self.day) + other
        return type(self)(shifted.year - 400, shifted.month, shifted.day)

    __radd__ = __add__

    @overload
    def __sub__(self, other: datetime) -> Never: ...

    @overload
    def __sub__(self, other: timedelta) -> Self: ...

    @overload
    def __sub__(self, other: date) -> timedelta: ...

    def __sub__(self, other: date | timedelta) -> Self | timedelta:
        if isinstance(other, datetime):
            raise TypeError("Cannot subtract a datetime from a date")
        if isinstance(other, timedelta):
            return self + -other
        return timedelta(days=self.toordinal() - other.toordinal())

    def __rsub__(self, other: date) -> timedelta:
        return timedelta(days=other.toordinal() - self.toordinal())


def parse_date(value: str) -> date:
    if value.startswith("0000-"):
        return LegacyDate(0, int(value[5:7]), int(value[8:10]))
    return date.fromisoformat(value)


class NativeDate(TypeDecorator[date | None]):
    impl = Date
    cache_ok = True

    def process_bind_param(self, value: date | str | None, dialect: Dialect) -> date | None:
        return parse_date(value[:10]) if isinstance(value, str) else value

    def result_processor(self, dialect: Dialect, coltype: Any):
        def process(value: Any) -> date | None:
            return parse_date(value) if value is not None else None

        return process
