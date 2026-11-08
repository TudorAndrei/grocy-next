# Grocy Next

Grocy Next is a Python household-management API built with FastAPI, SQLite and FastMCP. The compatibility API uses the pinned Grocy v4.5.0 contract. The nutrition API adds proposals, review, evidence and revision history. External assistants can use MCP. The server does not run an agent, OCR or a vision model.

The Python API is the core product and the Grocy parity completion target. Its HTTP contract and behavior support independent clients. The web client uses [Native Shell](https://nsh.dev/) with TSX signals and its DOM/Wasm renderer. It replaces the removed React frontend. See [client setup and supported workflows](frontend/README.md). See the [API-only acceptance status](docs/api-parity-status.md).

## Functions

- Product catalog, barcodes, locations, stores, groups, units, and conversions.
- Stock purchases, consumption, open state, transfer, counts, entry edits, and undo.
- Recipe ingredients, included recipes, stock checks, partial consumption, and shopping quantities.
- Meal plans with recipes, products, notes, and meal sections.
- Shopping lists with purchased items and printable output.
- Chores, assignments, tasks, batteries, equipment, and instruction manuals.
- Custom entity definitions, custom records, and custom field values.
- Stored user permissions, API key creation and removal, and calendar subscriptions.
- Nutrition proposals, approval, rejection, revision restore, and label photos.
- Database import with a source snapshot and a separate destination database.

The Python API provides the 86 contract operations and reads for the 33 listable entities. The generic API blocks API key reads, as the contract requires. The release uses Python (`GROCY_USE_NATIVE_PHP=false`). PHP is used only as a test reference. State comparison tests use a temporary Grocy v4.5.0 server. See [API parity status](docs/api-parity-status.md) for the finite acceptance scope and certification results, and [compatibility](docs/compatibility.md) for implementation details and historical evidence.

## Local development

Python 3.13 and the backend dependencies are sufficient to run the API. PHP is required only for legacy comparison tests. See [the backend setup](backend/README.md).

```bash
mise run setup   # Python API dependencies and frontend dev tools
mise run dev
```

Or install dependencies and start the API directly:

```bash
cd backend
uv sync --frozen
uv run grocy
```

The API listens at <http://127.0.0.1:8000>. Check `/api/health` and send the development key `dev-key` in the `GROCY-API-KEY` header for authenticated requests. The application applies schema upgrades at startup when `GROCY_AUTO_CREATE_SCHEMA=true`. See the backend setup for configuration and API-key creation.

Start the Native Shell client separately after installing NSH 0.4.0:

```sh
mise run web:dev
```

## Containers

```bash
docker compose up --build
```

The API is available at <http://127.0.0.1:8000>. The web client is available at <http://localhost:8080>. Enter that same origin and your API key at its connection screen. Compose builds the NSH client and serves it through nginx, forwarding API requests to Python. The release image uses Python and does not install PHP. The volume stores the database and files under `/data`.

To serve under `/grocy/`, set `GROCY_BASE_PATH=/grocy` before starting the API. This prefix applies to API routing and generated links. Set `GROCY_BASE_URL` separately when generated links need a different public base URL.

For a new installation without demo records, set `GROCY_SEED_DEMO_DATA=false` and `GROCY_DEV_OPEN_API_KEY=` before startup. Create an administrator and a random API key:

```bash
docker compose run --rm api uv run --no-dev grocy-cli init --username admin
```

Save the returned key and configure it in your client. `init` refuses a database that already has users.

## Verification

```bash
cd backend
uv run pytest
uv run ruff check --config pyproject.toml . ../scripts
uv run ruff format --config pyproject.toml --check . ../scripts
uv run ty check . ../scripts --error-on-warning
```

Run `mise run check` from the repository root for Python and frontend lint, format, and type checks.
Run `mise run fix` to apply safe lint fixes and format the files. Run tests separately.

GitHub Actions CI has been removed. Verification commands and Python tests remain available locally; the NSH client has local `web:check`, `web:test`, and `web:build` tasks.

The PHP reference tests are skipped unless a reference server is configured. See [compatibility](docs/compatibility.md) for the comparison command. Keep `GROCY_USE_NATIVE_PHP=false` when you test the Python release. See [migration](docs/migration.md) for database import and recovery, and [MCP tools](docs/mcp-tools.md) for assistant access.

## Git hooks

Run `mise install` to install the hook tools and repository hooks. Run
`mise run setup` to install the Python API dependencies and pinned frontend development tools.

```bash
mise x -- hk check --all
mise x -- hk fix --all
```

The pre-commit hook applies safe fixes and stages the changed files. The
commit-msg hook checks Conventional Commit messages. The checks cover Python,
TypeScript/TSX (Oxlint), frontend formatting (Oxfmt), Markdown, TOML, secrets, and file whitespace.
Copied source and agent assets are excluded from format changes. Gitleaks also
scans copied source, with a narrow exception for SHA-256 manifest checksums.
There is no spelling check.
