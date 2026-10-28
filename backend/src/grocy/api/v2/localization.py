"""Public language catalogs for the web login and application screens."""

from typing import Any

from fastapi import APIRouter, Request, Response

from grocy.core.config import get_settings
from grocy.core.deps import DbSession
from grocy.core.errors import NotFoundError
from grocy.domains.system.service import SystemService, available_locales, localization

router = APIRouter(tags=["localization"])


@router.get("/localization")
async def web_localization(
    request: Request, response: Response, session: DbSession, locale: str | None = None
) -> dict[str, Any]:
    languages = available_locales()
    if locale:
        if locale not in languages:
            raise NotFoundError("Language not found")
    else:
        locale = await SystemService(session).locale(
            -1, ",".join(request.headers.getlist("accept-language"))
        )
    response.headers["Cache-Control"] = "max-age=2592000"
    response.headers["Vary"] = "Accept-Language"
    return {
        "locale": locale,
        "direction": "rtl" if locale == "he_IL" else "ltr",
        "languages": languages,
        "catalog": localization(locale, get_settings().mode),
    }
