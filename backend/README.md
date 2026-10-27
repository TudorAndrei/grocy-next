# Grocy backend

The release uses Python 3.13, FastAPI, SQLAlchemy, Alembic, and SQLite. PHP is not required. Keep `GROCY_USE_NATIVE_PHP=false`.

## Run and check

```bash
uv sync --frozen
uv run grocy
uv run pytest
uv run ruff check --config pyproject.toml . ../scripts
uv run ruff format --config pyproject.toml --check . ../scripts
uv run ty check . ../scripts --error-on-warning
```

Use `GROCY_` environment variables or `.env` for configuration. See [.env.example](.env.example). The Python release does not execute `config.php` or PHP plugins. Missing legacy features must be implemented in Python.

Use [Python barcode plugins](../docs/python-barcode-plugins.md) for custom lookup services.

File type detection uses libmagic. The release image includes this data library. On macOS, the application can also use the system `file` tool.

The package uses pinned Grocy assets for database definitions, the OpenAPI contract, translations, and printer tables. PHP source remains available as a test reference.

## Legacy comparison tests

Run the Python API against a separate Grocy 4.5.0 test server:

```bash
GROCY_USE_NATIVE_PHP=false uv run python ../scripts/check-reference.py
```

This test command requires PHP with the modules listed in [compatibility](../docs/compatibility.md). The release image does not install PHP. The separate reference CI job installs it.

The old `GROCY_USE_NATIVE_PHP=true` test mode runs original Grocy controllers. Its results do not prove that a Python feature is complete. Do not use this mode for a release.
