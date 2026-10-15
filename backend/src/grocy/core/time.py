"""The server time zone shared by API times and calendar events."""

import os
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def server_timezone() -> ZoneInfo:
    configured = os.environ.get("TZ")
    if configured is not None:
        name = configured.removeprefix(":") or "UTC"
    else:
        local = str(Path("/etc/localtime").resolve())
        name = local.partition("zoneinfo/")[2]
        if not name and Path("/etc/timezone").is_file():
            name = Path("/etc/timezone").read_text().strip()
    try:
        return ZoneInfo(name or "UTC")
    except (ValueError, ZoneInfoNotFoundError):
        return ZoneInfo("UTC")
