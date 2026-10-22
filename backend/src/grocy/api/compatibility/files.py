from fastapi import APIRouter, Request, Response

from grocy.core.auth import CurrentActor
from grocy.core.deps import DbSession
from grocy.core.errors import NotFoundError
from grocy.domains.files.service import FilesService

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
    )
