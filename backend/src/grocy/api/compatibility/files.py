from fastapi import APIRouter, Request, Response

from grocy.compatibility.files import NativeFiles
from grocy.core.auth import CurrentActor
from grocy.core.config import get_settings
from grocy.core.deps import DbSession

router = APIRouter(tags=["files"])


@router.get("/api/files/{group}/{file_name:path}")
@router.head("/api/files/{group}/{file_name:path}", include_in_schema=False)
@router.put("/api/files/{group}/{file_name:path}")
@router.delete("/api/files/{group}/{file_name:path}")
async def file_request(
    group: str, file_name: str, request: Request, _actor: CurrentActor, session: DbSession
) -> Response:
    # File streams do not need the authentication transaction's SQLite write lock.
    await session.rollback()
    runtime: NativeFiles = request.app.state.native_files
    return await runtime.response(request, get_settings().files_root, group, file_name)
