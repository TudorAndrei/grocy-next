from typing import Any

from fastapi import Request
from sqlalchemy.exc import DBAPIError

from grocy.compatibility.php import request_body
from grocy.core.errors import GrocyError


async def json_body(request: Request) -> dict[str, Any]:
    body = await request_body(request)
    if body is None:
        raise GrocyError(
            "Request body could not be parsed "
            "(probably invalid JSON format or missing/wrong Content-Type header)",
            code=None,
        )
    return {str(key): value for key, value in body.items()}


def database_error(error: DBAPIError, *, status_code: int = 400) -> GrocyError:
    number = getattr(error.orig, "sqlite_errorcode", 1) & 255
    state = "23000]: Integrity constraint violation" if number == 19 else "HY000]: General error"
    return GrocyError(
        f"SQLSTATE[{state}: {number} {error.orig}", status_code=status_code, code=None
    )
