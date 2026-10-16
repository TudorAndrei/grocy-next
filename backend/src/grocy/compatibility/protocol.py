"""Apply the original Grocy route, CORS, and HTTP response rules."""

import base64
from typing import Any

from fastapi import Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from grocy.api.compatibility.responses import native_configuration
from grocy.compatibility.generic import NativeStatements
from grocy.compatibility.purifier import InputPurifier
from grocy.compatibility.values import decode_value
from grocy.core.config import get_settings
from grocy.core.errors import GrocyError, grocy_error_handler
from grocy.db.session import get_session_factory


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
        settings = get_settings()
        parent: InputPurifier = scope["app"].state.input_purifier
        runtime = InputPurifier(
            settings.php_executable,
            user_id=None,
            datapath=settings.datapath.resolve(),
            function_runtime=parent,
        )
        async with get_session_factory()() as session:
            try:
                await self.native_request(scope, receive, send, runtime, session)
            finally:
                await runtime.close()

    async def native_request(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
        runtime: InputPurifier,
        session: AsyncSession,
    ) -> None:
        settings = get_settings()
        request = Request(scope)
        method = scope["method"]
        try:
            result: dict[str, Any] = await runtime.request_context(
                method=method,
                uri=str(request.url),
                headers=scope["headers"],
                configuration=native_configuration(session),
                default_permissions=settings.default_permissions,
                api_key_header=settings.api_key_header,
                execute=NativeStatements(session, runtime).execute,
            )
        except GrocyError as error:
            response = await grocy_error_handler(Request(scope), error)
            if method == "HEAD":
                response.body = b""
            await response(scope, receive, send)
            return
        state = scope.setdefault("state", {})
        state["native_runtime"] = runtime
        state["grocy_session"] = session
        state["native_context"] = result.get("context", {})
        if context := result.get("context"):
            session.info["native_user_defaults"] = {
                "stock_due_soon_days": decode_value(context["stock_due_soon_days"])
            }
            base_path = context["base_path"]
            if base_path and scope["path"].startswith(base_path):
                scope["root_path"] = base_path
                scope["grocy_api_path"] = scope["path"][len(base_path) :]
        cors = [
            (name.lower().encode(), ", ".join(values).encode())
            for name, values in result["headers"].items()
            if name.lower().startswith("access-control-")
        ]
        unauthorized = False
        startup = result["startup_output"]
        startup_body = startup["output"]
        if not startup["committed"] and result.get("context"):
            # Grocy clears buffered startup output after successful configuration.
            startup_body = b""

        async def native_send(message: Message) -> None:
            nonlocal unauthorized, startup_body
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
                if startup["output"] and startup["committed"]:
                    # PHP has already sent these headers before Grocy can change them.
                    message = {
                        **message,
                        "status": startup["status"],
                        "headers": [(b"content-type", startup["content_type"].encode())],
                    }
            elif message["type"] == "http.response.body":
                body = b"" if unauthorized else message.get("body", b"")
                message = {**message, "body": b"" if method == "HEAD" else startup_body + body}
                startup_body = b""
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
