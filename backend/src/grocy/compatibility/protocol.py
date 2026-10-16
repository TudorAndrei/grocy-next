"""Relay compatibility requests through PHP's HTTP request context."""

from fastapi import Request
from starlette.types import ASGIApp, Receive, Scope, Send

from grocy.api.compatibility.responses import native_configuration, native_response, native_uri
from grocy.compatibility.generic import NativeStatements
from grocy.compatibility.http_request import NativeHttpRuntime, NativeHttpTerminal
from grocy.compatibility.values import decode_value
from grocy.core.auth import authenticate_request
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
            or "/api/" not in path
            or path.startswith("/api/v2/")
            or path in {"/api/v2", "/api/health"}
        ):
            await self.app(scope, receive, send)
            return
        runtime: NativeHttpRuntime = scope["app"].state.native_http.request(scope, receive, send)
        request = Request(scope, receive)
        settings = get_settings()
        async with get_session_factory()() as session:
            statements = NativeStatements(session, runtime)
            try:
                result = await runtime.request_context(
                    method=scope["method"],
                    uri=native_uri(request),
                    headers=scope["headers"],
                    configuration=native_configuration(session),
                    default_permissions=settings.default_permissions,
                    api_key_header=settings.api_key_header,
                    execute=statements.execute,
                )
                if result.get("terminal"):
                    await runtime.finish()
                    return
                state = scope.setdefault("state", {})
                context = result["context"]
                state.update(native_runtime=runtime, grocy_session=session, native_context=context)
                session.info["native_user_defaults"] = {
                    "stock_due_soon_days": decode_value(context["stock_due_soon_days"])
                }
                if context["base_path"] and path.startswith(context["base_path"]):
                    scope["grocy_api_path"] = path[len(context["base_path"]) :]
                if not result["matched"]:
                    response = native_response(result)
                    await runtime.emit(
                        response.status_code, response.raw_headers, bytes(response.body)
                    )
                else:
                    try:
                        actor = await authenticate_request(
                            request, session, request.headers.get("GROCY-API-KEY")
                        )
                    except GrocyError as error:
                        response = await grocy_error_handler(request, error)
                        headers = (
                            [
                                (name, value)
                                for name, value in response.raw_headers
                                if name not in {b"content-length", b"content-type"}
                            ]
                            if response.status_code == 401
                            else response.raw_headers
                        )
                        headers.extend(
                            (name.lower().encode(), ", ".join(values).encode())
                            for name, values in result["headers"].items()
                            if name.lower().startswith("access-control-")
                        )
                        status = response.status_code
                        body = bytes(response.body)
                        if status == 401:
                            body = b""
                            if not context["is_api_route"]:
                                status = 302
                                headers.append((b"location", context["login_url"].encode()))
                        await runtime.emit(status, headers, body)
                    else:
                        await runtime.native_action(
                            route="http_dispatch",
                            object_id="",
                            user_id=actor.user_id,
                            method=scope["method"],
                            body=b"",
                            content_type=request.headers.get("content-type"),
                            query_string=scope["query_string"],
                            uri=native_uri(request),
                            headers=scope["headers"],
                            default_permissions=settings.default_permissions,
                            datapath=settings.datapath.resolve(),
                            configuration=native_configuration(session),
                            execute=statements.execute,
                        )
                await runtime.finish()
            except NativeHttpTerminal:
                await runtime.finish()
            except GrocyError as error:
                if runtime.sent:
                    raise
                response = await grocy_error_handler(request, error)
                await response(scope, receive, send)
            finally:
                await runtime.close()
