"""HTTP method handling for the legacy API, without an interpreter adapter."""

import re

from fastapi import Request, Response
from fastapi.exception_handlers import http_exception_handler
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from grocy.compatibility.php import php_error
from grocy.core.errors import grocy_error_handler


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
        path = scope.get("path", "")
        if (
            scope["type"] != "http"
            or not path.startswith("/api/")
            or path.startswith("/api/v2/")
            or path == "/api/health"
        ):
            await self.app(scope, receive, send)
            return
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
