# Grocy Next

Grocy-compatible household management reimplementation: FastAPI + FastMCP + React/TanStack, with a nutrition extension. Intelligence stays in external MCP-connected assistants — this server has no embedded agent, OCR, or vision model.

**Baseline:** Grocy `v4.5.0` OpenAPI pinned in `contracts/grocy.openapi.json`.

## What works now

### Phase 1–2 (MVP)
- API-key auth (`GROCY-API-KEY`, demo key `dev-key`)
- Products, stock purchase/consume, shopping lists
- Nutrition propose → review → commit + revisions
- MCP tools (FastMCP + HTTP bridge)

### Phase 3 (in progress)
- Quantity unit conversions (direct + inverse + product purchase/stock factor)
- Stock open / transfer / inventory correction / booking undo
- Recipes: list, fulfillment, consume, missing → shopping list, nestings with cycle detection
- Household: chores (+ execute/undo), tasks (+ complete), batteries (+ charge/undo)
- Expanded `/api/objects/{entity}` coverage for core entities
- Frontend: pantry stock actions, recipes, household chores

Still later: meal plans, equipment/calendar/files, full differential PHP golden tests, complete client parity.

## Quick start

```bash
cd backend
uv sync
uv run grocy
```

```bash
cd frontend
pnpm install
pnpm dev
```

- API: http://127.0.0.1:8000/api/health
- UI: http://127.0.0.1:5173
- Demo API key: `dev-key`

```bash
cd backend
uv run pytest
uv run ruff check src tests
uv run grocy-mcp
```

If you just pulled dependency changes, re-run `uv sync` (needs `greenlet` via `sqlalchemy[asyncio]`).
