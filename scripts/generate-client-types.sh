#!/usr/bin/env bash
# Build-time only: Node is never required by the shipped NSH client.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
case "${1:-}" in
  ""|--check) ;;
  *) echo "Usage: $0 [--check]" >&2; exit 2 ;;
esac
SCHEMA_FILE="$(mktemp "${TMPDIR:-/tmp}/grocy-openapi.XXXXXX.json")"
trap 'rm -f "$SCHEMA_FILE"' EXIT
cd "$ROOT"
# Importing the app describes routes; this does not run lifespan/startup or touch a DB.
backend/.venv/bin/python - "$SCHEMA_FILE" <<'PY'
import json
import sys
from pathlib import Path

from grocy.main import create_app

Path(sys.argv[1]).write_text(json.dumps(create_app().openapi(), indent=2) + "\n")
PY
mkdir -p frontend/generated
OPTIONS=()
if [[ "${1:-}" == --check ]]; then OPTIONS+=(--check); fi
npx --yes openapi-typescript@7.13.0 "$SCHEMA_FILE" \
    --output frontend/generated/server.d.ts "${OPTIONS[@]}"
