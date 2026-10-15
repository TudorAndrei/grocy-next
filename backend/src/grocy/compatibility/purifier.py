"""Run the pinned PHP purifier without replacing its HTML or CSS rules."""

import asyncio
import base64
import json
from contextlib import suppress
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from grocy.core.errors import GrocyError


class InputPurifier:
    def __init__(self, executable: str) -> None:
        self.executable = executable
        self.php_version = ""
        self._lock = asyncio.Lock()
        self._process: asyncio.subprocess.Process | None = None
        self._stderr: asyncio.Task[None] | None = None
        self._cache: TemporaryDirectory[str] | None = None
        self._sequence = 0

    async def start(self) -> None:
        async with self._lock:
            await self._start()

    async def _start(self) -> None:
        if self._process is not None and self._process.returncode is None:
            return
        await self._stop()
        if self._cache is None:
            self._cache = TemporaryDirectory(prefix="grocy-purifier-")
        try:
            self._process = await asyncio.create_subprocess_exec(
                self.executable,
                "-d",
                "display_errors=stderr",
                "-d",
                "log_errors=0",
                str(Path(__file__).with_suffix(".php")),
                self._cache.name,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            self._stderr = asyncio.create_task(self._drain_stderr(self._process))
            async with asyncio.timeout(10):
                if self._process.stdout is None:
                    raise RuntimeError("The PHP purifier has no output pipe")
                hello = json.loads(await self._process.stdout.readline())
            if not isinstance(hello, dict):
                raise RuntimeError("The PHP purifier sent an invalid startup message")
            if not hello.get("ready") or hello.get("version") != "4.18.0":
                raise RuntimeError(hello.get("error", "The PHP purifier version is incorrect"))
            if not isinstance(hello.get("php_version"), str):
                raise RuntimeError("The PHP purifier did not report its runtime version")
            self.php_version = hello["php_version"]
        except BaseException:
            await self._stop()
            raise

    @staticmethod
    async def _drain_stderr(process: asyncio.subprocess.Process) -> None:
        if process.stderr is not None:
            while await process.stderr.read(8192):
                pass

    async def purify(self, body: bytes) -> Any:
        return await self._request(body, {})

    async def permission_query(
        self, body: bytes, *, user_id: str, method: str, content_type: str | None
    ) -> dict[str, Any]:
        return await self._request(
            body,
            {
                "operation": "permissions",
                "user_id": user_id,
                "method": method,
                "content_type": content_type,
            },
        )

    async def _request(self, body: bytes, fields: dict[str, Any]) -> Any:
        async with self._lock:
            self._sequence += 1
            message = json.dumps(
                {"id": self._sequence, "json": base64.b64encode(body).decode("ascii"), **fields},
                separators=(",", ":"),
            ).encode()
            try:
                await self._start()
                process = self._process
                if process is None or process.stdin is None or process.stdout is None:
                    raise RuntimeError("The PHP purifier is not running")
                process.stdin.write(message + b"\n")
                await process.stdin.drain()
                data = bytearray()
                while not data.endswith(b"\n"):
                    chunk = await process.stdout.read(65536)
                    if not chunk:
                        raise RuntimeError("The PHP purifier stopped before it sent a response")
                    data.extend(chunk)
                response = json.loads(data)
                if (
                    not isinstance(response, dict)
                    or response.get("id") != self._sequence
                    or response.get("ok") is not True
                ):
                    raise RuntimeError("The PHP purifier could not process this request")
                return response["body"]
            except asyncio.CancelledError:
                await self._stop()
                raise
            except (OSError, RuntimeError, ValueError, KeyError) as error:
                await self._stop()
                raise GrocyError("Input purifier is unavailable", status_code=503) from error

    async def _stop(self) -> None:
        process, self._process = self._process, None
        if process is not None and process.returncode is None:
            with suppress(ProcessLookupError):
                process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=2)
            except TimeoutError:
                with suppress(ProcessLookupError):
                    process.kill()
                await process.wait()
        if self._stderr is not None:
            self._stderr.cancel()
            with suppress(asyncio.CancelledError, OSError):
                await self._stderr
            self._stderr = None

    async def close(self) -> None:
        async with self._lock:
            await self._stop()
            if self._cache is not None:
                self._cache.cleanup()
                self._cache = None
