#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$ROOT/backend/data"

cd "$ROOT/backend"
export GROCY_DATABASE_URL="${GROCY_DATABASE_URL:-sqlite+aiosqlite:///data/grocy.db}"
export GROCY_HOST="${GROCY_HOST:-127.0.0.1}"
export GROCY_PORT="${GROCY_PORT:-8000}"
exec .venv/bin/grocy
