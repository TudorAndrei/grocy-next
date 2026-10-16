"""Run the pinned PHP request, field, and database logic."""

from __future__ import annotations

import asyncio
import base64
import json
from collections.abc import Awaitable, Callable
from contextlib import suppress
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from grocy.compatibility.cookies import NativeCookies
from grocy.compatibility.values import decode_value, encode_value
from grocy.core.errors import GrocyError
from grocy.core.time import server_timezone


class InputPurifier:
    def __init__(
        self,
        executable: str,
        *,
        user_id: int | None = 1,
        datapath: Path | None = None,
        function_runtime: InputPurifier | None = None,
    ) -> None:
        self.executable = executable
        self.user_id = user_id
        self.datapath = datapath
        self.function_runtime = function_runtime
        self.php_version = ""
        self._lock = asyncio.Lock()
        self._process: asyncio.subprocess.Process | None = None
        self._stderr: asyncio.Task[None] | None = None
        self._cache: TemporaryDirectory[str] | None = None
        self._sequence = 0
        self._functions: InputPurifier | None = None
        self._cookies: NativeCookies | None = None

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
                "-d",
                f"date.timezone={server_timezone().key}",
                str(Path(__file__).with_suffix(".php")),
                self._cache.name,
                str(self.user_id) if self.user_id is not None else "-",
                str(self.datapath or self._cache.name),
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

    async def request_context(
        self,
        *,
        method: str,
        uri: str,
        headers: list[tuple[bytes, bytes]],
        configuration: dict[str, Any],
        default_permissions: list[str],
        api_key_header: str,
        execute: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
    ) -> dict[str, Any]:
        provider = self.function_runtime or self
        if provider._cookies is None:
            provider._cookies = NativeCookies(self.executable)
        cookies = await provider._cookies.parse(headers)
        result = await self._request(
            b"",
            {
                "operation": "context",
                "method": method,
                "uri": uri,
                "headers": [
                    [base64.b64encode(name).decode(), base64.b64encode(value).decode()]
                    for name, value in headers
                ],
                "configuration": configuration,
                "default_permissions": default_permissions,
                "api_key_header": api_key_header,
                "cookies": cookies["cookies"],
                "http_ini": cookies["ini"],
                "error_reporting": cookies["error_reporting"],
            },
            execute=execute,
        )
        if settings := result.get("startup"):
            startup = await provider._cookies.startup(settings)
            if cookies["committed"]:
                cookies["output"] += startup["output"]
            else:
                cookies = startup
        result["startup_output"] = cookies
        return result

    async def purify(self, body: bytes) -> Any:
        return await self._request(body, {})

    async def generic_write(
        self,
        *,
        entity: str,
        method: str,
        object_id: int | str | None,
        body: bytes,
        content_type: str,
        execute: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
    ) -> dict[str, Any]:
        return await self._request(
            body,
            {
                "operation": "generic",
                "entity": entity,
                "method": method,
                "object_id": object_id,
                "content_type": content_type,
            },
            execute=execute,
        )

    async def userfield_write(
        self,
        *,
        entity: str,
        object_id: int | str,
        body: bytes,
        content_type: str,
        execute: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
    ) -> dict[str, Any]:
        return await self._request(
            body,
            {
                "operation": "field_write",
                "entity": entity,
                "object_id": object_id,
                "method": "PUT",
                "content_type": content_type,
            },
            execute=execute,
        )

    async def native_read(
        self,
        *,
        entity: str,
        object_id: int | str | None,
        query_string: bytes,
        execute: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
        fields: bool = False,
    ) -> dict[str, Any]:
        return await self._request(
            b"",
            {
                "operation": "field_read" if fields else "generic_read",
                "entity": entity,
                "object_id": object_id,
                "query_string": base64.b64encode(query_string).decode("ascii"),
            },
            execute=execute,
        )

    async def native_list(
        self,
        *,
        route: str,
        object_id: str | None,
        query_string: bytes,
        execute: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
    ) -> dict[str, Any]:
        return await self._request(
            b"",
            {
                "operation": "list_read",
                "route": route,
                "object_id": object_id,
                "query_string": base64.b64encode(query_string).decode("ascii"),
            },
            execute=execute,
        )

    async def sqlite_function(self, name: str, arguments: tuple) -> dict[str, Any]:
        if self.function_runtime is not None:
            return await self.function_runtime.sqlite_function(name, arguments)
        # A separate worker can answer while the main worker waits for SQLite.
        if self._functions is None:
            self._functions = InputPurifier(self.executable)
        result = await self._functions._request(
            b"",
            {
                "operation": "sqlite_function",
                "name": name,
                "arguments": [encode_value(value) for value in arguments],
            },
        )
        if "value" in result:
            result["value"] = decode_value(result["value"])
        return result

    async def native_action(
        self,
        *,
        route: str,
        object_id: str,
        user_id: int,
        method: str,
        body: bytes,
        content_type: str | None,
        query_string: bytes,
        uri: str,
        headers: list[tuple[bytes, bytes]],
        default_permissions: list[str],
        datapath: Path,
        configuration: dict[str, Any],
        execute: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
        arguments: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        # Grocy's current user is a PHP constant. Each action owns its request context.
        worker = (
            self
            if self.user_id is None
            else InputPurifier(self.executable, user_id=user_id, datapath=datapath)
        )
        try:
            return await worker._request(
                body,
                {
                    "operation": "action",
                    "route": route,
                    "object_id": object_id,
                    "user_id": user_id,
                    "method": method,
                    "content_type": content_type,
                    "query_string": base64.b64encode(query_string).decode("ascii"),
                    "uri": uri,
                    "headers": [
                        [base64.b64encode(name).decode(), base64.b64encode(value).decode()]
                        for name, value in headers
                    ],
                    "default_permissions": default_permissions,
                    "configuration": configuration,
                    "arguments": arguments or {},
                },
                execute=execute,
            )
        finally:
            if worker is not self:
                await worker.close()

    async def _request(
        self,
        body: bytes,
        fields: dict[str, Any],
        *,
        execute: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]] | None = None,
    ) -> Any:
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
                while True:
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
                    if "query" not in response:
                        return response["body"]
                    if execute is None:
                        raise RuntimeError("The PHP worker requested an unexpected SQL query")
                    result = await execute(response["query"])
                    process.stdin.write(
                        json.dumps(
                            {"id": self._sequence, "resume": result}, separators=(",", ":")
                        ).encode()
                        + b"\n"
                    )
                    await process.stdin.drain()
            except asyncio.CancelledError:
                await self._stop()
                raise
            except (OSError, RuntimeError, ValueError, KeyError) as error:
                await self._stop()
                raise GrocyError("Input purifier is unavailable", status_code=503) from error
            except BaseException:
                await self._stop()
                raise

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
            if self._functions is not None:
                await self._functions.close()
                self._functions = None
            if self._cookies is not None:
                await self._cookies.close()
                self._cookies = None
            if self._cache is not None:
                self._cache.cleanup()
                self._cache = None
