"""Identify saved content with the same file database used by Grocy."""

import subprocess
from pathlib import Path


def content_type(path: Path) -> str:
    try:
        import magic
    except ImportError:
        # macOS supplies the file tool even when libmagic has no public library path.
        result = subprocess.run(
            ["file", "--brief", "--mime-type", "--", str(path)],
            check=True,
            capture_output=True,
            text=True,
        )
        mime = result.stdout.strip()
    else:
        mime = magic.from_file(str(path), mime=True)
    if mime == "inode/x-empty":
        mime = "application/x-empty"
    return mime + ";charset=UTF-8" if mime.startswith("text/") else mime
