"""Relay the pinned PHP controller's status, headers, and response bytes."""

import base64
from typing import Any

from fastapi import Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.generic import NativeStatements
from grocy.compatibility.purifier import InputPurifier
from grocy.core.config import get_settings


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


async def native_action_response(
    request: Request,
    session: AsyncSession,
    route: str,
    object_id: str,
    user_id: int,
    *,
    arguments: dict[str, str] | None = None,
) -> Response:
    runtime: InputPurifier = request.app.state.input_purifier
    result = await runtime.native_action(
        route=route,
        object_id=object_id,
        user_id=user_id,
        method=request.method,
        body=await request.body(),
        content_type=request.headers.get("content-type"),
        query_string=request.scope["query_string"],
        default_permissions=get_settings().default_permissions,
        arguments=arguments,
        execute=NativeStatements(session, runtime).execute,
    )
    return native_response(result)
