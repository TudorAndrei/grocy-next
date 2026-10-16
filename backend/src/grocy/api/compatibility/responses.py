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
    settings = get_settings()
    configuration: dict[str, Any] = {
        "GROCY_" + name: value for name, value in settings.feature_flags().items()
    }
    configuration.update(
        GROCY_BASE_URL=str(request.base_url),
        GROCY_DISABLE_URL_REWRITING=False,
        GROCY_DEFAULT_LOCALE="en",
        GROCY_LABEL_PRINTER_WEBHOOK=settings.label_printer_webhook,
        GROCY_LABEL_PRINTER_RUN_SERVER=settings.label_printer_run_server,
        GROCY_LABEL_PRINTER_HOOK_JSON=settings.label_printer_hook_json,
        GROCY_LABEL_PRINTER_PARAMS=settings.label_printer_params,
    )
    result = await runtime.native_action(
        route=route,
        object_id=object_id,
        user_id=user_id,
        method=request.method,
        body=await request.body(),
        content_type=request.headers.get("content-type"),
        query_string=request.scope["query_string"],
        default_permissions=settings.default_permissions,
        configuration=configuration,
        arguments=arguments,
        execute=NativeStatements(session, runtime).execute,
    )
    return native_response(result)
