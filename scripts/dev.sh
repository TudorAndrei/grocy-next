#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

printf 'VITE_API_BASE=\nVITE_API_KEY=dev-key\n' > "$ROOT/frontend/.env"
mkdir -p "$ROOT/backend/data"

cd "$ROOT/backend"
GROCY_DATABASE_URL='sqlite+aiosqlite:///data/grocy.db' \
GROCY_HOST=127.0.0.1 \
GROCY_PORT=8000 \
.venv/bin/grocy &
BACKEND_PID=$!

cd "$ROOT/frontend"
./node_modules/.bin/vite --host 127.0.0.1 --port 5173 &
FRONTEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Backend  -> http://127.0.0.1:8000/api/health  (pid $BACKEND_PID)"
echo "Frontend -> http://127.0.0.1:5173             (pid $FRONTEND_PID)"
echo "API key: dev-key"
wait
