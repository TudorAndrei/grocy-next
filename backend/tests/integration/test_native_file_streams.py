"""Native file streams release child processes after responses and disconnects."""

import asyncio
import base64
import os
import sys

import httpx
import pytest
from starlette.requests import ClientDisconnect

from grocy.core.config import clear_settings_cache, get_settings
from grocy.main import create_app


@pytest.mark.skipif(os.name != "posix", reason="The process fixture uses a POSIX executable")
async def test_native_file_streams_close_after_disconnect_and_shutdown(tmp_path, monkeypatch):
    executable = get_settings().php_executable
    recorded = tmp_path / "pids.txt"
    wrapper = tmp_path / "php-file-runtime"
    wrapper.write_text(
        f"#!{sys.executable}\n"
        "import os,sys\n"
        f"with open({str(recorded)!r},'a') as output: output.write(str(os.getpid())+'\\n')\n"
        f"os.execvp({executable!r},[{executable!r},*sys.argv[1:]])\n"
    )
    wrapper.chmod(0o700)
    root = tmp_path / "files"
    monkeypatch.setenv("GROCY_FILES_ROOT", str(root))
    monkeypatch.setenv("GROCY_PHP_EXECUTABLE", str(wrapper))
    clear_settings_cache()
    app = create_app()
    path = "/api/files/userfiles/" + base64.b64encode(b"stream.bin").decode()
    payload = b"stream data\x00" * 400000
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
            headers={"GROCY-API-KEY": "dev-key"},
        ) as api,
    ):
        await api.options("/api/system/info")
        assert (await api.put(path, content=payload)).status_code == 204
        assert (await api.get(path)).content == payload
        sent = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            sent.append(message["type"])
            if message["type"] == "http.response.body" and message.get("body"):
                raise OSError("The client disconnected")

        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.4"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "root_path": "",
            "query_string": b"",
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 1),
            "headers": [(b"grocy-api-key", b"dev-key")],
        }
        with pytest.raises(ClientDisconnect):
            await asyncio.wait_for(app(scope, receive, send), timeout=10)
        assert "http.response.start" in sent and "http.response.body" in sent
        assert (await api.get(path)).content == payload
        assert (await api.get(path, params={"force_serve_as": "picture"})).status_code == 404
        assert (await api.delete(path)).status_code == 204
    pids = set(recorded.read_text().splitlines())
    assert len(pids) > 1
    for pid in pids:
        with pytest.raises(ProcessLookupError):
            os.kill(int(pid), 0)
