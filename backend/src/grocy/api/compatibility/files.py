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
    service = FilesService(compatibility=True)
    if request.method == "PUT":
        await service.put(request, group, file_name)
        return Response(status_code=204)
    if request.method == "DELETE":
        await service.delete(group, file_name)
        return Response(status_code=204)
    dimensions = []
    for name in ("best_fit_width", "best_fit_height"):
        value = request.query_params.get(name)
        try:
            dimensions.append(int(value) if value else None)
        except ValueError as error:
            raise NotFoundError("Invalid image dimensions", code=None) from error
    return await service.get(
        group,
        file_name,
        width=dimensions[0],
        height=dimensions[1],
        picture=request.query_params.get("force_serve_as") == "picture",
    )
