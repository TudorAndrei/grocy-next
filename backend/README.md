# grocy backend

Python package for the Grocy Next API and MCP adapters.

The API requires PHP 8.1 through 8.4 with `bcmath`, `ctype`, `dom`, `fileinfo`, `gd`,
`iconv`, `intl`, `libxml`, `mbstring`, `pdo_sqlite`, and `simplexml`. A PHP worker runs the included HTMLPurifier 4.18.0
library with Grocy 4.5.0 settings. Slim parses request bodies. LessQL compiles permission queries and
executes generic object graphs with native PDO quoting. Each generic SQL statement commits separately,
as in Grocy 4.5.0. PHP also assembles custom field responses with its native array keys and comparisons.
Generic reads and custom fields use the pinned Grocy controller and field service. Their original source,
OpenAPI file, and license are in `_vendor/grocy-core`. A second PHP worker evaluates SQLite regular
expressions and ceiling values. Both workers stop with the application. Generic read responses keep
PHP JSON encoding, native column order, status, and headers.
File requests use the original Grocy file controller and service with the pinned Gumlet image
library and PHP GD. Each request has its own PHP process. Uploads and downloads use streams.
The process stops when the response ends, the client disconnects, or the application stops.
Task completion, task undo, battery charging, charge undo, and battery details use the original
Grocy controllers and services. Each action has a separate PHP user context. Native permission
checks and SQL use the application database. The action process stops before the request returns.
Set `TZ` to select the same server time zone for Python and the PHP workers.
Set `GROCY_PHP_EXECUTABLE` if PHP is not available as `php` on `PATH`.
The Docker image includes this runtime.

```bash
uv sync
uv run grocy
uv run pytest
```

Environment variables use the `GROCY_` prefix (see `.env.example`).
