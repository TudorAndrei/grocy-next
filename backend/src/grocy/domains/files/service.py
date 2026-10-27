import base64
import binascii
import math
import mimetypes
import os
import re
import tempfile
from collections.abc import AsyncIterator
from contextlib import suppress
from pathlib import Path

from fastapi import Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool

from grocy.compatibility.php import php_error
from grocy.core.config import get_settings
from grocy.core.errors import GrocyError, NotFoundError
from grocy.domains.files.gd import picture_bytes
from grocy.domains.files.mime import content_type

FILE_GROUPS = {"equipmentmanuals", "recipepictures", "productpictures", "userfiles", "userpictures"}
_FILE_NAME = re.compile(r"^[^/?*;:{}\\]+\.[^/?*;:{}\\]+$")
_NUMERIC = re.compile(
    r"[ \t\n\r\v\f]*[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?[ \t\n\r\v\f]*"
)


def _decode(value: str) -> bytes:
    data = re.sub(r"[^A-Za-z0-9+/]", "", value)
    if len(data) % 4 == 1:
        data = data[:-1]
    return base64.b64decode(data + "=" * (-len(data) % 4))


def _stem(name: str) -> tuple[str, str]:
    stem, dot, extension = name.rpartition(".")
    return (stem, extension) if dot else (name, "")


def _dimension(value: str | int | None) -> tuple[str, int] | None:
    if isinstance(value, int):
        return str(value), value
    if value in (None, "", "0") or _NUMERIC.fullmatch(value) is None:
        return None
    number = float(value)
    return value, int(number) if math.isfinite(number) else 0


class FilesService:
    def __init__(self, *, compatibility: bool = False) -> None:
        self.compatibility = compatibility

    def _name(self, file_name: str) -> str:
        if self.compatibility:
            try:
                name = _decode(file_name).decode()
            except UnicodeDecodeError as error:
                raise GrocyError("Invalid filename", code=None) from error
            if _FILE_NAME.match(name) is None:
                raise GrocyError("Invalid filename", code=None)
            return name
        with suppress(binascii.Error, UnicodeDecodeError, ValueError):
            return base64.b64decode(file_name + "=" * (-len(file_name) % 4), validate=True).decode()
        return file_name

    def _path(self, group: str, file_name: str) -> tuple[Path, str]:
        groups = FILE_GROUPS if self.compatibility else FILE_GROUPS | {"equipment", "nutrition"}
        if group not in groups:
            raise GrocyError("Invalid file group", code=None)
        name = self._name(file_name)
        code = None if self.compatibility else "invalid_path"
        if name in {"", ".", ".."} or any(
            character in name for character in ("/", "\\", "\x00", "\r", "\n")
        ):
            raise GrocyError("Invalid filename", code=code)
        root = get_settings().files_root.resolve()
        path = (root / group / name).resolve()
        if not path.is_relative_to(root):
            raise GrocyError("Invalid file path", code=code)
        return path, name

    async def get(
        self,
        group: str,
        file_name: str,
        *,
        width: str | int | None = None,
        height: str | int | None = None,
        picture: bool = False,
        head: bool = False,
    ) -> Response:
        try:
            path, name = self._path(group, file_name)
            if not path.is_file():
                raise NotFoundError("File not found")
            media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            if picture:
                path, media_type = await run_in_threadpool(
                    self._picture, path, _dimension(height), _dimension(width), self.compatibility
                )
            if self.compatibility:
                mime = await run_in_threadpool(content_type, path)

                async def chunks() -> AsyncIterator[bytes]:
                    if head:
                        return
                    with path.open("rb") as stream:
                        while chunk := await run_in_threadpool(stream.read, 1048576):
                            yield chunk

                response = StreamingResponse(
                    chunks(),
                    headers={"Content-Type": mime, "Cache-Control": "max-age=2592000"},
                )
                response.raw_headers.append(
                    (b"content-disposition", f'inline; filename="{name}"'.encode())
                )
                return response
            return FileResponse(
                path,
                filename=name,
                media_type=media_type,
                content_disposition_type="inline",
                headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "max-age=2592000"},
            )
        except GrocyError as error:
            if self.compatibility:
                if error.status_code >= 500:
                    raise
                raise php_error(error.message, status_code=404) from error
            raise

    @staticmethod
    def _picture(
        path: Path,
        height: tuple[str, int] | None,
        width: tuple[str, int] | None,
        compatibility: bool = False,
    ) -> tuple[Path, str]:
        from PIL import Image, UnidentifiedImageError

        stem, extension = _stem(path.name)
        cached = path.with_name(
            f"{stem}__downscaledto{height[0] if height else 'auto'}"
            f"x{width[0] if width else 'auto'}.{extension}"
        )
        try:
            if not cached.is_file():
                if compatibility and (
                    (height is not None and width is None)
                    or any(value is not None and value[1] <= 0 for value in (width, height))
                ):
                    raise php_error(
                        "imagecreatetruecolor(): Argument #1 ($width) must be greater than 0"
                    )
                if any(value is not None and not 0 < value[1] <= 4096 for value in (width, height)):
                    raise GrocyError("Invalid image dimensions")
                with Image.open(path) as picture:
                    if picture.width * picture.height > 25_000_000:
                        raise GrocyError("Image exceeds the pixel limit", status_code=413)
                    image_format = picture.format or "PNG"
                    rendered = (
                        picture_bytes(
                            path,
                            image_format,
                            picture.getexif().get(274, 1),
                            width[0] if width else None,
                            height[0] if height else None,
                        )
                        if compatibility
                        else None
                    )
                    picture.thumbnail(
                        (
                            width[1] if width else picture.width,
                            height[1] if height else picture.height,
                        )
                    )
                    descriptor, temporary = tempfile.mkstemp(dir=path.parent)
                    try:
                        with os.fdopen(descriptor, "wb") as stream:
                            if rendered is None:
                                picture.save(stream, image_format)
                            else:
                                stream.write(rendered)
                        os.replace(temporary, cached)
                    finally:
                        Path(temporary).unlink(missing_ok=True)
            with Image.open(cached) as picture:
                media_type = Image.MIME.get(picture.format or "", "application/octet-stream")
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
            message = "Unsupported file type" if compatibility else "File is not a valid image"
            raise GrocyError(message, code=None) from error
        return cached, media_type

    async def put(self, request: Request, group: str, file_name: str) -> None:
        path, name = self._path(group, file_name)
        if path.exists():
            raise GrocyError(f"Error while creating file {name}", code=None)
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(dir=path.parent)
        size = 0
        pending = bytearray()
        try:
            with os.fdopen(descriptor, "wb") as stream:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > get_settings().max_upload_bytes:
                        raise GrocyError("File exceeds the upload limit", status_code=413)
                    if not self.compatibility:
                        await run_in_threadpool(stream.write, chunk)
                        continue
                    pending.extend(chunk)
                    while len(pending) >= 1048576:
                        await run_in_threadpool(stream.write, pending[:1048576])
                        del pending[:1048576]
                if self.compatibility and pending and pending != b"0":
                    await run_in_threadpool(stream.write, pending)
            try:
                await run_in_threadpool(os.link, temporary, path)
            except FileExistsError as error:
                raise GrocyError(f"Error while creating file {name}", code=None) from error
        finally:
            Path(temporary).unlink(missing_ok=True)

    async def delete(self, group: str, file_name: str) -> None:
        path, _ = self._path(group, file_name)
        await run_in_threadpool(self._remove, path)

    @staticmethod
    def _remove(path: Path) -> None:
        from PIL import Image, UnidentifiedImageError

        if not path.is_file():
            return
        try:
            with Image.open(path):
                image = True
        except Image.DecompressionBombError:
            image = True
        except (UnidentifiedImageError, OSError):
            image = False
        if image:
            prefix = _stem(path.name)[0] + "__downscaledto"
            for entry in path.parent.iterdir():
                if entry.name.startswith(prefix) and entry.is_file():
                    entry.unlink(missing_ok=True)
        path.unlink(missing_ok=True)
