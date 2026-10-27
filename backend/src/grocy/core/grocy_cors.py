from starlette.types import ASGIApp, Message, Receive, Scope, Send

_GROCY_CORS = (
    (b"access-control-allow-origin", b"*"),
    (b"access-control-allow-headers", b"*"),
    (b"access-control-allow-methods", b"GET, POST, PUT, DELETE, OPTIONS"),
    (b"cache-control", b"no-store"),
)


class GrocyCorsHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith("/api"):
            await self.app(scope, receive, send)
            return

        async def send_with_cors(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                if not scope["path"].startswith("/api/v2/") and scope["path"] != "/api/health":
                    headers = [
                        (name, value)
                        for name, value in headers
                        if not name.lower().startswith(b"access-control-")
                    ]
                present = {name.lower() for name, _ in headers}
                for name, value in _GROCY_CORS:
                    if name not in present:
                        headers.append((name, value))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_cors)
