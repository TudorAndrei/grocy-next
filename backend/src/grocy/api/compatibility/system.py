from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Response

from grocy.core.auth import CurrentActor
from grocy.core.config import get_settings

router = APIRouter(tags=["system"])


def _database_path() -> Path | None:
    url = get_settings().database_url
    if ":///" in url:
        return Path(url.split(":///", 1)[1])
    return None


@router.get("/api/system/db-changed-time")
async def db_changed_time(_actor: CurrentActor) -> dict[str, str]:
    path = _database_path()
    if path is not None and path.exists():
        changed = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC).replace(tzinfo=None)
        return {"changed_time": changed.isoformat()}
    return {"changed_time": datetime.now().isoformat()}


@router.get("/api/system/config")
async def system_config(_actor: CurrentActor) -> dict[str, Any]:
    return get_settings().model_dump(
        mode="json",
        exclude={
            "dev_open_api_key",
            "mcp_api_key",
            "database_url",
        },
    )


@router.get("/api/system/time")
async def system_time(_actor: CurrentActor) -> dict[str, str]:
    return {"timezone": "UTC", "time": datetime.now(UTC).replace(tzinfo=None).isoformat()}


@router.get("/api/system/localization-strings")
async def localization_strings(_actor: CurrentActor) -> dict[str, Any]:
    return {}


@router.post("/api/system/log-missing-localization", status_code=204)
async def log_missing_localization(_actor: CurrentActor) -> Response:
    return Response(status_code=204)
