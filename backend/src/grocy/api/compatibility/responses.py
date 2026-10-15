"""Relay the pinned PHP controller's status, headers, and response bytes."""

import base64
from typing import Any

from fastapi import Response


def native_response(result: dict[str, Any]) -> Response:
    return Response(
        content=base64.b64decode(result["response"]),
        status_code=result["status"],
        headers={name: ", ".join(values) for name, values in result["headers"].items()},
    )
