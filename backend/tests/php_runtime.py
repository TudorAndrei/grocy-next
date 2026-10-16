"""Independent PHP HTTP configuration for public API expectations."""

import json
import os
import socket
import subprocess
import time
from pathlib import Path
from urllib.request import Request, urlopen


def read_http_settings(executable: str, directory: Path) -> dict:
    script = directory / "php-http-settings.php"
    marker = b"\x1ePHP_HTTP_SETTINGS\x1e"
    script.write_text("""<?php
$cookies = $_COOKIE;
error_reporting(E_ALL ^ (E_NOTICE | E_WARNING | E_DEPRECATED));
ob_clean();
echo "\\x1ePHP_HTTP_SETTINGS\\x1e", json_encode([
    'max_input_vars' => (int)ini_get('max_input_vars'),
    'max_input_nesting_level' => (int)ini_get('max_input_nesting_level'),
]);
""")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    url = f"http://127.0.0.1:{port}"
    process = subprocess.Popen(
        [executable, "-S", f"127.0.0.1:{port}", str(script)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env={key: value for key, value in os.environ.items() if key != "PHP_CLI_SERVER_WORKERS"},
    )
    try:
        deadline = time.monotonic() + 10
        while True:
            try:
                with urlopen(url, timeout=1) as response:
                    settings = json.loads(response.read().split(marker, 1)[1])
                break
            except OSError:
                if process.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError("Could not read the PHP HTTP configuration") from None
                time.sleep(0.02)
        cookie = "ignored=1; " * settings["max_input_vars"] + "extra=1"
        with urlopen(Request(url, headers={"Cookie": cookie}), timeout=2) as response:
            settings["startup_output"] = response.read().split(marker, 1)[0]
            settings["startup_content_type"] = response.headers.get("Content-Type")
        return settings
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
