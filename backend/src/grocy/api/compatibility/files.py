from pathlib import Path

from fastapi import APIRouter, Request, Response

from grocy.core.auth import CurrentActor
from grocy.core.errors import NotFoundError

router = APIRouter(tags=["files"])

FILES_ROOT = Path("data/files")


def _file_path(group: str, file_name: str) -> Path:
    return FILES_ROOT / group / file_name


@router.get("/api/files/{group}/{file_name}")
async def get_file(
    group: str,
    file_name: str,
    _actor: CurrentActor,
) -> Response:
    path = _file_path(group, file_name)
    if not path.is_file():
        raise NotFoundError("File not found")
    return Response(content=path.read_bytes(), media_type="application/octet-stream")


@router.put("/api/files/{group}/{file_name}")
async def put_file(
    group: str,
    file_name: str,
    request: Request,
    _actor: CurrentActor,
) -> dict[str, bool]:
    path = _file_path(group, file_name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(await request.body())
    return {"success": True}


@router.delete("/api/files/{group}/{file_name}")
async def delete_file(
    group: str,
    file_name: str,
    _actor: CurrentActor,
) -> dict[str, bool]:
    path = _file_path(group, file_name)
    if not path.is_file():
        raise NotFoundError("File not found")
    path.unlink()
    return {"success": True}
