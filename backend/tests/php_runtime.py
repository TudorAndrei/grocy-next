"""Independent PHP HTTP configuration for public API expectations."""

import base64
import json
import os
import socket
import subprocess
import time
from pathlib import Path
from urllib.request import Request, urlopen

DEVELOPMENT_PROFILES = {
    "default": "",
    "hidden": "ini_set('display_errors', '0');",
    "plain": "ini_set('html_errors', '0');",
    "decorated": "ini_set('error_prepend_string', 'BEFORE:');"
    "ini_set('error_append_string', ':AFTER');",
    "linked": "ini_set('docref_root', 'https://docs.example/');ini_set('docref_ext', '.html');",
    "mime": "ini_set('default_mimetype', 'text/plain');ini_set('default_charset', 'ISO-8859-1');",
    "buffered": "ob_start();",
    "logging": "ini_set('log_errors', '1');"
    "ini_set('error_log', __DIR__ . '/development-errors.log');",
    "registration": "ini_set('default_mimetype', 'text/plain');"
    "ini_set('default_charset', 'ISO-8859-1');",
}


def read_http_settings(executable: str, directory: Path) -> dict:
    script = directory / "php-http-settings.php"
    marker = b"\x1ePHP_HTTP_SETTINGS\x1e"
    profiles = base64.b64encode(json.dumps(DEVELOPMENT_PROFILES).encode()).decode()
    script.write_text(
        """<?php
$cookies = $_COOKIE;
$profile = $_GET['profile'] ?? '';
if ($profile !== '') {
    $profiles = json_decode(base64_decode('__PROFILES__'), true);
    eval($profiles[$profile]);
}
if (isset($_GET['bootstrap'])) echo 'BOOTSTRAP:';
error_reporting($profile === '' ? E_ALL ^ (E_NOTICE | E_WARNING | E_DEPRECATED) : E_ALL);
ob_clean();
echo "\\x1ePHP_HTTP_SETTINGS\\x1e", json_encode([
    'max_input_vars' => (int)ini_get('max_input_vars'),
    'max_input_nesting_level' => (int)ini_get('max_input_nesting_level'),
]);
""".replace("__PROFILES__", profiles)
    )
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
        settings["development"] = {}
        with urlopen(url + "?bootstrap=1", timeout=2) as response:
            settings["bootstrap_output"] = response.read().split(marker, 1)[0]
            settings["bootstrap_content_type"] = response.headers.get("Content-Type")
        for profile in DEVELOPMENT_PROFILES:
            with urlopen(url + "?profile=" + profile, timeout=2) as response:
                settings["development"][profile] = {
                    "output": response.read().split(marker, 1)[0],
                    "content_type": response.headers.get("Content-Type"),
                }
                if profile == "logging":
                    log = directory / "development-errors.log"
                    contents = log.read_bytes() if log.exists() else b""
                    settings["development"][profile]["logged"] = contents.count(
                        b"ob_clean(): Failed to delete buffer. No buffer to delete"
                    )
        return settings
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
