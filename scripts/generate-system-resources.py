"""Prepare the pinned Grocy changelog with its original Markdown renderer.

Run with the repository Python and a PHP executable available on PATH:
  python scripts/generate-system-resources.py /path/to/grocy-4.5.0
PHP is needed only to regenerate this committed resource, never at runtime.
"""

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path


def generate(source: Path, output: Path, php: str) -> None:
    if json.loads((source / "version.json").read_text())["Version"] != "4.5.0":
        raise ValueError("Expected Grocy 4.5.0 source")
    parser = source / "packages/erusev/parsedown/Parsedown.php"
    paths = sorted(
        path for path in (source / "changelog").glob("*.md") if path.name != "__TEMPLATE.md"
    )
    raw = subprocess.run(
        [
            php,
            "-d",
            "display_errors=stderr",
            "-r",
            "require $argv[1]; $parser = new Parsedown(); $items = []; "
            "foreach (json_decode(stream_get_contents(STDIN), true) as $path) { "
            '$parts = explode("_", basename($path)); '
            '$items[] = ["version"=>$parts[1], "release_date"=>explode(".", $parts[2])[0], '
            '"release_number"=>intval($parts[0]), '
            '"body_html"=>$parser->text(file_get_contents($path))]; '
            "} echo json_encode($items, JSON_THROW_ON_ERROR);",
            str(parser),
        ],
        input=json.dumps([str(path) for path in paths]),
        text=True,
        check=True,
        capture_output=True,
    )
    items = sorted(json.loads(raw.stdout), key=lambda item: -item["release_number"])
    output.mkdir(parents=True, exist_ok=True)
    data = {"newest_release_number": items[0]["release_number"], "changelog_items": items}
    (output / "changelog.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    shutil.copyfile(source / "LICENSE", output / "LICENSE")
    origin = {
        "source": "https://github.com/grocy/grocy",
        "version": "4.5.0",
        "commit": "21aa5eab218c8466f90729154cb293fffbe10c21",
        "generator": "scripts/generate-system-resources.py",
        "inputs": {
            str(path.relative_to(source)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in [*paths, parser]
        },
        "output_sha256": hashlib.sha256((output / "changelog.json").read_bytes()).hexdigest(),
    }
    (output / "ORIGIN.json").write_text(json.dumps(origin, indent=2) + "\n")


if __name__ == "__main__":
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("source", type=Path)
    arguments.add_argument("--php", default="php")
    arguments.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "backend/src/grocy/_vendor/grocy-system",
    )
    args = arguments.parse_args()
    generate(args.source.resolve(), args.output, args.php)
