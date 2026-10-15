"""Relay the pinned PHP controller's status, headers, and response bytes."""

import base64
from typing import Any

from fastapi import Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.generic import NativeStatements
from grocy.compatibility.purifier import InputPurifier


def native_response(result: dict[str, Any]) -> Response:
    return Response(
        content=base64.b64decode(result["response"]),
        status_code=result["status"],
        headers={name: ", ".join(values) for name, values in result["headers"].items()},
    )


async def native_list_response(
    request: Request, session: AsyncSession, route: str, object_id: str | None = None
) -> Response:
    runtime: InputPurifier = request.app.state.input_purifier
    result = await runtime.native_list(
        route=route,
        object_id=object_id,
        query_string=request.scope["query_string"],
        execute=NativeStatements(session, runtime).execute,
    )
    return native_response(result)
