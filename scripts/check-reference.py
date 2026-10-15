#!/usr/bin/env python3
"""Run API comparisons against an isolated, checksum-verified Grocy v4.5.0 release."""

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

RELEASE = "v4.5.0"
RELEASE_SHA256 = "f8b72c9dd0415d899e308d100c07be85e059c9927f6c07db039cba75903e9d95"
RELEASE_URL = "https://github.com/grocy/grocy/releases/download/v4.5.0/grocy_4.5.0.zip"
ASSET_URL = "https://api.github.com/repos/grocy/grocy/releases/assets/241656549"
REQUIRED_MODULES = {
    "ctype",
    "fileinfo",
    "gd",
    "intl",
    "json",
    "mbstring",
    "pdo_sqlite",
    "filter",
    "iconv",
    "tokenizer",
    "zlib",
}
ROOT = Path(__file__).resolve().parents[1]


def checked_release(path: Path) -> Path:
    if not path.is_file():
        raise ValueError("The release archive does not exist.")
    with path.open("rb") as archive:
        digest = hashlib.file_digest(archive, "sha256").hexdigest()
    if digest != RELEASE_SHA256:
        raise ValueError("The release checksum does not match Grocy v4.5.0.")
    return path


def download_release(path: Path) -> Path:
    for url in (RELEASE_URL, ASSET_URL):
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "grocy-next-reference-check",
                "Accept": "application/octet-stream",
            },
        )
        try:
            with (
                urllib.request.urlopen(request, timeout=45) as response,
                path.open("wb") as output,
            ):
                copied = 0
                while chunk := response.read(1024 * 1024):
                    copied += len(chunk)
                    if copied > 64 * 1024 * 1024:
                        raise ValueError("The release archive exceeds the size limit.")
                    output.write(chunk)
            return checked_release(path)
        except (OSError, ValueError) as error:
            if url == ASSET_URL:
                raise ValueError(
                    f"The pinned release download failed: {error}"
                ) from error
    raise ValueError("The pinned release download failed.")


def run_reference(
    php: str,
    release: Path | None,
    *,
    json_output: bool,
    timezone: str,
    feature_flags: dict[str, str],
) -> int:
    with tempfile.TemporaryDirectory(prefix="grocy-reference-") as temporary:
        folder = Path(temporary)
        archive = (
            checked_release(release)
            if release
            else download_release(folder / "release.zip")
        )
        reference = (folder / "grocy").resolve()
        with zipfile.ZipFile(archive) as bundle:
            for item in bundle.infolist():
                target = (reference / item.filename).resolve()
                if not target.is_relative_to(reference):
                    raise ValueError(
                        "The archive contains a path outside the reference directory."
                    )
            bundle.extractall(reference)
        version = json.loads((reference / "version.json").read_text())
        if version["Version"] != RELEASE.lstrip("v"):
            raise ValueError("The reference version does not match Grocy v4.5.0.")
        data = reference / "data"
        data.mkdir(exist_ok=True)
        (data / "config.php").write_text(
            "<?php\nSetting('DISABLE_AUTH', true);\nSetting('DEFAULT_LOCALE', 'en');\n"
            "Setting('BASE_URL', '/');\nSetting('LABEL_PRINTER_RUN_SERVER', false);\n"
        )
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        base_url = f"http://127.0.0.1:{port}"
        environment = {
            **os.environ,
            **feature_flags,
            "GROCY_DATAPATH": str(data),
            "TZ": timezone,
        }
        with (folder / "php.log").open("w+") as log:
            server = subprocess.Popen(
                [
                    php,
                    "-d",
                    f"date.timezone={timezone}",
                    "-S",
                    f"127.0.0.1:{port}",
                    "-t",
                    str(reference / "public"),
                    str(reference / "public/index.php"),
                ],
                env=environment,
                stdout=log,
                stderr=log,
            )
            try:
                deadline = time.monotonic() + 20
                while True:
                    try:
                        with urllib.request.urlopen(
                            base_url + "/", timeout=2
                        ) as response:
                            response.read()
                        with urllib.request.urlopen(
                            base_url + "/api/system/info", timeout=2
                        ) as response:
                            info = json.load(response)
                        if info["grocy_version"]["Version"] != RELEASE.lstrip("v"):
                            raise ValueError(
                                "The server returned a different Grocy version."
                            )
                        break
                    except (OSError, ValueError):
                        if server.poll() is not None or time.monotonic() >= deadline:
                            log.seek(0)
                            raise ValueError(
                                "The reference server did not start. "
                                + log.read()[-4000:]
                            ) from None
                        time.sleep(0.1)
                environment.update(
                    GROCY_PHP_EXECUTABLE=php,
                    GROCY_REFERENCE_URL=base_url,
                    GROCY_REFERENCE_API_KEY="disposable-reference",
                    GROCY_REFERENCE_DISPOSABLE="1",
                    GROCY_REFERENCE_DATABASE=str(data / "grocy.db"),
                )
                with sqlite3.connect(data / "grocy.db") as database:
                    database.execute(
                        "INSERT INTO api_keys (api_key, user_id, expires) VALUES (?, 1, '2999-12-31 23:59:59')",
                        (environment["GROCY_REFERENCE_API_KEY"],),
                    )
                config = data / "config.php"
                config.write_text(
                    config.read_text().replace(
                        "'DISABLE_AUTH', true", "'DISABLE_AUTH', false"
                    )
                )
                return subprocess.run(
                    [
                        sys.executable,
                        "-m",
                        "pytest",
                        "tests/differential",
                        "-q",
                        "--tb=short",
                    ],
                    cwd=ROOT / "backend",
                    env=environment,
                    stdout=sys.stderr if json_output else None,
                    check=False,
                ).returncode
            finally:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=5)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--php", default="php", help="PHP executable with Grocy's required modules"
    )
    parser.add_argument(
        "--release", type=Path, help="Existing release ZIP with the pinned checksum"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Check local inputs and show the run configuration",
    )
    parser.add_argument("--output", choices=("text", "json"), default="text")
    parser.add_argument(
        "--timezone", default="UTC", help="Server time zone for both implementations"
    )
    parser.add_argument(
        "--feature-flag",
        action="append",
        default=[],
        metavar="NAME=VALUE",
        help="Set a Grocy feature flag for both implementations; can be repeated",
    )
    args = parser.parse_args()
    result: dict = {"ok": False, "baseline": RELEASE, "dry_run": args.dry_run}
    try:
        ZoneInfo(args.timezone)
        defaults = json.loads(
            (
                ROOT
                / "backend/src/grocy/compatibility/grocy_4_5_0_client_defaults.json"
            ).read_text()
        )["config"]
        feature_flags: dict[str, str] = {}
        for item in args.feature_flag:
            name, separator, value = item.partition("=")
            field = "FEATURE_FLAG_" + name.upper()
            if not separator or field not in defaults:
                raise ValueError(f"Unknown feature flag or missing value: {item}")
            feature_flags["GROCY_" + field] = value
        php = shutil.which(args.php)
        if php is None:
            raise ValueError("PHP was not found. Set --php to its executable path.")
        modules = subprocess.run(
            [php, "-m"], check=True, text=True, capture_output=True, timeout=10
        )
        missing = REQUIRED_MODULES - {
            line.strip().lower() for line in modules.stdout.splitlines()
        }
        if missing:
            raise ValueError("PHP modules are missing: " + ", ".join(sorted(missing)))
        if importlib.util.find_spec("pytest") is None:
            raise ValueError(
                "Use the backend Python environment, which includes pytest."
            )
        release = checked_release(args.release.resolve()) if args.release else None
        if args.dry_run:
            result.update(
                ok=True,
                php=php,
                release=str(release) if release else RELEASE_URL,
                sha256=RELEASE_SHA256,
                tests="backend/tests/differential",
                timezone=args.timezone,
                feature_flags=feature_flags,
            )
            code = 0
        else:
            code = run_reference(
                php,
                release,
                json_output=args.output == "json",
                timezone=args.timezone,
                feature_flags=feature_flags,
            )
            result.update(ok=code == 0, exit_code=code)
    except (
        OSError,
        ValueError,
        ZoneInfoNotFoundError,
        subprocess.SubprocessError,
    ) as error:
        code = 2
        result["error"] = str(error)
    if args.output == "json":
        print(json.dumps(result))
    elif result.get("error"):
        print(result["error"], file=sys.stderr)
    elif args.dry_run:
        print(json.dumps(result, indent=2))
    else:
        print("Reference tests passed." if result["ok"] else "Reference tests failed.")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
