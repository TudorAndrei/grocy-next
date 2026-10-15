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

All 86 contract operations have routes. The 33 listable contract entities support reads. The generic API blocks API key reads, as the contract requires. Contract response tests and workflow tests run locally. PHP state comparison tests are available for a disposable Grocy v4.5.0 server. This does not establish complete behavior parity with every upstream client. See [compatibility](docs/compatibility.md).

## Local development

Install PHP 8.1 through 8.4 and the extensions in [the backend setup](backend/README.md). The compatibility API uses PHP for Grocy's input filter, request parsing, and permission queries.

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

Open http://127.0.0.1:8080. The API is also available at http://127.0.0.1:8000. The volume stores the database and files under `/data`.

For a new installation without demo records, set `GROCY_SEED_DEMO_DATA=false` and `GROCY_DEV_OPEN_API_KEY=` before startup. Create an administrator and a random API key:

```bash
docker compose run --rm api uv run --no-dev grocy-cli init --username admin
```

Save the returned key and enter it in Connection. `init` refuses a database that already has users.

## Verification

```bash
cd backend
uv run pytest
uv run ruff check src tests
uv run basedpyright
cd ../frontend
npm run build
```

The PHP comparison suite is skipped unless a reference server is configured. See [compatibility](docs/compatibility.md) for the command. See [migration](docs/migration.md) for database import and recovery, and [MCP tools](docs/mcp-tools.md) for assistant access.
