"""HTTP method handling for the legacy API, without an interpreter adapter."""

import re
from urllib.parse import unquote_to_bytes

from fastapi import Request, Response
from fastapi.exception_handlers import http_exception_handler
from starlette.exceptions import HTTPException
from starlette.routing import Match
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from grocy.compatibility.php import php_error
from grocy.core.config import get_settings
from grocy.core.errors import grocy_error_handler


async def decode_route_arguments(request: Request) -> None:
    """Slim decodes each captured argument after it decodes the route path."""
    for name, value in request.path_params.items():
        if isinstance(value, str):
            request.path_params[name] = unquote_to_bytes(value).decode("utf-8", "surrogateescape")


async def legacy_http_error(request: Request, error: Exception) -> Response:
    assert isinstance(error, HTTPException)
    path = request.url.path
    if (
        not path.startswith("/api/")
        or path.startswith("/api/v2/")
        or path == "/api/health"
        or error.status_code not in {404, 405}
    ):
        return await http_exception_handler(request, error)
    methods: set[str] = set()
    for template, operations in request.app.openapi()["paths"].items():
        pattern = "".join(
            "[^/]+" if part.startswith("{") else re.escape(part)
            for part in re.split(r"(\{[^}]+\})", template)
        )
        if re.fullmatch(pattern, path):
            methods.update(method.upper() for method in operations)
    order = ["GET", "POST", "PUT", "DELETE"]
    allowed = [method for method in order if method in methods]
    if path != "/api/":
        allowed.append("OPTIONS")
    status = 405 if allowed else 404
    message = (
        "Method not allowed. Must be one of: " + ", ".join(allowed) if allowed else "Not found."
    )
    return await grocy_error_handler(request, php_error(message, status_code=status))


def _raw_prefix_length(raw: bytes, prefix: str) -> int:
    """Locate the mount's original bytes without decoding the remaining resource name."""
    position = 0
    for expected in prefix.encode("utf-8", "surrogateescape"):
        if raw[position : position + 1] == b"%" and len(raw[position + 1 : position + 3]) == 2:
            try:
                actual = int(raw[position + 1 : position + 3], 16)
            except ValueError:
                actual = raw[position]
                position += 1
            else:
                position += 3
        else:
            actual = raw[position]
            position += 1
        if actual != expected:
            raise ValueError("The raw path does not contain the decoded mount")
    return position


def application_scope(scope: Scope) -> Scope:
    """Resolve the configured mount and one optional visible front-controller segment."""
    if scope["type"] != "http":
        return scope
    settings = get_settings()
    prefix = settings.base_path.rstrip("/")
    raw = scope.get("raw_path", b"")
    original = unquote_to_bytes(raw).decode("utf-8", "surrogateescape") if raw else scope["path"]
    mount = ""
    path = original
    if prefix and original.startswith(prefix + "/"):
        mount, path = prefix, original[len(prefix) :]
    elif prefix:
        return scope
    # Source-valid BASE_PATH can already include index.php. Do not strip it twice.
    # The optional segment also accepts the canonical URL generated for a base-only mount.
    if (
        settings.disable_url_rewriting is not False
        and not prefix.endswith("/index.php")
        and (path == "/index.php" or path.startswith("/index.php/"))
    ):
        mount += "/index.php"
    if not mount:
        return scope
    path = (
        scope["path"][len(mount) :] if scope["path"].startswith(mount) else original[len(mount) :]
    )
    path = path or "/"
    return {
        **scope,
        "path": path,
        "root_path": scope.get("root_path", "") + mount,
        "raw_path": raw[_raw_prefix_length(raw, mount) :] if raw else raw,
        "grocy_api_path": path,
        "grocy_legacy_base_path": path.startswith("/api/")
        and not path.startswith("/api/v2/")
        and path != "/api/health",
    }


def _would_redirect_slashes(scope: Scope) -> bool:
    router = scope["app"].router
    if not router.redirect_slashes:
        return False
    # Preserve real path-converter matches and existing method errors. Slim's
    # exact routes do not acquire Starlette's alternate trailing-slash alias.
    if any(route.matches(scope)[0] != Match.NONE for route in router.routes):
        return False
    path = scope["path"]
    alternate = {**scope, "path": path.rstrip("/") if path.endswith("/") else path + "/"}
    if alternate["path"] == "/api/health":
        return False
    return any(route.matches(alternate)[0] != Match.NONE for route in router.routes)


class LegacyHttpMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        scope = application_scope(scope)
        path = scope.get("path", "")
        if (
            scope["type"] != "http"
            or not path.startswith("/api/")
            or path.startswith("/api/v2/")
            or path == "/api/health"
        ):
            await self.app(scope, receive, send)
            return
        if raw := scope.get("raw_path"):
            # Use the original URI so the ASGI server and TestClient take the same path.
            path = unquote_to_bytes(raw).decode("utf-8", "surrogateescape")
            scope = {**scope, "path": path, "grocy_api_path": path}
        if scope["method"] == "OPTIONS":
            response = Response(headers={"Content-Type": "text/html; charset=UTF-8"})
            await response(scope, receive, send)
            return
        if scope["method"] == "HEAD":

            async def send_head(message: Message) -> None:
                if message["type"] == "http.response.body":
                    message = {**message, "body": b""}
                await send(message)

            await self._dispatch({**scope, "method": "GET"}, receive, send_head)
            return
        await self._dispatch(scope, receive, send)

    async def _dispatch(self, scope: Scope, receive: Receive, send: Send) -> None:
        if _would_redirect_slashes(scope):
            response = await legacy_http_error(Request(scope), HTTPException(status_code=404))
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
