from html import escape
from typing import Any

from fastapi import Request, Response
from fastapi.responses import HTMLResponse, JSONResponse


class GrocyError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status_code: int = 400,
        code: str | None = "error",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.details = details


class NotFoundError(GrocyError):
    def __init__(self, message: str = "Not found", *, code: str | None = "not_found") -> None:
        super().__init__(message, status_code=404, code=code)


class UnauthorizedError(GrocyError):
    def __init__(self, message: str = "Unauthorized") -> None:
        super().__init__(message, status_code=401, code="unauthorized")


class ConflictError(GrocyError):
    def __init__(self, message: str = "Conflict") -> None:
        super().__init__(message, status_code=409, code="conflict")


async def grocy_error_handler(_request: Request, exc: Exception) -> Response:
    assert isinstance(exc, GrocyError)
    if _request.scope.get("grocy_legacy_base_path"):
        if isinstance(exc, UnauthorizedError):
            from grocy.core.urls import construct_url, request_base

            return Response(
                status_code=302,
                headers={
                    "Location": construct_url(request_base(_request), "/login"),
                    "Content-Type": "text/html; charset=UTF-8",
                },
            )
        if exc.details is not None:
            return HTMLResponse(
                '<!DOCTYPE html><html lang="en"><head><title>Request failed</title></head>'
                "<body><h1>Request failed</h1><p>" + escape(exc.message) + "</p></body></html>",
                status_code=exc.status_code if exc.status_code in {403, 404} else 500,
            )
    if (
        isinstance(exc, UnauthorizedError)
        and _request.url.path.startswith("/api/")
        and not _request.url.path.startswith("/api/v2/")
        and _request.url.path != "/api/health"
    ):
        return Response(status_code=401, headers={"Content-Type": "text/html; charset=UTF-8"})
    content: dict[str, Any] = {"error_message": exc.message}
    if exc.code is not None:
        content["error_code"] = exc.code
    if exc.details is not None:
        content["error_details"] = exc.details
    return JSONResponse(status_code=exc.status_code, content=content)
