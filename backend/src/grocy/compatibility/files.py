"""Run pinned file controllers with streaming request and response pipes."""

from __future__ import annotations

import asyncio
import base64
import json
from collections.abc import AsyncIterator, Callable
from contextlib import suppress
from pathlib import Path
from typing import Any

from fastapi import Request
from starlette.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

from grocy.core.errors import GrocyError


class _FileSession:
    def __init__(self, executable: str, released: Callable[[_FileSession], None]) -> None:
        self.executable = executable
        self.released = released
        self.spawn: asyncio.Task[asyncio.subprocess.Process] | None = None
        self.process: asyncio.subprocess.Process | None = None
        self.upload: asyncio.Task[None] | None = None
        self.stderr: asyncio.Task[None] | None = None
        self.reading: asyncio.Task[bytes] | None = None
        self.closing: asyncio.Task[None] | None = None
        self.diagnostic = bytearray()

    async def _drain_stderr(self) -> None:
        assert self.process is not None and self.process.stderr is not None
        while chunk := await self.process.stderr.read(8192):
            self.diagnostic.extend(chunk)
            del self.diagnostic[:-4096]

    async def _upload(self, request: Request, metadata: dict[str, Any]) -> None:
        assert self.process is not None and self.process.stdin is not None
        try:
            self.process.stdin.write(json.dumps(metadata, separators=(",", ":")).encode() + b"\n")
            await self.process.stdin.drain()
            if request.method == "PUT":
                async for chunk in request.stream():
                    self.process.stdin.write(chunk)
                    await self.process.stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            # Native validation can return before it reads an invalid upload body.
            pass
        finally:
            self.process.stdin.close()

    async def start(self, request: Request, metadata: dict[str, Any]) -> dict[str, Any]:
        self.spawn = asyncio.create_task(
            asyncio.create_subprocess_exec(
                self.executable,
                "-d",
                "display_errors=stderr",
                "-d",
                "log_errors=0",
                str(Path(__file__).with_name("files_runtime.php")),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        )
        process = await asyncio.shield(self.spawn)
        self.process = process
        self.stderr = asyncio.create_task(self._drain_stderr())
        self.upload = asyncio.create_task(self._upload(request, metadata))
        assert process.stdout is not None
        self.reading = asyncio.create_task(process.stdout.readline())
        try:
            result = json.loads(await self.reading)
        finally:
            self.reading = None
        if not isinstance(result, dict) or result.get("protocol") != 1 or "error" in result:
            raise RuntimeError("The native file process could not create a response")
        if not self.upload.done():
            self.upload.cancel()
        with suppress(asyncio.CancelledError):
            await self.upload
        return result

    async def body(self) -> AsyncIterator[bytes]:
        assert self.process is not None and self.process.stdout is not None
        while True:
            self.reading = asyncio.create_task(self.process.stdout.read(65536))
            try:
                chunk = await self.reading
            finally:
                self.reading = None
            if not chunk:
                break
            yield chunk
        code = await self.process.wait()
        if code != 0:
            raise RuntimeError("The native file process stopped during the response")

    async def close(self) -> None:
        if self.closing is None:
            self.closing = asyncio.create_task(self._close())
        await asyncio.shield(self.closing)

    async def _close(self) -> None:
        try:
            if self.process is None and self.spawn is not None:
                with suppress(OSError):
                    self.process = await self.spawn
            if self.upload is not None:
                self.upload.cancel()
                with suppress(asyncio.CancelledError, Exception):
                    await self.upload
            if self.reading is not None:
                self.reading.cancel()
                with suppress(asyncio.CancelledError):
                    await self.reading
            if self.stderr is not None:
                self.stderr.cancel()
                with suppress(asyncio.CancelledError):
                    await self.stderr
            if self.process is not None and self.process.returncode is None:
                with suppress(ProcessLookupError):
                    self.process.terminate()
            if self.process is not None:
                if self.process.stdin is not None:
                    self.process.stdin.close()
                try:
                    await asyncio.wait_for(self.process.communicate(), timeout=2)
                except TimeoutError:
                    with suppress(ProcessLookupError):
                        self.process.kill()
                    await self.process.communicate()
        finally:
            self.released(self)


class _NativeFileResponse(StreamingResponse):
    def __init__(self, session: _FileSession, metadata: dict[str, Any]) -> None:
        super().__init__(session.body(), status_code=metadata["status"])
        self.session = session
        self.raw_headers = [
            (base64.b64decode(name), base64.b64decode(value)) for name, value in metadata["headers"]
        ]

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            await self.session.close()


class NativeFiles:
    def __init__(self, executable: str) -> None:
        self.executable = executable
        self.sessions: set[_FileSession] = set()
        self.closed = False

    async def response(
        self, request: Request, root: Path, group: str, file_name: str
    ) -> StreamingResponse:
        if self.closed:
            raise GrocyError("Native file runtime is unavailable", status_code=503)
        raw_path = request.scope.get("raw_path", request.url.path.encode())
        suffix = raw_path.partition(b"/api/files/")[2]
        query = request.scope["query_string"]
        uri = raw_path + (b"?" + query if query else b"")
        metadata = {
            "method": request.method,
            "root": str(root.resolve()),
            "group": group,
            "file_name": file_name,
            "uri": base64.b64encode(uri).decode("ascii"),
            "matched": bool(suffix) and suffix.count(b"/") == 1,
        }
        session = _FileSession(self.executable, self.sessions.discard)
        self.sessions.add(session)
        try:
            result = await session.start(request, metadata)
            return _NativeFileResponse(session, result)
        except BaseException as error:
            await session.close()
            if isinstance(error, (OSError, ValueError, KeyError, RuntimeError)):
                raise GrocyError("Native file runtime is unavailable", status_code=503) from error
            raise

    async def close(self) -> None:
        self.closed = True
        await asyncio.gather(*(session.close() for session in tuple(self.sessions)))
