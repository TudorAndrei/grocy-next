#!/usr/bin/env python3
"""Package an NSH development APK allowing HTTP only to loopback addresses.

NSH 0.4.0 has no custom manifest option for packaged APKs. Rebuild its manifest
and resources, preserve its bytecode/native libraries, then align and sign again.
The normal `nsh package --target android` release policy remains unchanged.
"""

import argparse
import json
import os
import subprocess
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run(*args: str | Path) -> None:
    subprocess.run([str(arg) for arg in args], check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "frontend/.nsh/android")
    parser.add_argument("--keystore", type=Path)
    options = parser.parse_args()
    sdk_root = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if not sdk_root:
        parser.error("Set ANDROID_HOME to an Android SDK with platform 35 and build tools.")
    sdk = Path(sdk_root)
    android_jar = sdk / "platforms/android-35/android.jar"
    if not android_jar.is_file():
        parser.error(f"Missing {android_jar}; install platforms;android-35.")
    versions = sorted(
        (p for p in (sdk / "build-tools").iterdir() if (p / "aapt2").is_file()),
        key=lambda p: tuple(int(n) for n in p.name.split(".") if n.isdigit()),
    )
    if not versions:
        parser.error("No Android build tools found.")
    tools = versions[-1]
    out = options.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    key = options.keystore.resolve() if options.keystore else out / "debug.keystore"
    if not key.exists():
        if options.keystore:
            parser.error(f"Keystore does not exist: {key}")
        run(
            "keytool",
            "-genkeypair",
            "-keystore",
            key,
            "-storepass",
            "android",
            "-keypass",
            "android",
            "-alias",
            "androiddebugkey",
            "-keyalg",
            "RSA",
            "-keysize",
            "2048",
            "-validity",
            "10000",
            "-dname",
            "CN=Android Debug,O=Android,C=US",
        )
    meta = json.loads((ROOT / "frontend/nsh.json").read_text())
    with tempfile.TemporaryDirectory(prefix="grocy-android-") as scratch:
        work = Path(scratch)
        run(
            os.environ.get("NSH_BIN", "nsh"),
            "package",
            ROOT / "frontend",
            "--target",
            "android",
            "--abi",
            "arm64-v8a",
            "-o",
            work,
            "--keystore",
            key,
            "--key-alias",
            "androiddebugkey",
            "--keystore-password",
            "android",
        )
        packaged = work / f"{meta['name']}.apk"
        compiled = work / "compiled"
        compiled.mkdir()
        run(
            tools / "aapt2",
            "compile",
            ROOT / "frontend/android/res/xml/network_security_config.xml",
            "-o",
            compiled,
        )
        resources = work / "network.apk"
        run(
            tools / "aapt2",
            "link",
            "-o",
            resources,
            "-I",
            android_jar,
            "--manifest",
            ROOT / "frontend/android/AndroidManifest.xml",
            "--min-sdk-version",
            "28",
            "--target-sdk-version",
            "35",
            "--version-code",
            str(meta.get("build", 1)),
            "--version-name",
            meta["version"],
            "--rename-manifest-package",
            meta["id"],
            "--rename-instrumentation-target-package",
            meta["id"],
            "--rename-resources-package",
            meta["id"],
            *compiled.glob("*.flat"),
        )
        unsigned = work / "unsigned.apk"
        with zipfile.ZipFile(packaged) as original, zipfile.ZipFile(resources) as policy:
            if any(name.startswith("res/") for name in original.namelist()):
                raise RuntimeError(
                    "NSH APK has resources; merge them before adding network policy."
                )
            with zipfile.ZipFile(unsigned, "w") as merged:
                for entry in original.infolist():
                    if entry.filename not in {
                        "AndroidManifest.xml",
                        "resources.arsc",
                    } and not entry.filename.startswith("META-INF/"):
                        merged.writestr(entry, original.read(entry.filename))
                for entry in policy.infolist():
                    merged.writestr(entry, policy.read(entry.filename))
        apk = out / f"{meta['name']}.apk"
        run(tools / "zipalign", "-P", "16", "-f", "4", unsigned, apk)
        run(
            tools / "apksigner",
            "sign",
            "--ks",
            key,
            "--ks-key-alias",
            "androiddebugkey",
            "--ks-pass",
            "pass:android",
            "--key-pass",
            "pass:android",
            apk,
        )
        run(tools / "apksigner", "verify", apk)
        print(f"Development APK: {apk}")


if __name__ == "__main__":
    main()
