# Grocy Next

Household management with FastAPI, SQLite, FastMCP, and React. The compatibility API uses the pinned Grocy v4.5.0 contract. The nutrition API adds proposals, review, evidence, and revision history. External assistants can use MCP. The server does not run an agent, OCR, or a vision model.

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

All 86 contract operations use the original Grocy 4.5.0 routes and response shapes. The 33 listable contract entities support reads. The generic API blocks API key reads, as the contract requires. By default the API runs in Python (`GROCY_USE_NATIVE_PHP=false`). Optional native PHP mode is for differential parity against Grocy 4.5.0. Contract response tests and workflow tests run locally. State comparison tests use a disposable Grocy v4.5.0 server. See [compatibility](docs/compatibility.md) for the tested behavior and runtime modes.

## Local development

Python 3.13 and the backend dependencies are enough for the default path. PHP is not required unless you enable native PHP parity (`GROCY_USE_NATIVE_PHP=true`); see [the backend setup](backend/README.md).

```bash
mise run setup   # first time (or after dependency changes)
mise run dev
```

Or install dependencies yourself, then start:

```bash
cd backend
uv sync --frozen
cd ../frontend
npm ci
cd ..
./scripts/dev.sh
```

Open http://127.0.0.1:5173. The development API key is `dev-key`. The script sets this key for the web application. It does not replace existing environment files.

To run the services separately:

```bash
cd backend
uv run grocy
```

```bash
cd frontend
VITE_API_KEY=dev-key npm run dev
```

Use Connection to set another server URL or API key. Use Manage to create the first location and quantity unit in an empty database. The application applies schema upgrades at startup when `GROCY_AUTO_CREATE_SCHEMA=true`.

## Containers

```bash
docker compose up --build
```

Open http://127.0.0.1:8080. The API is also available at http://127.0.0.1:8000. Compose uses the Python default runtime; native PHP does not need to be enabled. The image still includes PHP for optional parity and CI. The volume stores the database and files under `/data`.

For a new installation without demo records, set `GROCY_SEED_DEMO_DATA=false` and `GROCY_DEV_OPEN_API_KEY=` before startup. Create an administrator and a random API key:

```bash
docker compose run --rm api uv run --no-dev grocy-cli init --username admin
```

Save the returned key and enter it in Connection. `init` refuses a database that already has users.

## Verification

```bash
cd backend
uv run pytest
uv run ruff check --config pyproject.toml . ../scripts
uv run ruff format --config pyproject.toml --check . ../scripts
uv run ty check . ../scripts --error-on-warning
cd ../frontend
npm run check
npm run build
```

Run `mise run check` from the repository root for lint, format, and type checks.
Run `mise run fix` to apply safe lint fixes and format the files. Run tests separately.

The optional PHP reference comparison suite is skipped unless a reference server is configured. See [compatibility](docs/compatibility.md) for the command and for enabling `GROCY_USE_NATIVE_PHP`. See [migration](docs/migration.md) for database import and recovery, and [MCP tools](docs/mcp-tools.md) for assistant access.
