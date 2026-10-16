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
The original Grocy routes, Slim router, and CORS middleware select HTTP methods and route errors.
HEAD requests execute GET and return no body. OPTIONS requests return an empty 200 response.
Compatibility responses use native wildcard CORS headers. Unauthorized responses have no body.
The separate routing worker stops with the application and restarts after a worker failure.
`/api/openapi/specification` uses the original controller and includes current custom entities.
File requests use the original Grocy file controller and service with the pinned Gumlet image
library and PHP GD. Each request has its own PHP process. Uploads and downloads use streams.
The process stops when the response ends, the client disconnects, or the application stops.
Task completion, task undo, battery charging, charge undo, battery details, and all chore
operations use the original Grocy controllers and services. Each action has a separate PHP user context. Native permission
checks and SQL use the application database. The action process stops before the request returns.
Chore merges use the original SQL transaction. The private PDO schema retains each PHP version's
transaction state and error rules. It also has the native triggers, so SQL can write native views.
Calendar chore dates use the same `chores_current` view as the native API.
Recipe fulfillment, consumption, copy, missing-ingredient actions, and all six shopping actions
also use the original controllers and services. Raw prepared statements retain native insert IDs.
Recipe consumption commits ingredients before output creation. Copy can retain its new parent
when a later insert fails. The included Gettext packages load the original English translations.
Stock bookings, inventory, opening, transfers, entry edits, merges, barcode actions, reads, and undo
also use the original controller and service. All five label endpoints use the original controllers.
They use the pinned Guzzle packages and original webhook helper. Native errors and partial writes
remain unchanged. Raw product deletes clear application nutrition references inside the source transaction.
Thermal shopping lists use the original printer controller, stock formatting, and printer service.
The release's mike42/escpos-php 4.0 and gfx-php 0.6 packages produce the receipt bytes.
Set `GROCY_TPRINTER_IS_NETWORK_PRINTER`, `GROCY_TPRINTER_IP`, and `GROCY_TPRINTER_PORT`
for a TCP printer, or `GROCY_TPRINTER_CONNECTOR` for a device or output file.
`GROCY_TPRINTER_PRINT_QUANTITY_NAME` and `GROCY_TPRINTER_PRINT_NOTES` control receipt details.
Existing `GROCY_THERMAL_PRINTER_DEVICE`, `GROCY_THERMAL_PRINTER_HOST`, and
`GROCY_THERMAL_PRINTER_PORT` settings remain aliases. Explicit native settings take precedence.
An unconfigured or failed printer returns the native error. The route runs independently of its UI feature flag.
External barcode lookup uses the unchanged stock controller, plugin loader, and plugin validation.
The default is the original Open Food Facts plugin. `GROCY_STOCK_BARCODE_LOOKUP_PLUGIN` selects a plugin.
Put user PHP plugins in `$GROCY_DATAPATH/plugins`. `GROCY_DATAPATH` defaults to `data`. Docker uses `/data`.
User plugins take precedence over bundled plugins. Downloaded product pictures use `GROCY_FILES_ROOT`.
Lookup requires `MASTER_DATA_EDIT`, including requests that do not add a product.
Native plugin errors, query parsing, and partial product, barcode, image, and conversion saves remain unchanged.
System routes use the original system controller and application service.
Time offsets use PHP integer validation. System information reports the native PHP and SQLite runtime,
the request user agent, and the saved Grocy schema version. Configuration uses the original defaults.
`GROCY_DEFAULT_LOCALE`, `GROCY_BASE_URL`, and `GROCY_DISABLE_URL_REWRITING` select native locale and URL behavior.
The original locale middleware selects translations from user settings and `Accept-Language`.
All release locale files are bundled. Localization responses retain their native cache header.
Database change time uses the main database file timestamp. WAL timestamps do not replace it.
The production missing-translation route retains Grocy's null-response error.
Native schema version 253 is recorded when no version history exists. Imports keep supplied history and calendar key types.
Calendar export and sharing links use the original controller, calendar service, key service,
and eluceo/iCal 2.14.0. PHP handles date parsing, event IDs, escaping, folding, and time zones.
Native calendar secrets use their original key type and the server's local clock for expiry.
Saved application calendar subscriptions remain valid. Authentication reads only identity fields,
so unused user dates do not block access.
The web recipe page uses `/api/v2/recipes/{id}` routes for selected servings and ingredient details.
Set `TZ` to select the same server time zone for Python and the PHP workers.
User, permission, and single-setting operations also use the original Grocy controller.
User passwords use PHP's native password hash. Profile edits require the native fields.
Unused setting timestamps do not block native requests. The `/api/v2/user/settings` extension
supports bulk setting changes and deletion.
Set `GROCY_PHP_EXECUTABLE` if PHP is not available as `php` on `PATH`.
The Docker image includes this runtime.

```bash
uv sync
uv run grocy
uv run pytest
```

Environment variables use the `GROCY_` prefix (see `.env.example`).
