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
    if force_serve_as not in {
        None,
        "picture",
        "image",
        "image/png",
        "image/jpeg",
        "application/octet-stream",
        "text/plain",
    }:
        raise GrocyError("Unsupported file media type")
    if (
        best_fit_width
        or best_fit_height
        or force_serve_as in {"picture", "image", "image/png", "image/jpeg"}
    ):

        def render() -> bytes:
            from PIL import Image, UnidentifiedImageError

            try:
                with Image.open(path) as picture:
                    if picture.width * picture.height > 25_000_000:
                        raise GrocyError("Image exceeds the pixel limit", status_code=413)
                    picture.thumbnail(
                        (best_fit_width or picture.width, best_fit_height or picture.height)
                    )
                    output = io.BytesIO()
                    if force_serve_as == "image/jpeg":
                        picture.convert("RGB").save(output, "JPEG")
                    else:
                        picture.save(output, "PNG")
                    return output.getvalue()
            except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
                raise GrocyError("File is not a valid image") from exc

        body = await run_in_threadpool(render)
        return Response(
            body,
            media_type="image/jpeg" if force_serve_as == "image/jpeg" else "image/png",
            headers={"X-Content-Type-Options": "nosniff"},
        )
    return FileResponse(
        path,
        filename=path.name,
        media_type=force_serve_as or media_type,
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.put("/api/files/{group}/{file_name:path}", status_code=204)
async def put_file(group: str, file_name: str, request: Request, _actor: CurrentActor) -> Response:
    path = _file_path(group, file_name)
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
        await run_in_threadpool(os.replace, temporary, path)
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
