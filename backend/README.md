# grocy backend

Python package for the Grocy Next API and MCP adapters.

## Default runtime (Python)

Compatibility and `/api/v2` routes run in FastAPI with SQLAlchemy, Alembic, and SQLite. `GROCY_USE_NATIVE_PHP` defaults to `false`. Local `uv run grocy`, `mise run dev`, and `docker compose up` use this path. PHP is not required.

Bundled assets under `_vendor/grocy-core` (OpenAPI, locales, ESC/POS tables, and related release files) remain available to the Python path. See `.env.example` for `GROCY_` settings.

```bash
uv sync
uv run grocy
uv run pytest
```

## Optional native PHP parity

Set `GROCY_USE_NATIVE_PHP=true` to run pinned Grocy controllers for differential parity against Grocy 4.5.0. That mode needs PHP 8.1 through 8.4 with `bcmath`, `ctype`, `dom`, `fileinfo`, `gd`, `iconv`, `intl`, `libxml`, `mbstring`, `pdo_sqlite`, and `simplexml`. Set `GROCY_PHP_EXECUTABLE` if PHP is not available as `php` on `PATH`. The Docker image includes this runtime for CI and parity jobs; Compose does not enable native PHP.

In native PHP mode, each compatibility request uses a PHP HTTP process with the pinned HTMLPurifier, Slim, LessQL, Gumlet, and related packages from `_vendor/grocy-core`. A private Unix socket carries SQL to the application database. Responses keep PHP JSON encoding, native column order, status, and headers. Configuration loads `$GROCY_DATAPATH/config.php` and native setting overrides. Set `TZ` when comparing Python and PHP workers in the same time zone.

User PHP plugins for barcode lookup go in `$GROCY_DATAPATH/plugins` (`GROCY_DATAPATH` defaults to `data`; Docker uses `/data`). `GROCY_STOCK_BARCODE_LOOKUP_PLUGIN` selects a plugin. Thermal printer and label settings (`GROCY_TPRINTER_*`, `GROCY_LABEL_PRINTER_*`, and their aliases) apply in both runtimes where those features are configured.

Environment variables use the `GROCY_` prefix (see `.env.example`).
