"""Legacy code image downloads, generated without PHP."""

from datetime import UTC, datetime
from email.utils import format_datetime

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from grocy.compatibility.lessql import query_parameters
from grocy.compatibility.php import php_error, php_string, truthy
from grocy.core.auth import AuthenticatedActor
from grocy.core.config import get_settings
from grocy.core.deps import DbSession
from grocy.domains.codes.image import grocycode_png
from grocy.domains.codes.paper import stock_entry_label
from grocy.domains.printing import stock_entry
from grocy.domains.system.service import SystemService

router = APIRouter(tags=["codes"])


async def code_response(request: Request, code: str) -> Response:
    parameters = query_parameters(request.scope["query_string"])
    try:
        data = await run_in_threadpool(
            grocycode_png, code, get_settings().grocycode_type, parameters.get("size")
        )
    except ValueError as error:
        raise php_error("Division by zero") from error
    download = truthy(parameters.get("download", False))
    headers = {
        "Cache-Control": "no-cache",
        "Last-Modified": format_datetime(datetime.now(UTC), usegmt=True),
    }
    if download:
        headers["Content-Disposition"] = "attachment; filename=Grocycode.png"
    return Response(
        data, headers=headers, media_type="application/octet-stream" if download else "image/png"
    )


async def _legacy_page(request: Request) -> None:
    request.scope["grocy_legacy_base_path"] = True


async def stock_entry_code(session: AsyncSession, entry_id: str) -> str:
    entry = await stock_entry(session, entry_id) or {}
    # The GUI reference reads empty properties when the entry does not exist.
    return f"grcy:p:{php_string(entry.get('product_id'))}:{php_string(entry.get('stock_id'))}"


async def paper_response(
    request: Request, session: AsyncSession, entry_id: str, user_id: int
) -> HTMLResponse:
    locale = await SystemService(session).locale(
        user_id, request.headers.get("accept-language", "")
    )
    base_url = str(request.base_url).rstrip("/")
    return HTMLResponse(await stock_entry_label(session, entry_id, locale, base_url))


@router.api_route(
    "/recipe/{recipe_id}/grocycode",
    methods=["GET", "HEAD"],
    dependencies=[Depends(_legacy_page)],
    include_in_schema=False,
)
async def recipe_code(recipe_id: str, request: Request, _actor: AuthenticatedActor) -> Response:
    return await code_response(request, f"grcy:r:{recipe_id}")


@router.api_route(
    "/product/{product_id}/grocycode",
    methods=["GET", "HEAD"],
    dependencies=[Depends(_legacy_page)],
    include_in_schema=False,
)
async def product_code(product_id: str, request: Request, _actor: AuthenticatedActor) -> Response:
    return await code_response(request, f"grcy:p:{product_id}")


@router.api_route(
    "/chore/{chore_id}/grocycode",
    methods=["GET", "HEAD"],
    dependencies=[Depends(_legacy_page)],
    include_in_schema=False,
)
async def chore_code(chore_id: str, request: Request, _actor: AuthenticatedActor) -> Response:
    return await code_response(request, f"grcy:c:{chore_id}")


@router.api_route(
    "/battery/{battery_id}/grocycode",
    methods=["GET", "HEAD"],
    dependencies=[Depends(_legacy_page)],
    include_in_schema=False,
)
async def battery_code(battery_id: str, request: Request, _actor: AuthenticatedActor) -> Response:
    return await code_response(request, f"grcy:b:{battery_id}")


@router.api_route(
    "/stockentry/{entry_id}/grocycode",
    methods=["GET", "HEAD"],
    dependencies=[Depends(_legacy_page)],
    include_in_schema=False,
)
async def entry_code(
    entry_id: str, request: Request, _actor: AuthenticatedActor, session: DbSession
) -> Response:
    return await code_response(request, await stock_entry_code(session, entry_id))


@router.api_route(
    "/stockentry/{entry_id}/label",
    methods=["GET", "HEAD"],
    dependencies=[Depends(_legacy_page)],
    include_in_schema=False,
)
async def entry_paper_label(
    entry_id: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> HTMLResponse:
    return await paper_response(request, session, entry_id, actor.user_id)
