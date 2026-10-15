# grocy backend

Python package for the Grocy Next API and MCP adapters.

The API requires PHP 8.1 through 8.4 with `bcmath`, `ctype`, `dom`, `fileinfo`,
`iconv`, `intl`, `libxml`, `mbstring`, `pdo_sqlite`, and `simplexml`. A PHP worker runs the included HTMLPurifier 4.18.0
library with Grocy 4.5.0 settings. Slim parses request bodies. LessQL compiles permission queries and
executes generic object graphs with native PDO quoting. Each generic SQL statement commits separately,
as in Grocy 4.5.0. PHP also assembles custom field responses with its native array keys and comparisons.
Generic reads and custom fields use the pinned Grocy controller and field service. Their original source,
OpenAPI file, and license are in `_vendor/grocy-core`. A second PHP worker evaluates SQLite regular
expressions and ceiling values. Both workers stop with the application. Generic read responses keep
PHP JSON encoding, native column order, status, and headers.
Set `GROCY_PHP_EXECUTABLE` if PHP is not available as `php` on `PATH`.
The Docker image includes this runtime.

```bash
uv sync
uv run grocy
uv run pytest
```

Environment variables use the `GROCY_` prefix (see `.env.example`).
