"""Legacy recipe image downloads, generated without PHP."""

from datetime import UTC, datetime
from email.utils import format_datetime

from fastapi import APIRouter, Depends, Request, Response
from starlette.concurrency import run_in_threadpool

from grocy.compatibility.lessql import query_parameters
from grocy.compatibility.php import php_error, truthy
from grocy.core.auth import AuthenticatedActor
from grocy.core.config import get_settings
from grocy.domains.codes.image import grocycode_png

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


@router.api_route(
    "/recipe/{recipe_id}/grocycode",
    methods=["GET", "HEAD"],
    dependencies=[Depends(_legacy_page)],
    include_in_schema=False,
)
async def recipe_code(recipe_id: str, request: Request, _actor: AuthenticatedActor) -> Response:
    return await code_response(request, f"grcy:r:{recipe_id}")
