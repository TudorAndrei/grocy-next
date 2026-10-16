"""Read cookies and startup output from the same PHP HTTP runtime as Grocy."""

import asyncio
import json
import os
import socket
from contextlib import suppress
from pathlib import Path
from typing import Any

import httpx

from grocy.core.errors import GrocyError
from grocy.core.time import server_timezone

_MARKER = b"\x1eGROCY_COOKIE_STATE\x1e"


class NativeCookies:
    def __init__(self, executable: str) -> None:
        self.executable = executable
        self._lock = asyncio.Lock()
        self._process: asyncio.subprocess.Process | None = None
        self._stderr: asyncio.Task[None] | None = None
        self._client: httpx.AsyncClient | None = None
        self._url = ""

    async def parse(self, headers: list[tuple[bytes, bytes]]) -> dict[str, Any]:
        return await self._request(headers)

    async def startup(self, settings: dict[str, Any]) -> dict[str, Any]:
        return await self._request([], settings)

    async def _request(
        self, headers: list[tuple[bytes, bytes]], startup: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        async with self._lock:
            try:
                await self._start()
                assert self._client is not None
                response = await self._client.post(
                    self._url,
                    headers=[(name, value) for name, value in headers if name.lower() == b"cookie"],
                    json=startup,
                )
                prefix, marker, payload = response.content.partition(_MARKER)
                if not marker:
                    raise ValueError("The PHP HTTP runtime did not return cookie state")
                result = json.loads(payload)
                if (
                    not isinstance(result, dict)
                    or not isinstance(result.get("cookies"), str)
                    or not isinstance(result.get("committed"), bool)
                    or not isinstance(result.get("ini"), dict)
                    or not isinstance(result.get("error_reporting"), int)
                ):
                    raise ValueError("The PHP HTTP runtime returned invalid cookie state")
                result.update(
                    output=prefix,
                    status=response.status_code,
                    content_type=response.headers.get("content-type", "text/html; charset=UTF-8"),
                )
                return result
            except asyncio.CancelledError:
                await self._stop()
                raise
            except (OSError, ValueError, RuntimeError, TimeoutError, httpx.HTTPError) as error:
                await self._stop()
                raise GrocyError("Input purifier is unavailable", status_code=503) from error

    async def _start(self) -> None:
        if self._process is not None and self._process.returncode is None:
            return
        await self._stop()
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        address = f"127.0.0.1:{port}"
        self._url = "http://" + address
        self._process = await asyncio.create_subprocess_exec(
            self.executable,
            "-d",
            f"date.timezone={server_timezone().key}",
            "-S",
            address,
            str(Path(__file__).with_suffix(".php")),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
            env={
                name: value
                for name, value in os.environ.items()
                if name != "PHP_CLI_SERVER_WORKERS"
            },
        )
        self._stderr = asyncio.create_task(self._drain_stderr(self._process))
        self._client = httpx.AsyncClient(timeout=10, trust_env=False)
        async with asyncio.timeout(10):
            while True:
                if self._process.returncode is not None:
                    raise RuntimeError("The PHP HTTP runtime stopped during startup")
                try:
                    await self._client.post(self._url)
                    return
                except httpx.ConnectError:
                    await asyncio.sleep(0.02)

    @staticmethod
    async def _drain_stderr(process: asyncio.subprocess.Process) -> None:
        if process.stderr is not None:
            while await process.stderr.read(8192):
                pass

    async def _stop(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
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
