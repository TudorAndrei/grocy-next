"""Relay the pinned PHP controller's status, headers, and response bytes."""

import base64
from pathlib import Path
from typing import Any
from urllib.parse import quote_from_bytes

from fastapi import Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from grocy.compatibility.generic import NativeStatements
from grocy.compatibility.purifier import InputPurifier
from grocy.core.config import get_settings


def native_response(result: dict[str, Any]) -> Response:
    response = Response(
        content=base64.b64decode(result["response"]),
        status_code=result["status"],
    )
    headers = {
        name.lower().encode(): ", ".join(values).encode()
        for name, values in result["headers"].items()
    }
    response.raw_headers = [
        *((name, value) for name, value in response.raw_headers if name not in headers),
        *headers.items(),
    ]
    return response


def native_uri(request: Request) -> str:
    raw = request.scope.get("raw_path")
    if raw is None:
        return str(request.url)
    path = quote_from_bytes(raw, safe="/%:@!$&'()*+,;=-._~")
    return str(request.url.replace(path=path))


async def native_list_response(
    request: Request, session: AsyncSession, route: str, object_id: str | None = None
) -> Response:
    runtime: InputPurifier = getattr(
        request.state, "native_runtime", request.app.state.input_purifier
    )
    result = await runtime.native_list(
        route=route,
        object_id=object_id,
        query_string=request.scope["query_string"],
        execute=NativeStatements(session).execute,
    )
    return native_response(result)


def native_configuration(session: AsyncSession) -> dict[str, Any]:
    settings = get_settings()
    configuration: dict[str, Any] = {
        "GROCY_" + name: value for name, value in settings.feature_flags().items()
    }
    configuration.update(
        GROCY_BASE_URL=settings.base_url,
        GROCY_DISABLE_URL_REWRITING=settings.disable_url_rewriting,
        GROCY_DEFAULT_LOCALE=settings.default_locale,
        GROCY_DISABLE_AUTH=False,
        GROCY_MODE=settings.mode,
        GROCY_CURRENCY=settings.currency,
        GROCY_STOCK_BARCODE_LOOKUP_PLUGIN=settings.stock_barcode_lookup_plugin,
        NATIVE_FILES_ROOT=str(settings.files_root.resolve()),
        GROCY_LABEL_PRINTER_WEBHOOK=settings.label_printer_webhook,
        GROCY_LABEL_PRINTER_RUN_SERVER=settings.label_printer_run_server,
        GROCY_LABEL_PRINTER_HOOK_JSON=settings.label_printer_hook_json,
        GROCY_LABEL_PRINTER_PARAMS=settings.label_printer_params,
    )
    configuration.update(
        {"GROCY_" + name: value for name, value in settings.thermal_printer_configuration().items()}
    )
    filename = session.get_bind().engine.url.database
    configuration["NATIVE_DATABASE_FILE"] = (
        str(Path(filename).resolve()) if filename and filename != ":memory:" else None
    )
    return configuration


async def native_action_response(
    request: Request,
    session: AsyncSession,
    route: str,
    object_id: str,
    user_id: int,
    *,
    arguments: dict[str, str] | None = None,
    body: bytes | None = None,
) -> Response:
    runtime: InputPurifier = getattr(
        request.state, "native_runtime", request.app.state.input_purifier
    )
    settings = get_settings()
    configuration = native_configuration(session)
    result = await runtime.native_action(
        route=route,
        object_id=object_id,
        user_id=user_id,
        method=request.scope.get("grocy_original_method", request.method),
        body=await request.body() if body is None else body,
        content_type=request.headers.get("content-type"),
        query_string=request.scope["query_string"],
        uri=native_uri(request),
        headers=request.scope["headers"],
        default_permissions=settings.default_permissions,
        datapath=settings.datapath.resolve(),
        configuration=configuration,
        arguments=arguments,
        execute=NativeStatements(session).execute,
    )
    return native_response(result)
