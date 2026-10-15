# grocy backend

Python package for the Grocy Next API and MCP adapters.

The API requires PHP 8.1 through 8.4 with `bcmath`, `ctype`, `dom`, `fileinfo`,
`iconv`, `intl`, `libxml`, `mbstring`, `pdo_sqlite`, and `simplexml`. A PHP worker runs the included HTMLPurifier 4.18.0
library with Grocy 4.5.0 settings. Slim parses request bodies. LessQL compiles permission queries with native PDO
quoting. This keeps the same HTML, CSS, request parsing, and permission write rules.
Set `GROCY_PHP_EXECUTABLE` if PHP is not available as `php` on `PATH`.
The Docker image includes this runtime.

```bash
uv sync
uv run grocy
uv run pytest
```

Environment variables use the `GROCY_` prefix (see `.env.example`).
