from typing import Annotated

from fastapi import APIRouter, Query, Request, Response

from grocy.core.auth import CurrentActor
from grocy.domains.files.service import FilesService

router = APIRouter(tags=["files"])


@router.get("/files/{group}/{file_name:path}")
async def get_file(
    group: str,
    file_name: str,
    _actor: CurrentActor,
    best_fit_width: Annotated[int | None, Query(gt=0, le=4096)] = None,
    best_fit_height: Annotated[int | None, Query(gt=0, le=4096)] = None,
    force_serve_as: str | None = None,
) -> Response:
    return await FilesService().get(
        group,
        file_name,
        width=best_fit_width,
        height=best_fit_height,
        picture=force_serve_as == "picture",
    )


@router.put("/files/{group}/{file_name:path}", status_code=204)
async def put_file(group: str, file_name: str, request: Request, _actor: CurrentActor) -> Response:
    await FilesService().put(request, group, file_name)
    return Response(status_code=204)


@router.delete("/files/{group}/{file_name:path}", status_code=204)
async def delete_file(group: str, file_name: str, _actor: CurrentActor) -> Response:
    await FilesService().delete(group, file_name)
    return Response(status_code=204)
