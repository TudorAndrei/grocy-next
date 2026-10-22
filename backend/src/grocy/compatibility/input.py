import json
from typing import Any

from fastapi import Request
from sqlalchemy.exc import DBAPIError

from grocy.core.errors import GrocyError


async def json_body(request: Request) -> dict[str, Any]:
    if request.headers.get("content-type", "").split(";", 1)[0].strip() != "application/json":
        raise GrocyError("Bad Content-Type", code=None)
    try:
        body = json.loads(await request.body())
    except (ValueError, UnicodeDecodeError) as error:
        raise GrocyError("Request body could not be parsed", code=None) from error
    if not isinstance(body, dict):
        raise GrocyError("Request body must be a JSON object", code=None)
    return body


def database_error(error: DBAPIError, *, status_code: int = 400) -> GrocyError:
    number = getattr(error.orig, "sqlite_errorcode", 1) & 255
    state = "23000]: Integrity constraint violation" if number == 19 else "HY000]: General error"
    return GrocyError(
        f"SQLSTATE[{state}: {number} {error.orig}", status_code=status_code, code=None
    )
