import os
import signal
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from grocy.core.config import clear_settings_cache, get_settings
from grocy.main import create_app


@pytest.mark.skipif(os.name != "posix", reason="The worker executable fixture uses a POSIX script")
def test_worker_failure_keeps_input_filtered_and_recovers(tmp_path: Path, monkeypatch, api_headers):
    executable = get_settings().php_executable
    processes = tmp_path / "processes.txt"
    wrapper = tmp_path / "php-worker"
    wrapper.write_text(
        f"#!{sys.executable}\n"
        "import os, sys\n"
        f"with open({str(processes)!r}, 'a') as output:\n"
        "    output.write(str(os.getpid()) + '\\n')\n"
        f"os.execvp({executable!r}, [{executable!r}, *sys.argv[1:]])\n"
    )
    wrapper.chmod(0o700)
    monkeypatch.setenv("GROCY_PHP_EXECUTABLE", str(wrapper))
    clear_settings_cache()
    name = uuid4().hex
    with TestClient(create_app()) as client:
        client.headers.update(api_headers)
        pid = int(processes.read_text().splitlines()[-1])
        os.kill(pid, signal.SIGTERM)
        for _ in range(3):
            response = client.post(
                "/api/objects/locations",
                json={"name": name, "description": '<a href="javascript:x()">Link</a>'},
            )
            assert response.status_code in (200, 503), response.text
            if response.status_code == 200:
                location = response.json()["created_object_id"]
                assert client.get(f"/api/objects/locations/{location}").json()["description"] == (
                    "<a>Link</a>"
                )
                break
            assert (
                client.get("/api/objects/locations", params={"query[]": f"name={name}"}).json()
                == []
            )
        else:
            pytest.fail("The purifier did not recover after its worker stopped")
        pids = [int(item) for item in processes.read_text().splitlines()]
        assert len(pids) == 2 and pids[0] != pids[1]
        parameters = (("query[]", f"name={name}"), ("query[]", "description§Link"))
        matching = client.get("/api/objects/locations", params=parameters)
        assert matching.status_code == 200, matching.text
        assert [row["id"] for row in matching.json()] == [int(location)]
        regex_pid = int(processes.read_text().splitlines()[-1])
        assert regex_pid not in pids
        os.kill(regex_pid, signal.SIGTERM)
        for _ in range(3):
            matching = client.get("/api/objects/locations", params=parameters)
            assert matching.status_code in (200, 500, 503), matching.text
            if matching.status_code == 200:
                assert [row["id"] for row in matching.json()] == [int(location)]
                break
        else:
            pytest.fail("The native SQL function worker did not recover")
        pids = [int(item) for item in processes.read_text().splitlines()]
        assert len(pids) == 4 and len(set(pids)) == 4
        task = client.post("/api/objects/tasks", json={"name": name}).json()["created_object_id"]
        assert client.post(f"/api/tasks/{task}/complete", json={}).status_code == 204
        action_pids = {int(item) for item in processes.read_text().splitlines()} - set(pids)
        assert action_pids
        for action_pid in action_pids:
            with pytest.raises(ProcessLookupError):
                os.kill(action_pid, 0)
        pids.extend(action_pids)
    for pid in pids:
        with pytest.raises(ProcessLookupError):
            os.kill(pid, 0)


def test_missing_php_prevents_server_startup(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("GROCY_PHP_EXECUTABLE", str(tmp_path / "missing-php"))
    clear_settings_cache()
    with pytest.raises(FileNotFoundError), TestClient(create_app()):
        pass
