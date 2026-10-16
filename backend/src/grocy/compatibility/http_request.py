"""Run each compatibility request in PHP's HTTP SAPI with a private SQL channel."""

import asyncio
import base64
import json
import os
import secrets
import socket
from collections.abc import Awaitable, Callable
from contextlib import suppress
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

import httpx
from starlette.requests import ClientDisconnect
from starlette.types import Receive, Scope, Send

from grocy.compatibility.purifier import InputPurifier
from grocy.compatibility.values import decode_value, encode_value
from grocy.core.errors import GrocyError
from grocy.core.time import server_timezone


class NativeHttpTerminal(Exception):
    """PHP ended the HTTP response before another control reply was needed."""


class NativeHttpRequests:
    def __init__(self, executable: str, datapath: Path) -> None:
        self.executable = executable
        self.datapath = datapath
        self.active: set[NativeHttpRuntime] = set()

    def request(self, scope: Scope, receive: Receive, send: Send) -> "NativeHttpRuntime":
        runtime = NativeHttpRuntime(self, scope, receive, send)
        self.active.add(runtime)
        return runtime

    async def close(self) -> None:
        await asyncio.gather(*(runtime.close() for runtime in list(self.active)))


class NativeHttpRuntime(InputPurifier):
    def __init__(self, owner: NativeHttpRequests, scope: Scope, receive: Receive, send: Send):
        super().__init__(owner.executable, user_id=None, datapath=owner.datapath)
        self.owner, self.scope, self.receive, self.send = owner, scope, receive, send
        self._directory: TemporaryDirectory[str] | None = None
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._client: httpx.AsyncClient | None = None
        self._pump: asyncio.Task[None] | None = None
        self._function_lock = asyncio.Lock()
        self._closing = False
        self.sent = False
        self._function_sequence = 0
        self._control_buffer = bytearray()

    async def _upload(self, path: Path):
        with path.open("rb") as body:
            while chunk := body.read(65536):
                yield chunk

    async def _relay(self, request: httpx.Request) -> None:
        assert self._client is not None
        response = await self._client.send(request, stream=True)
        try:
            headers = [
                (name.lower(), value)
                for name, value in response.headers.raw
                if name.lower() not in {b"connection", b"transfer-encoding"}
            ]
            try:
                await self.send(
                    {
                        "type": "http.response.start",
                        "status": response.status_code,
                        "headers": headers,
                    }
                )
                self.sent = True
                async for chunk in response.aiter_raw():
                    await self.send(
                        {"type": "http.response.body", "body": chunk, "more_body": True}
                    )
                await self.send({"type": "http.response.body", "body": b"", "more_body": False})
            except OSError as error:
                raise ClientDisconnect() from error
        finally:
            await response.aclose()

    async def _start(self) -> None:
        if self._reader is not None:
            return
        self._directory = TemporaryDirectory(prefix="grocy-http-", dir="/tmp")
        root = Path(self._directory.name)
        upload = root / "body"
        with upload.open("wb") as body:
            while True:
                message = await self.receive()
                if message["type"] == "http.disconnect":
                    raise ClientDisconnect()
                body.write(message.get("body", b""))
                if not message.get("more_body", False):
                    break
        control = root / "control"
        listener = socket.socket(socket.AF_UNIX)
        listener.bind(str(control))
        listener.listen(1)
        listener.setblocking(False)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        token = secrets.token_hex(32)
        address = f"127.0.0.1:{port}"
        environment = {
            key: value for key, value in os.environ.items() if key != "PHP_CLI_SERVER_WORKERS"
        }
        environment.update(
            GROCY_NATIVE_HTTP_TOKEN=token,
            GROCY_NATIVE_CONTROL=str(control),
            GROCY_NATIVE_CACHE=str(root),
            GROCY_NATIVE_DATAPATH=str(self.owner.datapath),
        )
        self._process = await asyncio.create_subprocess_exec(
            self.executable,
            "-d",
            f"date.timezone={server_timezone().key}",
            "-S",
            address,
            str(Path(__file__).with_name("request_http.php")),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
            env=environment,
        )
        self._stderr = asyncio.create_task(self._drain_stderr(self._process))
        try:
            async with asyncio.timeout(10):
                while True:
                    if self._process.returncode is not None:
                        raise RuntimeError("The PHP HTTP worker stopped during startup")
                    try:
                        _reader, writer = await asyncio.open_connection("127.0.0.1", port)
                        writer.close()
                        await writer.wait_closed()
                        break
                    except OSError:
                        await asyncio.sleep(0.02)
                self._client = httpx.AsyncClient(timeout=None, trust_env=False)
                self._client.headers.clear()
                path = self.scope.get("raw_path", self.scope["path"].encode())
                url = httpx.URL("http://" + address).copy_with(
                    raw_path=b"/"
                    + token.encode()
                    + path
                    + (b"?" + self.scope["query_string"] if self.scope["query_string"] else b"")
                )
                headers = [
                    (name, value)
                    for name, value in self.scope["headers"]
                    if name.lower()
                    not in {
                        b"content-length",
                        b"transfer-encoding",
                        b"connection",
                    }
                ]
                headers.extend(
                    [
                        (b"content-length", str(upload.stat().st_size).encode()),
                    ]
                )
                request = self._client.build_request(
                    self.scope["method"], url, headers=headers, content=self._upload(upload)
                )
                self._pump = asyncio.create_task(self._relay(request))
                accept = asyncio.create_task(asyncio.get_running_loop().sock_accept(listener))
                done, _pending = await asyncio.wait(
                    {accept, self._pump}, return_when=asyncio.FIRST_COMPLETED
                )
                if accept not in done:
                    accept.cancel()
                    with suppress(asyncio.CancelledError):
                        await accept
                    await self._pump
                    raise NativeHttpTerminal()
                channel, _address = accept.result()
                self._reader, self._writer = await asyncio.open_connection(sock=channel)
                hello = await self._read()
                if not hello.get("ready") or hello.get("version") != "4.18.0":
                    raise RuntimeError(hello.get("error", "The PHP HTTP worker did not initialize"))
                self.php_version = hello["php_version"]
        finally:
            listener.close()

    async def _read(self) -> dict[str, Any]:
        assert self._reader is not None
        while True:
            boundary = self._control_buffer.find(b"\n")
            if boundary >= 0:
                line = self._control_buffer[:boundary]
                del self._control_buffer[: boundary + 1]
                return json.loads(line)
            chunk = await self._reader.read(65536)
            if not chunk:
                await self.finish()
                raise NativeHttpTerminal()
            self._control_buffer.extend(chunk)

    async def _write(self, value: dict[str, Any]) -> None:
        assert self._writer is not None
        self._writer.write(json.dumps(value, separators=(",", ":")).encode() + b"\n")
        await self._writer.drain()

    async def _request(
        self,
        body: bytes,
        fields: dict[str, Any],
        *,
        execute: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]] | None = None,
    ) -> Any:
        async with self._lock:
            try:
                await self._start()
                self._sequence += 1
                await self._write(
                    {"id": self._sequence, "json": base64.b64encode(body).decode(), **fields}
                )
                while True:
                    response = await self._read()
                    if response.get("id") != self._sequence or response.get("ok") is not True:
                        raise RuntimeError("The PHP HTTP worker rejected a control message")
                    if "query" not in response:
                        return response["body"]
                    if execute is None:
                        raise RuntimeError("The PHP HTTP worker requested an unexpected SQL query")
                    result = await execute(response["query"])
                    await self._write({"id": self._sequence, "resume": result})
            except (
                OSError,
                RuntimeError,
                ValueError,
                KeyError,
                TimeoutError,
                httpx.HTTPError,
            ) as error:
                if self._pump is not None and self._pump.done():
                    failure = self._pump.exception()
                    if isinstance(failure, ClientDisconnect):
                        raise failure from error
                raise GrocyError("Input purifier is unavailable", status_code=503) from error

    async def request_context(self, **arguments: Any) -> dict[str, Any]:
        headers = arguments.pop("headers")
        execute = arguments.pop("execute")
        return await self._request(
            b"",
            {
                "operation": "context",
                **arguments,
                "headers": [
                    [base64.b64encode(name).decode(), base64.b64encode(value).decode()]
                    for name, value in headers
                ],
                "client": self.scope.get("client"),
            },
            execute=execute,
        )

    async def sqlite_function(self, name: str, arguments: tuple) -> dict[str, Any]:
        async with self._function_lock:
            self._function_sequence += 1
            identity = -self._function_sequence
            await self._write(
                {
                    "id": identity,
                    "operation": "sqlite_function",
                    "name": name,
                    "arguments": [encode_value(value) for value in arguments],
                }
            )
            response = await self._read()
            if response.get("id") != identity or response.get("ok") is not True:
                raise RuntimeError("The PHP SQL function reply is invalid")
            result = response["body"]
            if "value" in result:
                result["value"] = decode_value(result["value"])
            return result

    async def emit(self, status: int, headers: list[tuple[bytes, bytes]], body: bytes) -> None:
        await self._request(
            body,
            {
                "operation": "http_emit",
                "status": status,
                "headers": [
                    [base64.b64encode(name).decode(), base64.b64encode(value).decode()]
                    for name, value in headers
                    if name.lower() != b"content-length"
                ],
            },
        )

    async def finish(self) -> None:
        if self._pump is not None:
            await self._pump

    async def close(self) -> None:
        if self._closing:
            return
        self._closing = True
        if self._pump is not None and not self._pump.done():
            self._pump.cancel()
        if self._pump is not None:
            with suppress(asyncio.CancelledError, Exception):
                await self._pump
        if self._writer is not None:
            self._writer.close()
            with suppress(OSError):
                await self._writer.wait_closed()
        if self._client is not None:
            await self._client.aclose()
        await super()._stop()
        if self._directory is not None:
            self._directory.cleanup()
        self.owner.active.discard(self)
