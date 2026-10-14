from fastapi import Request
from fastapi.responses import JSONResponse


class GrocyError(Exception):
    def __init__(self, message: str, *, status_code: int = 400, code: str = "error") -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


class NotFoundError(GrocyError):
    def __init__(self, message: str = "Not found") -> None:
        super().__init__(message, status_code=404, code="not_found")


class UnauthorizedError(GrocyError):
    def __init__(self, message: str = "Unauthorized") -> None:
        super().__init__(message, status_code=401, code="unauthorized")


class ConflictError(GrocyError):
    def __init__(self, message: str = "Conflict") -> None:
        super().__init__(message, status_code=409, code="conflict")


async def grocy_error_handler(_request: Request, exc: GrocyError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error_message": exc.message, "error_code": exc.code},
    )
