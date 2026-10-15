import logging
import platform
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, Response
from sqlalchemy import func, select

from grocy import __version__
from grocy.compatibility import client_defaults
from grocy.core.auth import CurrentActor
from grocy.core.config import get_settings
from grocy.core.deps import DbSession
from grocy.core.errors import GrocyError
from grocy.core.time import server_timezone
from grocy.db.models.users import User

router = APIRouter(tags=["system"])
logger = logging.getLogger("grocy.localization")


def _database_path() -> Path | None:
    url = get_settings().database_url
    if ":///" in url:
        return Path(url.split(":///", 1)[1])
    return None


@router.get("/api/system/info")
async def system_info(request: Request, _actor: CurrentActor) -> dict[str, Any]:
    from grocy.domains.catalog.objects import ENTITY_MODELS
    from grocy.domains.catalog.views import VIEW_ENTITIES

    return {
        "grocy_version": client_defaults()["grocy_version"],
        "application": {"name": "grocy-next", "version": __version__},
        "compatibility_baseline": get_settings().grocy_baseline,
        "python_version": platform.python_version(),
        "php_version": request.app.state.input_purifier.php_version,
        "db_version": client_defaults()["db_version"],
        "sqlite_version": sqlite3.sqlite_version,
        "os": platform.platform(),
        "client": request.headers.get("user-agent", "unknown"),
        "modules": ["stock", "nutrition", "mcp", "recipes", "household", "units"],
        "exposed_entities": sorted(set(ENTITY_MODELS) | VIEW_ENTITIES),
    }


@router.get("/api/system/db-changed-time")
async def db_changed_time(_actor: CurrentActor) -> dict[str, str]:
    path = _database_path()
    files = (path, Path(str(path) + "-wal")) if path else ()
    times = [file.stat().st_mtime for file in files if file.exists()]
    zone = server_timezone()
    changed = datetime.fromtimestamp(max(times), zone) if times else datetime.now(zone)
    return {"changed_time": changed.strftime("%Y-%m-%d %H:%M:%S")}


@router.get("/api/system/config")
async def system_config(actor: CurrentActor, session: DbSession) -> dict[str, Any]:
    settings = get_settings()
    user = await session.get(User, actor.user_id)
    config = dict(client_defaults()["config"])
    config.update(
        DISABLE_AUTH=False,
        MODE="production",
        CURRENCY=settings.currency,
        DEFAULT_PERMISSIONS=settings.default_permissions,
        LABEL_PRINTER_RUN_SERVER=settings.label_printer_run_server,
        USER_USERNAME=actor.username,
        USER_PICTURE_FILE_NAME=user.picture_file_name if user else None,
    )
    config.update(settings.feature_flags())
    return config


@router.get("/api/system/time")
async def system_time(
    _actor: CurrentActor, session: DbSession, offset: Annotated[str, Query()] = "0"
) -> dict[str, Any]:
    try:
        seconds = int(offset)
        timestamp = int(datetime.now(UTC).timestamp()) + seconds
        utc = datetime.fromtimestamp(timestamp, UTC).replace(tzinfo=None)
    except (ValueError, OverflowError, OSError) as error:
        raise GrocyError("Query parameter 'offset' must be a valid number of seconds") from error
    sqlite_time = await session.scalar(
        select(func.datetime("now", f"{seconds:+} seconds", "localtime"))
    )
    return {
        "timezone": server_timezone().key,
        "time_local": datetime.fromtimestamp(timestamp, server_timezone()).strftime(
            "%Y-%m-%d %H:%M:%S"
        ),
        "time_local_sqlite3": sqlite_time,
        "time_utc": utc.isoformat(sep=" ", timespec="seconds"),
        "timestamp": timestamp,
        "offset": seconds,
        "time": utc.isoformat(),
    }


@router.get("/api/system/localization-strings")
async def localization_strings(_actor: CurrentActor) -> dict[str, Any]:
    return client_defaults()["localization"]


@router.post("/api/system/log-missing-localization", status_code=204)
async def log_missing_localization(
    _actor: CurrentActor, body: dict[str, Any] | None = None
) -> Response:
    if get_settings().debug and body and isinstance(body.get("text"), str):
        logger.warning("Missing localization: %r", body["text"][:2000])
    return Response(status_code=204)
