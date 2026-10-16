"""Apply the original Grocy route, CORS, and HTTP response rules."""

import base64
from typing import Any

from fastapi import Request, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from grocy.compatibility.purifier import InputPurifier
from grocy.core.errors import GrocyError, grocy_error_handler


class NativeProtocol:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        if (
            scope["type"] != "http"
            or not path.startswith("/api/")
            or path.startswith("/api/v2/")
            or path in {"/api/v2", "/api/health"}
        ):
            await self.app(scope, receive, send)
            return
        runtime: InputPurifier = scope["app"].state.input_purifier
        method = scope["method"]
        try:
            result: dict[str, Any] = await runtime.protocol(
                method, scope.get("raw_path", path.encode())
            )
        except GrocyError as error:
            response = await grocy_error_handler(Request(scope), error)
            if method == "HEAD":
                response.body = b""
            await response(scope, receive, send)
            return
        cors = [
            (name.lower().encode(), ", ".join(values).encode())
            for name, values in result["headers"].items()
            if name.lower().startswith("access-control-")
        ]
        unauthorized = False

        async def native_send(message: Message) -> None:
            nonlocal unauthorized
            if message["type"] == "http.response.start":
                unauthorized = message["status"] == 401
                names = {name for name, _value in cors}
                headers = [
                    (name, value) for name, value in message.get("headers", []) if name not in names
                ]
                if unauthorized:
                    headers = [
                        (name, value)
                        for name, value in headers
                        if name not in {b"content-type", b"content-length"}
                    ]
                    headers.extend(
                        [(b"content-type", b"text/html; charset=UTF-8"), (b"content-length", b"0")]
                    )
                message = {**message, "headers": [*headers, *cors]}
            elif message["type"] == "http.response.body" and (method == "HEAD" or unauthorized):
                message = {**message, "body": b""}
            await send(message)

        if not result["matched"]:
            response = Response(
                content=base64.b64decode(result["response"]),
                status_code=result["status"],
                headers={name: ", ".join(values) for name, values in result["headers"].items()},
            )
            await response(scope, receive, native_send)
            return
        if method == "HEAD":
            scope = {**scope, "method": "GET", "grocy_original_method": "HEAD"}
        await self.app(scope, receive, native_send)
