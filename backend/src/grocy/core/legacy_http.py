"""HTTP method handling for the legacy API, without an interpreter adapter."""

import re
from urllib.parse import unquote_to_bytes

from fastapi import Request, Response
from fastapi.exception_handlers import http_exception_handler
from starlette.exceptions import HTTPException
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


class LegacyHttpMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            prefix = get_settings().base_path.rstrip("/")
            if prefix and scope["path"].startswith(prefix + "/"):
                path = scope["path"][len(prefix) :]
                raw = scope.get("raw_path", b"")
                encoded = prefix.encode()
                scope = {
                    **scope,
                    "path": path,
                    "root_path": scope.get("root_path", "") + prefix,
                    "raw_path": raw[len(encoded) :] if raw.startswith(encoded) else raw,
                    "grocy_api_path": path,
                    "grocy_legacy_base_path": path.startswith("/api/")
                    and not path.startswith("/api/v2/")
                    and path != "/api/health",
                }
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

            await self.app({**scope, "method": "GET"}, receive, send_head)
            return
        await self.app(scope, receive, send)
