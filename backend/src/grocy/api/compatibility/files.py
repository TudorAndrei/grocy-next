import base64
import binascii
import io
import mimetypes
import os
import tempfile
from contextlib import suppress
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from grocy.core.auth import CurrentActor
from grocy.core.config import get_settings
from grocy.core.errors import GrocyError, NotFoundError

router = APIRouter(tags=["files"])


def _file_path(group: str, file_name: str) -> Path:
    if group not in {
        "equipmentmanuals",
        "recipepictures",
        "productpictures",
        "userfiles",
        "userpictures",
        "equipment",
        "nutrition",
    }:
        raise GrocyError("Invalid file group")
    # Plain names support existing Grocy Next clients.
    with suppress(binascii.Error, UnicodeDecodeError, ValueError):
        file_name = base64.b64decode(file_name + "=" * (-len(file_name) % 4), validate=True).decode(
            "utf-8"
        )
    root = get_settings().files_root.resolve()
    for part in (group, file_name):
        if part in {"", ".", ".."} or any(c in part for c in ("/", "\\", "\x00")):
            raise GrocyError("Invalid file path", code="invalid_path")
    path = (root / group / file_name).resolve()
    if not path.is_relative_to(root):
        raise GrocyError("Invalid file path", code="invalid_path")
    return path


@router.get("/api/files/{group}/{file_name:path}")
async def get_file(
    group: str,
    file_name: str,
    _actor: CurrentActor,
    best_fit_width: Annotated[int | None, Query(gt=0, le=4096)] = None,
    best_fit_height: Annotated[int | None, Query(gt=0, le=4096)] = None,
    force_serve_as: str | None = None,
) -> Response:
    path = _file_path(group, file_name)
    if not path.is_file():
        raise NotFoundError("File not found")
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    headers = {
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "max-age=2592000",
    }
    if force_serve_as == "picture":

        def render() -> tuple[bytes, str]:
            from PIL import Image, UnidentifiedImageError

            try:
                with Image.open(path) as picture:
                    image_format = picture.format or "PNG"
                    if picture.width * picture.height > 25_000_000:
                        raise GrocyError("Image exceeds the pixel limit", status_code=413)
                    picture.thumbnail(
                        (best_fit_width or picture.width, best_fit_height or picture.height)
                    )
                    output = io.BytesIO()
                    picture.save(output, image_format)
                    return output.getvalue(), Image.MIME.get(image_format, media_type)
            except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
                raise GrocyError("File is not a valid image") from exc

        body, image_type = await run_in_threadpool(render)
        headers["Content-Disposition"] = f'inline; filename="{path.name}"'
        return Response(
            body,
            media_type=image_type,
            headers=headers,
        )
    return FileResponse(
        path,
        filename=path.name,
        media_type=media_type,
        content_disposition_type="inline",
        headers=headers,
    )


@router.put("/api/files/{group}/{file_name:path}", status_code=204)
async def put_file(group: str, file_name: str, request: Request, _actor: CurrentActor) -> Response:
    path = _file_path(group, file_name)
    if path.exists():
        raise GrocyError(f"Error while creating file {path.name}")
    limit = get_settings().max_upload_bytes
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    size = 0
    try:
        with os.fdopen(fd, "wb") as stream:
            async for chunk in request.stream():
                size += len(chunk)
                if size > limit:
                    raise GrocyError("File exceeds the upload limit", status_code=413)
                await run_in_threadpool(stream.write, chunk)
        try:
            await run_in_threadpool(os.link, temporary, path)
        except FileExistsError as exc:
            raise GrocyError(f"Error while creating file {path.name}") from exc
    finally:
        Path(temporary).unlink(missing_ok=True)
    return Response(status_code=204)


@router.delete("/api/files/{group}/{file_name:path}", status_code=204)
async def delete_file(group: str, file_name: str, _actor: CurrentActor) -> Response:
    path = _file_path(group, file_name)
    if not path.is_file():
        return Response(status_code=204)
    await run_in_threadpool(path.unlink)
    return Response(status_code=204)
