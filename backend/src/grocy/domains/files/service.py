import base64
import binascii
import io
import mimetypes
import os
import tempfile
from contextlib import suppress
from pathlib import Path

from fastapi import Request, Response
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from grocy.core.config import get_settings
from grocy.core.errors import GrocyError, NotFoundError

FILE_GROUPS = {"equipmentmanuals", "recipepictures", "productpictures", "userfiles", "userpictures"}


class FilesService:
    def __init__(self, *, compatibility: bool = False) -> None:
        self.compatibility = compatibility

    def _name(self, file_name: str) -> str:
        if self.compatibility:
            try:
                return base64.b64decode(
                    file_name + "=" * (-len(file_name) % 4), validate=True
                ).decode()
            except (binascii.Error, UnicodeDecodeError, ValueError) as error:
                raise GrocyError("Invalid filename", code=None) from error
        with suppress(binascii.Error, UnicodeDecodeError, ValueError):
            return base64.b64decode(file_name + "=" * (-len(file_name) % 4), validate=True).decode()
        return file_name

    def _path(self, group: str, file_name: str) -> Path:
        groups = FILE_GROUPS if self.compatibility else FILE_GROUPS | {"equipment", "nutrition"}
        if group not in groups:
            raise GrocyError("Invalid file group", code=None)
        if file_name in {"", ".", ".."} or any(
            character in file_name for character in ("/", "\\", "\x00", "\r", "\n")
        ):
            raise GrocyError("Invalid filename", code="invalid_path")
        root = get_settings().files_root.resolve()
        path = (root / group / file_name).resolve()
        if not path.is_relative_to(root):
            raise GrocyError("Invalid file path", code="invalid_path")
        return path

    async def get(
        self,
        group: str,
        file_name: str,
        *,
        width: int | None = None,
        height: int | None = None,
        picture: bool = False,
    ) -> Response:
        try:
            if self.compatibility and "_" in file_name:
                storage_name, display_name = (self._name(part) for part in file_name.split("_", 1))
                self._path(group, display_name)
            else:
                storage_name = display_name = self._name(file_name)
            path = self._path(group, storage_name)
            if not path.is_file():
                raise NotFoundError("File not found")
            media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            headers = {"X-Content-Type-Options": "nosniff", "Cache-Control": "max-age=2592000"}
            if picture:
                body, media_type = await run_in_threadpool(self._picture, path, width, height)
                original = FileResponse(
                    path, filename=display_name, content_disposition_type="inline"
                )
                headers["Content-Disposition"] = original.headers["content-disposition"]
                return Response(body, media_type=media_type, headers=headers)
            return FileResponse(
                path,
                filename=display_name,
                media_type=media_type,
                content_disposition_type="inline",
                headers=headers,
            )
        except GrocyError as error:
            if self.compatibility:
                raise NotFoundError(error.message, code=None) from error
            raise

    @staticmethod
    def _picture(path: Path, width: int | None, height: int | None) -> tuple[bytes, str]:
        from PIL import Image, UnidentifiedImageError

        if any(value is not None and not 0 < value <= 4096 for value in (width, height)):
            raise GrocyError("Invalid image dimensions")
        try:
            with Image.open(path) as picture:
                if picture.width * picture.height > 25_000_000:
                    raise GrocyError("Image exceeds the pixel limit", status_code=413)
                image_format = picture.format or "PNG"
                picture.thumbnail((width or picture.width, height or picture.height))
                output = io.BytesIO()
                picture.save(output, image_format)
                return output.getvalue(), Image.MIME.get(image_format, "application/octet-stream")
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
            raise GrocyError("File is not a valid image") from error

    async def put(self, request: Request, group: str, file_name: str) -> None:
        path = self._path(group, self._name(file_name))
        if path.exists():
            raise GrocyError(f"Error while creating file {path.name}", code=None)
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(dir=path.parent)
        size = 0
        try:
            with os.fdopen(descriptor, "wb") as stream:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > get_settings().max_upload_bytes:
                        raise GrocyError("File exceeds the upload limit", status_code=413)
                    await run_in_threadpool(stream.write, chunk)
            try:
                await run_in_threadpool(os.link, temporary, path)
            except FileExistsError as error:
                raise GrocyError(f"Error while creating file {path.name}", code=None) from error
        finally:
            Path(temporary).unlink(missing_ok=True)

    async def delete(self, group: str, file_name: str) -> None:
        path = self._path(group, self._name(file_name))
        await run_in_threadpool(path.unlink, missing_ok=True)
