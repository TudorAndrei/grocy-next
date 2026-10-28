from html import escape

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import HTMLResponse

from grocy.core.auth import AuthenticatedActor, CurrentActor
from grocy.core.config import get_settings
from grocy.core.deps import DbSession
from grocy.core.errors import GrocyError, NotFoundError
from grocy.core.urls import construct_url, request_base
from grocy.domains.files.service import FilesService
from grocy.domains.system.service import SystemService, localization

router = APIRouter(tags=["files"])


@router.get("/api/files/{group}/{file_name:path}")
@router.head("/api/files/{group}/{file_name:path}", include_in_schema=False)
@router.put("/api/files/{group}/{file_name:path}")
@router.delete("/api/files/{group}/{file_name:path}")
async def file_request(
    group: str, file_name: str, request: Request, _actor: CurrentActor, session: DbSession
) -> Response:
    await session.rollback()
    raw_path = request.scope.get("raw_path") or request.url.path.encode()
    raw_group, _, raw_name = raw_path.partition(b"/api/files/")[2].partition(b"/")
    if not raw_group or not raw_name or b"/" in raw_name:
        raise NotFoundError("Not found.", code=None)
    service = FilesService(compatibility=True)
    if request.method == "PUT":
        await service.put(request, group, file_name)
        return Response(status_code=204)
    if request.method == "DELETE":
        await service.delete(group, file_name)
        return Response(status_code=204)
    query = request.query_params
    return await service.get(
        group,
        file_name,
        width=query.get("best_fit_width"),
        height=query.get("best_fit_height"),
        picture=query.get("force_serve_as") == "picture",
        head=request.method == "HEAD",
    )


async def _legacy_page(request: Request) -> None:
    request.scope["grocy_legacy_base_path"] = True


@router.api_route(
    "/files/{group}/{file_name}",
    methods=["GET", "HEAD"],
    dependencies=[Depends(_legacy_page)],
    include_in_schema=False,
)
async def show_file(
    group: str, file_name: str, request: Request, actor: AuthenticatedActor, session: DbSession
) -> Response:
    await session.rollback()
    query = request.query_params
    try:
        return await FilesService(compatibility=True).get(
            group,
            file_name,
            named=True,
            width=query.get("best_fit_width"),
            height=query.get("best_fit_height"),
            picture=query.get("force_serve_as") == "picture",
            head=request.method == "HEAD",
        )
    except GrocyError as error:
        if error.status_code != 404:
            raise
        locale = await SystemService(session).locale(
            actor.user_id, request.headers.get("accept-language", "")
        )
        messages = localization(locale, get_settings().mode)["messages"][""]

        def translate(value: str) -> str:
            found = messages.get(value)
            return found[0] if found and found[0] else value

        title = escape(translate("Page not found"))
        message = escape(translate("This page does not exist"))
        redirect = escape(
            translate("You will be redirected to the default page in %s seconds") % "5"
        )
        home = escape(construct_url(request_base(request), "/"), quote=True)
        return HTMLResponse(
            f'<!DOCTYPE html><html lang="{escape(locale, quote=True)}"><head>'
            f'<title>{title}</title><meta http-equiv="refresh" content="5;url={home}">'
            f"</head><body><h1>{message}</h1><p>{redirect}</p></body></html>",
            status_code=404,
        )
