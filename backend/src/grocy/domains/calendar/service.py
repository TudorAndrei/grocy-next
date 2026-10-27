"""Calendar events and subscription links from the Grocy 4.5.0 calendar services."""

import os
import secrets
import string
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import String, insert, type_coerce
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.php import (
    empty,
    find,
    is_numeric,
    loose_equals,
    numeric_value,
    php_date,
    php_string,
)
from grocy.core.config import get_settings
from grocy.core.time import server_timezone
from grocy.core.urls import construct_url
from grocy.db.compatibility_views import configure_compatibility_queries
from grocy.db.models.users import ApiKey
from grocy.domains.calendar.ical import calendar
from grocy.domains.system.service import localization

_LOCALIZATION = Path(__file__).parents[2] / "_vendor" / "grocy-core" / "localization"
_KEY_CHARACTERS = string.digits + string.ascii_lowercase + string.ascii_uppercase
_KEY_TYPE = "special-purpose-calendar-ical"


def _translator(locale: str) -> Callable[[str], str]:
    messages = localization(locale, get_settings().mode)["messages"][""]

    def translate(text: str) -> str:
        translated = messages.get(text)
        return translated[0] if translated and translated[0] else text

    return translate


def _name(row: dict[str, Any] | None) -> str:
    return "" if row is None else php_string(row["name"])


def _positive(value: Any) -> bool:
    if isinstance(value, str) and not is_numeric(value):
        return value > "0"
    return value is not None and numeric_value(value) > 0


def _event(title: str, start: Any, date_format: str) -> dict[str, Any]:
    return {"title": title, "start": start, "date_format": date_format}


class CalendarService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _rows(self, statement: str, *parameters: Any) -> list[dict[str, Any]]:
        connection = await self.session.connection()
        result = await connection.exec_driver_sql(statement, parameters)
        return [dict(row) for row in result.mappings()]

    async def locale(self, user_id: int, accept_language: str) -> str:
        available = {".", "..", *os.listdir(_LOCALIZATION)}
        settings = await self._rows(
            "SELECT value FROM `user_settings` WHERE user_id = ? AND `key` = 'locale'", user_id
        )
        setting = settings[0]["value"] if settings else None
        if not empty(setting) and php_string(setting) in available:
            return php_string(setting)
        preferences: dict[str, float] = {}
        for element in accept_language.split(","):
            parts = element.split(";q=")
            preferences[parts[0]] = float(numeric_value(parts[1])) if len(parts) > 1 else 1.0
        for name, _quality in sorted(preferences.items(), key=lambda item: -item[1]):
            for candidate in (name, name[:5], name[:2]):
                if candidate in available:
                    return candidate
        return get_settings().default_locale

    async def _current_stock(self) -> list[dict[str, Any]]:
        entries: dict[Any, dict[str, Any]] = {}
        for row in await self._rows("SELECT * FROM stock_current"):
            entries.setdefault(row["product_id"], row)
        return list(entries.values())

    async def events(self, locale: str, base: str) -> list[dict[str, Any]]:
        settings = get_settings()
        translate = _translator(locale)
        await configure_compatibility_queries(self.session)
        events: list[dict[str, Any]] = []
        products = await self._rows("SELECT * FROM `products`")
        if settings.feature_enabled("STOCK_BEST_BEFORE_DATE_TRACKING"):
            prefix = translate("Product due") + ": "
            for entry in await self._current_stock():
                if _positive(entry["amount"]):
                    product = find(products, "id", entry["product_id"])
                    events.append(
                        _event(prefix + _name(product), entry["best_before_date"], "date")
                    )
        if settings.feature_enabled("TASKS"):
            prefix = translate("Task due") + ": "
            for task in await self._rows("SELECT * FROM `tasks_current`"):
                events.append(_event(prefix + php_string(task["name"]), task["due_date"], "date"))
        if settings.feature_enabled("CHORES"):
            users = await self._rows("SELECT * FROM `users_dto`")
            chores = await self._rows("SELECT * FROM `chores` WHERE (active = 1)")
            prefix = translate("Chore due") + ": "
            for current in await self._rows("SELECT * FROM `chores_current`"):
                chore = find(chores, "id", current["chore_id"])
                assigned = current["next_execution_assigned_to_user_id"]
                suffix = ""
                if not empty(assigned):
                    user = find(users, "id", assigned)
                    name = "" if user is None else php_string(user["display_name"])
                    suffix = " (" + translate("assigned to %s").replace("%s", name, 1) + ")"
                event = _event(
                    prefix + _name(chore) + suffix,
                    current["next_estimated_execution_time"],
                    "datetime",
                )
                event["allDay"] = chore is not None and loose_equals(chore["track_date_only"], 1)
                events.append(event)
        if settings.feature_enabled("BATTERIES"):
            batteries = await self._rows("SELECT * FROM `batteries` WHERE (active = 1)")
            prefix = translate("Battery charge cycle due") + ": "
            for current in await self._rows("SELECT * FROM `batteries_current`"):
                battery = find(batteries, "id", current["battery_id"])
                events.append(
                    _event(
                        prefix + _name(battery), current["next_estimated_charge_time"], "datetime"
                    )
                )
        if settings.feature_enabled("RECIPES_MEALPLAN"):
            events += await self._meal_plan_events(translate, base, products)
        return events

    async def _meal_plan_events(
        self, translate: Callable[[str], str], base: str, products: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        sections = await self._rows("SELECT * FROM `meal_plan_sections`")
        recipes = await self._rows("SELECT * FROM `recipes` WHERE `type` = 'normal'")
        sources: list[tuple[str, str, Callable[[dict[str, Any]], str]]] = [
            (
                "recipe",
                "Meal plan recipe",
                lambda entry: _name(find(recipes, "id", entry["recipe_id"])),
            ),
            ("note", "Meal plan note", lambda entry: php_string(entry["note"])),
            (
                "product",
                "Meal plan product",
                lambda entry: _name(find(products, "id", entry["product_id"])),
            ),
        ]
        events: list[dict[str, Any]] = []
        for kind, label, title in sources:
            prefix = translate(label) + ": "
            for entry in await self._rows("SELECT * FROM `meal_plan` WHERE `type` = ?", kind):
                section = find(sections, "id", entry["section_id"])
                start, date_format = entry["day"], "date"
                if section is not None and not empty(section["time_info"]):
                    start = (
                        php_string(entry["day"]) + " " + php_string(section["time_info"]) + ":00"
                    )
                    date_format = "datetime"
                heading = ""
                if section is not None and not empty(section["name"]):
                    heading = php_string(section["name"]) + ": "
                event = _event(prefix + heading + title(entry), start, date_format)
                if kind == "recipe":
                    event["description"] = construct_url(
                        base, "/mealplan?week=" + php_string(entry["day"])
                    )
                events.append(event)
        return events

    async def ical(self, locale: str, base: str) -> str:
        return calendar(await self.events(locale, base), server_timezone(), datetime.now(UTC))

    async def sharing_link(self, user_id: int, base: str) -> str:
        keys = await self._rows(
            "SELECT * FROM `api_keys` WHERE (key_type = ? AND expires > ?)", _KEY_TYPE, php_date()
        )
        if keys:
            key = php_string(keys[0]["api_key"])
        else:
            key = "".join(secrets.choice(_KEY_CHARACTERS) for _ in range(50))
            connection = await self.session.connection()
            await connection.execute(
                insert(ApiKey).values(
                    api_key=key,
                    user_id=user_id,
                    expires=type_coerce("2999-12-31 23:59:59", String()),
                    key_type=_KEY_TYPE,
                    description=None,
                )
            )
            await self.session.commit()
        return construct_url(base, "/api/calendar/ical?secret=" + key)
