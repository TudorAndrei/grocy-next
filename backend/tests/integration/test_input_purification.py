import json
import os
import signal
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from grocy.core.config import clear_settings_cache, get_settings
from grocy.main import create_app

requires_native_php = pytest.mark.skipif(
    os.getenv("GROCY_USE_NATIVE_PHP", "false").lower() not in ("1", "true", "yes"),
    reason="requires GROCY_USE_NATIVE_PHP",
)


@pytest.mark.skipif(os.name != "posix", reason="The worker executable fixture uses a POSIX script")
@requires_native_php
def test_worker_failure_keeps_input_filtered_and_recovers(tmp_path: Path, monkeypatch, api_headers):
    from concurrent.futures import ThreadPoolExecutor
    from time import monotonic, sleep

    executable = get_settings().php_executable
    processes = tmp_path / "processes.txt"
    wrapper = tmp_path / "php-worker"
    fail_request = tmp_path / "fail-request"
    wrapper.write_text(
        f"#!{sys.executable}\n"
        "import os, sys\n"
        "from pathlib import Path\n"
        f"with open({str(processes)!r}, 'a') as output:\n"
        "    output.write(str(os.getpid()) + '\\n')\n"
        f"failure = Path({str(fail_request)!r})\n"
        "if failure.exists() and '-S' in sys.argv:\n"
        "    failure.unlink()\n"
        "    sys.exit(1)\n"
        f"os.execvp({executable!r}, [{executable!r}, *sys.argv[1:]])\n"
    )
    wrapper.chmod(0o700)
    monkeypatch.setenv("GROCY_PHP_EXECUTABLE", str(wrapper))
    clear_settings_cache()
    name = uuid4().hex
    with TestClient(create_app()) as client:
        client.options("/api/system/info")
        client.headers.update(api_headers)
        fail_request.touch()
        response = client.post(
            "/api/objects/locations",
            json={"name": name, "description": '<a href="javascript:x()">Link</a>'},
        )
        assert response.status_code == 503, response.text
        assert client.get("/api/objects/locations", params={"query[]": f"name={name}"}).json() == []
        response = client.post(
            "/api/objects/locations",
            json={"name": name, "description": '<a href="javascript:x()">Link</a>'},
        )
        assert response.status_code == 200, response.text
        location = response.json()["created_object_id"]
        assert (
            client.get(f"/api/objects/locations/{location}").json()["description"] == "<a>Link</a>"
        )
        config = get_settings().datapath / "config.php"
        marker = tmp_path / "inflight.pid"
        import base64

        encoded_path = base64.b64encode(str(marker).encode()).decode()
        config.write_text(
            "<?php file_put_contents(base64_decode('" + encoded_path + "'), (string)getmypid());"
            "usleep(5000000);"
        )
        try:
            with ThreadPoolExecutor(max_workers=1) as executor:
                pending = executor.submit(
                    client.post, "/api/objects/locations", json={"name": name + "-interrupted"}
                )
                deadline = monotonic() + 5
                while not marker.exists() and monotonic() < deadline:
                    sleep(0.01)
                assert marker.exists(), "The PHP request did not reach configuration"
                os.kill(int(marker.read_text()), signal.SIGTERM)
                assert pending.result(timeout=10).status_code == 503
        finally:
            config.unlink(missing_ok=True)
        assert (
            client.get(
                "/api/objects/locations", params={"query[]": f"name={name}-interrupted"}
            ).json()
            == []
        )
        parameters = (("query[]", f"name={name}"), ("query[]", "description§Link"))
        matching = client.get("/api/objects/locations", params=parameters)
        assert matching.status_code == 200, matching.text
        assert [row["id"] for row in matching.json()] == [int(location)]
        previous = set(processes.read_text().splitlines())
        task = client.post("/api/objects/tasks", json={"name": name}).json()["created_object_id"]
        assert client.post(f"/api/tasks/{task}/complete", json={}).status_code == 204
        current = set(processes.read_text().splitlines())
        assert current - previous
        for pid in current - previous:
            with pytest.raises(ProcessLookupError):
                os.kill(int(pid), 0)
        pids = {int(item) for item in processes.read_text().splitlines()}
    for pid in pids:
        with pytest.raises(ProcessLookupError):
            os.kill(pid, 0)


@requires_native_php
def test_missing_php_prevents_server_startup(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("GROCY_PHP_EXECUTABLE", str(tmp_path / "missing-php"))
    clear_settings_cache()
    with pytest.raises(FileNotFoundError), TestClient(create_app()):
        pass


_NATIVE_HTML = json.loads(
    (Path(__file__).parents[1] / "fixtures/native-html-void-elements.json").read_text()
)["cases"]


@pytest.mark.parametrize("case", _NATIVE_HTML, ids=[row["name"] for row in _NATIVE_HTML])
def test_saved_html_void_elements_match_native(client, api_headers, case):
    path = "/api/objects/shopping_lists/1"
    response = client.put(path, headers=api_headers, json={"description": case["input"]})
    assert response.status_code == 204, response.text
    stored = client.get(path, headers=api_headers)
    assert stored.status_code == 200
    assert stored.json()["description"] == case["expected"]
