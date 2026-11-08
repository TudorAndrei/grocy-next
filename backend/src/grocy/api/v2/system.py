"""Presentation data for native system pages."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import nh3
from fastapi import APIRouter, Request

from grocy.compatibility.lessql import cookie_parameters
from grocy.core.auth import AuthenticatedActor
from grocy.core.deps import DbSession
from grocy.core.urls import construct_url, request_base
from grocy.domains.system.service import SystemService

router = APIRouter(tags=["system"])
_RESOURCES = Path(__file__).parents[2] / "_vendor" / "grocy-system"


@lru_cache
def changelog() -> dict[str, Any]:
    data = json.loads((_RESOURCES / "changelog.json").read_text())
    for item in data["changelog_items"]:
        item["body_html"] = nh3.clean(
            item["body_html"],
            tags={
                "a",
                "b",
                "blockquote",
                "br",
                "code",
                "del",
                "em",
                "h1",
                "h2",
                "h3",
                "h4",
                "h5",
                "h6",
                "hr",
                "img",
                "li",
                "ol",
                "p",
                "pre",
                "strong",
                "table",
                "tbody",
                "td",
                "th",
                "thead",
                "tr",
                "ul",
            },
            attributes={"a": {"href", "title"}, "img": {"src", "alt", "title"}},
            url_schemes={"http", "https"},
            clean_content_tags={"script", "style"},
            link_rel="noopener noreferrer",
        )
    return data


@router.get("/system/about")
async def about(request: Request, _actor: AuthenticatedActor, session: DbSession) -> dict[str, Any]:
    return {
        "system_info": await SystemService(session).info(
            request.headers.get("user-agent", "unknown")
        ),
        "changelog": changelog(),
    }


@router.get("/system/login-context")
async def login_context(request: Request) -> dict[str, str | bool]:
    """Public form targets and cookie presence, without credentials or an authenticated actor."""
    base = request_base(request)
    header = b"; ".join(
        value for name, value in request.scope["headers"] if name.lower() == b"cookie"
    )
    return {
        "login_url": construct_url(base, "/login"),
        "logout_url": construct_url(base, "/logout"),
        "browser_session_supplied": "grocy_session" in cookie_parameters(header),
    }
