from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from grocy.core.config import get_settings

_GROCY_CORS = (
    (b"access-control-allow-origin", b"*"),
    (b"access-control-allow-headers", b"*"),
    (b"access-control-allow-methods", b"GET, POST, PUT, DELETE, OPTIONS"),
)


class GrocyCorsHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        prefix = get_settings().base_path.rstrip("/")
        if prefix and path.startswith(prefix + "/"):
            path = path[len(prefix) :]
        api = path.startswith("/api")
        named_file = path.startswith("/files/")
        if scope["type"] != "http" or not (api or named_file):
            await self.app(scope, receive, send)
            return

        async def send_with_cors(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                if not path.startswith("/api/v2/") and path != "/api/health":
                    headers = [
                        (name, value)
                        for name, value in headers
                        if not name.lower().startswith(b"access-control-")
                    ]
                present = {name.lower() for name, _ in headers}
                defaults = _GROCY_CORS
                if path.startswith("/api/v2/") or path == "/api/health":
                    defaults += ((b"cache-control", b"no-store"),)
                for name, value in defaults:
                    if name not in present:
                        headers.append((name, value))
                message = {**message, "headers": headers}
            await send(message)

        if named_file and scope["method"] == "OPTIONS":
            response = Response(headers={"Content-Type": "text/html; charset=UTF-8"})
            await response(scope, receive, send_with_cors)
            return
        await self.app(scope, receive, send_with_cors)
