import ast
import json
import os
import platform
import re
import sqlite3
from collections.abc import Iterable
from copy import deepcopy
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from grocy import __version__
from grocy.compatibility import client_defaults
from grocy.compatibility.php import INT_MAX, INT_MIN, empty, numeric_value, php_error, php_string
from grocy.core.config import get_settings
from grocy.core.errors import GrocyError
from grocy.core.time import server_timezone
from grocy.core.urls import construct_url

_CORE = Path(__file__).parents[2] / "_vendor" / "grocy-core"


@lru_cache
def openapi_specification() -> dict[str, Any]:
    return json.loads((_CORE / "grocy.openapi.json").read_text())


def _po_messages(path: Path) -> tuple[dict[str, dict[str, list[str]]], str | None]:
    messages: dict[str, dict[str, list[str]]] = {}
    plural_forms = None
    entry: dict[str, str] = {}
    active = ""

    def save() -> None:
        nonlocal plural_forms
        key = entry.get("msgid")
        if key == "":
            header = entry.get("msgstr", "")
            match = re.search(r"^Plural-Forms: (.+)$", header, re.MULTILINE)
            if match:
                plural_forms = match[1]
        elif key is not None:
            singular = entry.get("msgstr", entry.get("msgstr[0]", ""))
            plurals = [
                entry[name] for name in entry if name.startswith("msgstr[") and name != "msgstr[0]"
            ]
            messages.setdefault(entry.get("msgctxt", ""), {})[key] = (
                [singular, *plurals] if any(plurals) else [singular]
            )
        entry.clear()

    for line in [*path.read_text().splitlines(), ""]:
        line = line.strip()
        if not line:
            save()
            active = ""
        elif line.startswith('"') and active:
            entry[active] += ast.literal_eval(line)
        elif not line.startswith("#"):
            match = re.fullmatch(r'(msgid|msgstr(?:\[\d+\])?|msgctxt|msgid_plural)\s+(".*")', line)
            if match:
                active = match[1]
                entry[active] = ast.literal_eval(match[2])
    return messages, plural_forms


@lru_cache
def available_locales() -> tuple[str, ...]:
    return tuple(
        sorted(
            folder.name
            for folder in (_CORE / "localization").iterdir()
            if folder.is_dir() and re.fullmatch(r"[A-Za-z0-9_@-]+", folder.name)
        )
    )


@lru_cache
def localization(locale: str, mode: str) -> dict[str, Any]:
    defaults = client_defaults()["localization"]
    folder = _CORE / "localization" / locale
    if re.fullmatch(r"[A-Za-z0-9_@-]+", locale) is None or not folder.is_dir():
        return defaults
    messages: dict[str, dict[str, list[str]]] = {}
    plural_forms = None
    files = [
        "strings",
        "chore_assignment_types",
        "component_translations",
        "stock_transaction_types",
        "chore_period_types",
        "userfield_types",
        "permissions",
        "locales",
    ]
    if mode != "production":
        files.append("demo_data")
    for name in files:
        path = folder / f"{name}.po"
        if path.is_file():
            translated, forms = _po_messages(path)
            for context, values in translated.items():
                messages.setdefault(context, {}).update(values)
            plural_forms = forms or plural_forms
    count = re.search(r"nplurals\s*=\s*([0-9]+)", plural_forms or "")
    if count:
        size = int(count[1])
        for values in messages.values():
            for key, translations in values.items():
                if len(translations) > 1:
                    values[key] = [*translations, *([""] * size)][:size]
    return {"domain": defaults["domain"], "plural-forms": plural_forms, "messages": messages}


class SystemService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def locale(self, user_id: int, accept_language: str) -> str:
        available = {".", "..", *os.listdir(_CORE / "localization")}
        setting = await self.session.scalar(
            text("SELECT value FROM user_settings WHERE user_id=:user AND key='locale'"),
            {"user": user_id},
        )
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

    async def specification(self, base: str) -> dict[str, Any]:
        spec = deepcopy(openapi_specification())
        spec["info"]["version"] = client_defaults()["grocy_version"]["Version"]
        spec["info"]["description"] = spec["info"]["description"].replace(
            "PlaceHolderManageApiKeysUrl", construct_url(base, "/manageapikeys")
        )
        spec["servers"][0]["url"] = construct_url(base, "/api")
        schemas = spec["components"]["schemas"]
        exposed = schemas["ExposedEntity"]["enum"]
        names = await self.session.scalars(
            text("SELECT name FROM userentities ORDER BY name COLLATE NOCASE")
        )

        def enum(name: str, values: Iterable[str]) -> list[str]:
            result = deepcopy(schemas["StringEnumTemplate"])
            result["enum"] = sorted([*result["enum"], *values])
            schemas[name] = result
            return result["enum"]

        including = enum(
            "ExposedEntity_IncludingUserEntities",
            [*exposed, *("userentity-" + php_string(name) for name in names), "users"],
        )
        no_edit = schemas["ExposedEntityNoEdit"]["enum"]
        enum(
            "ExposedEntity_NotIncludingNotEditable",
            (name for name in exposed if name not in no_edit),
        )
        enum(
            "ExposedEntity_IncludingUserEntities_NotIncludingNotEditable",
            [*(name for name in including if name not in no_edit), "stock"],
        )
        for suffix, restriction in [("NotDeletable", "NoDelete"), ("NotListable", "NoListing")]:
            excluded = schemas["ExposedEntity" + restriction]["enum"]
            enum(
                "ExposedEntity_NotIncluding" + suffix,
                (name for name in exposed if name not in excluded),
            )
        return spec

    async def info(self, client: str = "unknown") -> dict[str, Any]:
        version = await self.session.scalar(text("SELECT MAX(migration) FROM migrations"))
        return {
            "grocy_version": client_defaults()["grocy_version"],
            "php_version": "",
            "python_version": platform.python_version(),
            "sqlite_version": sqlite3.sqlite_version,
            "db_version": version,
            "os": platform.platform(),
            "client": client,
            "server_version": __version__,
        }

    def changed_time(self) -> dict[str, str]:
        database = self.session.get_bind().engine.url.database
        timestamp = datetime.now(server_timezone()).timestamp()
        if database and database != ":memory:":
            path = Path(database)
            if path.is_file():
                timestamp = path.stat().st_mtime
        return {
            "changed_time": datetime.fromtimestamp(timestamp, server_timezone()).strftime(
                "%Y-%m-%d %H:%M:%S"
            )
        }

    def config(self, locale: str) -> dict[str, Any]:
        settings = get_settings()
        return {
            **client_defaults()["config"],
            **settings.feature_flags(),
            **settings.thermal_printer_configuration(),
            "MODE": settings.mode,
            **(
                {"DEMO_DB_SUFFIX": settings.demo_db_suffix}
                if settings.demo_db_suffix is not None
                else {}
            ),
            "CURRENCY": settings.currency,
            "ENERGY_UNIT": settings.energy_unit,
            "GROCYCODE_TYPE": settings.grocycode_type,
            "DEFAULT_LOCALE": settings.default_locale,
            "CALENDAR_FIRST_DAY_OF_WEEK": settings.calendar_first_day_of_week,
            "CALENDAR_SHOW_WEEK_OF_YEAR": settings.calendar_show_week_of_year,
            "MEAL_PLAN_FIRST_DAY_OF_WEEK": settings.meal_plan_first_day_of_week,
            "ENTRY_PAGE": settings.entry_page,
            "LOCALE": locale,
            "BASE_URL": settings.base_url,
            "BASE_PATH": settings.base_path,
            "DISABLE_URL_REWRITING": settings.disable_url_rewriting,
            "DEFAULT_PERMISSIONS": settings.default_permissions,
            "AUTH_CLASS": settings.auth_class_name(),
            "DISABLE_AUTH": settings.disable_auth,
            "REVERSE_PROXY_AUTH_HEADER": settings.reverse_proxy_auth_header,
            "REVERSE_PROXY_AUTH_USE_ENV": settings.reverse_proxy_auth_use_env,
            "STOCK_BARCODE_LOOKUP_PLUGIN": settings.stock_barcode_lookup_plugin,
            "LABEL_PRINTER_WEBHOOK": settings.label_printer_webhook,
            "LABEL_PRINTER_RUN_SERVER": settings.label_printer_run_server,
            "LABEL_PRINTER_HOOK_JSON": settings.label_printer_hook_json,
            "LABEL_PRINTER_PARAMS": settings.label_printer_params,
        }

    async def time(self, offset: Any = "0") -> dict[str, Any]:
        try:
            if (
                not isinstance(offset, str)
                or re.fullmatch(r"[+-]?(?:0|[1-9][0-9]*)", offset.strip()) is None
            ):
                raise ValueError
            seconds = int(offset)
            if not INT_MIN <= seconds <= INT_MAX:
                raise ValueError
            timestamp = int(datetime.now(UTC).timestamp()) + seconds
            if not INT_MIN <= timestamp <= INT_MAX:
                raise php_error(
                    "date(): Argument #2 ($timestamp) must be of type ?int, float given"
                )
            local = datetime.fromtimestamp(timestamp, server_timezone())
        except (ValueError, OverflowError, OSError) as error:
            raise GrocyError(
                'Query parameter "offset" is not a valid integer', code=None
            ) from error
        sqlite_time = await self.session.scalar(
            text("SELECT datetime(:timestamp,'unixepoch','localtime')"), {"timestamp": timestamp}
        )
        return {
            "timezone": str(local.tzinfo),
            "time_local": local.strftime("%Y-%m-%d %H:%M:%S"),
            "time_local_sqlite3": sqlite_time,
            "time_utc": local.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S"),
            "timestamp": timestamp,
            "offset": seconds,
        }

    def log_missing_localization(self, value: Any) -> None:
        if not isinstance(value, str):
            raise GrocyError("Missing localization text", code=None)
        if value:
            path = get_settings().datapath / "missing-localization.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            values = json.loads(path.read_text()) if path.is_file() else []
            if value not in values:
                values.append(value)
                path.write_text(json.dumps(values, ensure_ascii=False))
