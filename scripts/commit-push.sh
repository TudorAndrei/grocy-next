#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
git commit -m "$(cat <<'EOF'
Bootstrap Grocy Next with FastAPI, MCP, nutrition, and Phase 3 core.

Ship a self-hostable Python backend with Grocy-compatible products/stock APIs, nutrition propose/commit over REST and MCP, recipes/household scaffolds, and a TanStack frontend for the pantry vertical slice.
EOF
)"
git push -u origin HEAD
git status
git log -1 --oneline
