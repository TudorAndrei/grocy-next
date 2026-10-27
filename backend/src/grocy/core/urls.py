"""Construct legacy links from the request host and configured URL rules."""

from fastapi import Request

from grocy.core.config import get_settings


def request_base(request: Request) -> str:
    forwarded = ", ".join(request.headers.getlist("x-forwarded-proto"))
    secure = "https" in forwarded or request.url.scheme == "https"
    return ("https" if secure else "http") + "://" + request.headers.get("host", "")


def construct_url(base: str, path: str) -> str:
    settings = get_settings()
    root = base if settings.base_url == "/" else settings.base_url
    rewriting = "" if settings.disable_url_rewriting is False else "/index.php"
    return root.rstrip("/") + rewriting + path
