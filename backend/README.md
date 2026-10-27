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

Configuration is checked at process startup. Invalid modes, locales, currency codes, week starts, entry pages, and default night mode times stop startup. Restart the process after a configuration change.

Set `GROCY_BASE_PATH=/grocy` to serve API routes with that prefix. Set `GROCY_BASE_URL=/grocy/` for generated links. Configure the proxy to forward the prefixed API route to this service.

Demo and prerelease modes use `<GROCY_DATAPATH>/grocy_<GROCY_DEFAULT_LOCALE>.db`. Set `GROCY_DEMO_DB_SUFFIX` to select another suffix. Production and development modes use `GROCY_DATABASE_URL`. Normal startup initializes the selected database. Reads and writes stay in that database.

Use [Python barcode plugins](../docs/python-barcode-plugins.md) for custom lookup services.

Set `GROCY_DEFAULT_USER_SETTINGS` to a JSON object to change the user defaults. For example, `GROCY_DEFAULT_USER_SETTINGS='{"stock_due_soon_days":14}'` sets the default due window to 14 days. Saved user values have priority. Delete a saved value to use the configured default again. These defaults also apply to recipe stock checks.

Use `GROCY_AUTH_MODE=default` for API keys with a session cookie fallback. Use `api-key` for API keys only, or `session` for session cookies. In session mode, web setup and login issue a cookie. Logout removes that session.

Use `GROCY_AUTH_MODE=reverse-proxy` to use an identity header. The default header is `Remote-User`. The proxy must replace this header. New proxy users receive `GROCY_DEFAULT_PERMISSIONS`. Use `GROCY_REVERSE_PROXY_AUTH_HEADER` to change the name. With `GROCY_REVERSE_PROXY_AUTH_USE_ENV=true`, an `HTTP_` name reads the corresponding request header; other names read the process environment.

Use `GROCY_AUTH_MODE=ldap` for [LDAP login](../docs/python-ldap.md). This mode also accepts API keys and existing sessions. It does not use local passwords as a fallback. `GROCY_DISABLE_AUTH=true` and development modes use the first user in the database.

File type detection uses libmagic. The release image includes this data library. On macOS, the application can also use the system `file` tool.

Legacy picture responses use libgd through Python. The release image includes libgd3. Install libgd for identical image encoding in a local installation. If libgd is absent, local installations use Pillow; the image bytes can differ.

The package uses pinned Grocy assets for database definitions, the OpenAPI contract, translations, and printer tables. PHP source remains available as a test reference.

## Legacy comparison tests

Run the Python API against a separate Grocy 4.5.0 test server:

```bash
GROCY_USE_NATIVE_PHP=false uv run python ../scripts/check-reference.py
```

This test command requires PHP with the modules listed in [compatibility](../docs/compatibility.md). The release image does not install PHP. The separate reference CI job installs it.

The old `GROCY_USE_NATIVE_PHP=true` test mode runs original Grocy controllers. Its results do not prove that a Python feature is complete. Do not use this mode for a release.
