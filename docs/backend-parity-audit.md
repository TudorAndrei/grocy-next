# Backend parity audit

Audit date: 2026-10-15. Baseline: Grocy 4.5.0, commit `21aa5eab218c8466f90729154cb293fffbe10c21`.

The backend has routes for all 86 contract operations. The audit found missing state changes despite that route coverage. The repairs below address those findings. Full behavior parity for every client and input is not established by these checks.

## Catalog and database rules

Stock unit changes now require a conversion after a product has stock history. They convert current stock, history, recipe, shopping, chore, and meal quantities. They also convert prices, quick amounts, tare weight, calories, and local undo data. Conversion writes maintain inverse records. Upgrades add missing inverse records.

Product deletion removes linked stock, history, barcodes, conversions, recipe ingredients, shopping items, and product meal entries. It clears recipe output references and removes custom values. Chore, battery, shopping list, recipe, and custom record deletion also removes their linked records.

Generic ingredient, barcode, and shopping writes apply the Grocy unit defaults. Shopping items and ingredients accept zero amounts. Product writes use the upstream opened-stock default and parent rules. The generic API blocks API key reads and writes. It permits key deletion under the application permission checks.

Sources: [product rules](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/migrations/0207.sql), [quick amounts](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/migrations/0214.sql), [conversion rules](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/migrations/0225.sql), [unit defaults](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/migrations/0231.sql), [shopping defaults](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/migrations/0250.sql), and [generic API rules](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/controllers/GenericEntityApiController.php).

## Stock and undo

Product merges convert quantities and move recipe output references. Inventory counts use all product locations. An unchanged count returns an error. An increased count uses the last price and store when the request omits them. Child product location reads keep each product ID.

Equivalent purchases combine into one entry. Per-unit labels and nonempty stock custom fields prevent this combination. Stock custom field writes use the booking transaction ID. Reads use the stock ID. Product and entry labels include product details, the stock entry, and the due date.

Undo follows the PHP state rules. In particular, undo of one combined purchase deletes all stock with that stock ID. A full transfer undo can restore stock at the default location with no store and a closed state. These are Grocy 4.5.0 behaviors. The user requested exact runtime parity for undo.

Label modes use the runtime values 0, 1, and 2. The pinned OpenAPI file lists different values. In per-unit mode, PHP omits a fractional remainder. The backend now applies the same rule.

Purchase labels use the new entry before stock entries combine. Product details show stock before the purchase. Automatic labels for opening, freezing, and thawing use the old entry with the new due date. Move-on-open can send two labels. If the second request fails, the opened entry remains at the original location, as in Grocy.

Label requests support JSON and form encoding. Form requests omit database row fields because the PHP row objects have no public form fields. Labels include the default font setting. Printer parameters can replace payload fields. The calculated due date takes precedence over those parameters. Printer HTTP errors return 400. A failed purchase label leaves the saved purchase in stock. Server printing uses a two-second timeout. Set `GROCY_LABEL_PRINTER_RUN_SERVER=false` to return label data without sending a request.

Missing label records also follow PHP behavior. Missing products, chores, and batteries return 400. A missing stock entry returns 500. A missing recipe returns 200 with null name and details when server printing is disabled.

Sources: [stock service and undo rules](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/services/StockService.php), [stock API and label payloads](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/controllers/StockApiController.php), [stock field handling](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/migrations/0183.sql), and [printer request handling](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/helpers/WebhookRunner.php).

## Recipes, meal plans, and shopping

Meal writes maintain day, week, and individual meal recipes. Startup restores derived recipes in existing project databases. An individual meal recipe produces the output product and serving quantity from its source meal.

Recipe fulfillment uses the pinned SQL results for costs, calories, price completeness, due score, product names, and stock status. Normal ingredient quantities use stock units. The v2 recipe input converts supplied units before storage. Recipe copy follows the Grocy name, serving, and ingredient defaults.

Recipe shopping accepts excluded product IDs. Presence-only ingredients keep an unrelated unit when no conversion exists. Shopping additions keep the requested or purchase unit. Automatic minimum-stock additions use the acting user's settings. Removal uses the configured decimal threshold and the first matching product entry across lists.

Sources: [recipe service](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/services/RecipesService.php), [recipe API](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/controllers/RecipesApiController.php), and [stock and shopping service](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/services/StockService.php).

## Users and permissions

New users receive configured default permissions. The pinned default is `ADMIN`. An empty or null password update keeps the existing password. User creation, profile changes, and permission reads now use their specific permission checks. Shopping item and list writes use the add or delete permission. External barcode lookup requires master data access.

The current-user response is an array with one user. User fields keep null values. Permission responses include their row IDs. Password value `"0"` also keeps the stored password, as in PHP. Authentication accepts the API key query parameter and checks it when the header key is invalid.

Authenticated clients can read stock, household, recipe, generic object, custom field, and calendar data without a module permission. User list and permission reads retain their specific checks. File requests and public configuration reads also require authentication only. Recipe copy and chore assignment calculation follow the same upstream access rules. MCP and v2 access use the application permission rules.

Chore merging requires `MASTER_DATA_EDIT`. The `CHORES` permission alone does not allow it. A successful merge moves the removed chore's execution logs to the kept chore. A denied merge keeps both chores and their logs. An administrator can replace their own permissions, including with an empty list. The next request uses the new permissions, as in Grocy. Separate disposable users keep these checks from changing the reference owner.

Chore execution checks its filtered input before permission. A missing chore execution or undo permission returns 400. User permission reads and writes return 403. These caught permission errors include the upstream permission name and only the `error_message` field. Tasks and batteries check permission before input. The shared access test checks these combined errors and confirms that no execution or charge record changes.

User deletion now removes only the user row. It permits deletion of the current user. Keys, settings, permissions, task and chore assignments, and execution and stock history keep their user IDs. A retained key returns 401 after its user is deleted. A retained header key whose user was deleted stops authentication before a query key can replace it. A missing user delete returns 500 with the upstream error message. New user IDs do not reuse deleted IDs.

Revision 0012 removes the user reference constraints from existing project tables. It preserves the other foreign keys, indexes, views, triggers, row IDs, and date precision. Nutrition records also keep their contributor IDs. The same transaction method serves startup and manual Alembic upgrades. Imports retain deleted-user records and the source user ID sequence. Deletion of the last user does not create demo users on restart.

Sources: [user service](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/services/UsersService.php), [user API](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/controllers/UsersApiController.php), and [default permissions](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/config-dist.php).

API key source: [authentication middleware](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/middleware/ApiKeyAuthMiddleware.php). User field source: [user DTO view](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/migrations/0125.sql).

## Files, filters, and response formats

File upload creates a new file. A second upload with the same name returns 400 and preserves the original data. File reads use an inline disposition and the upstream cache duration. Image resizing requires `force_serve_as=picture` and keeps the image format. Size parameters alone return the original data.

List filters use the upstream query grammar. LIKE matching supports `%` and `_` wildcards and folds ASCII letters only. Text comparisons preserve leading zeros. Null comparisons and sort order follow SQLite. The parser also keeps the upstream rules for ignored operators and characters that end a value. Invalid generic object queries return 500, as in Grocy.

Stored record timestamps use spaces and whole seconds. Missing object reads return 404, but missing object updates and deletes return 400. Many missing stock and household actions also return 400. A missing stock entry read returns null. Missing product stock lists are empty. A missing location entry list returns 500, as in PHP.

The backend now includes the unmodified HTMLPurifier 4.18.0 runtime from the verified Grocy release. A PHP worker parses the original JSON bytes and applies the same HTML, CSS, URI, and entity rules. It processes top-level scalar values and keeps booleans and arrays. The request filter runs before Python converts numeric and date fields. Empty optional numbers and dates use the handler defaults. SQLite reads convert empty text to null, as PDO does in Grocy.

Filtered routes require the exact `application/json` content type. Permission writes that bypass the upstream filter retain their separate content type rules. Empty, malformed, and scalar bodies keep each handler's result. For example, task completion can return 500, while a setting write can store null and return 204. A JSON number such as `1e400` becomes `"INF"` in a text field, as in PHP.

The backend now requires PHP 8.1 through 8.4 and the listed extensions. The Docker image includes them. Startup checks the worker and library version. A failed worker cannot pass unfiltered input to a write. The next request can start a new worker. Shutdown stops the child process and removes its private cache. Library source, license, credits, and file checksums are included in the package.

Sources: [file API](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/controllers/FilesApiController.php), [image service](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/services/FilesService.php), [query parser](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/controllers/BaseApiController.php), and [object API](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/controllers/GenericEntityApiController.php).

## Household, stock checks, and time zones

Chore stock consumption uses the configured gross tare amount. Chore and battery actions return the full log record. When users have equal execution counts, the least-done assignment uses user ID order. Assignment reads use the stored assignee until calculation runs. Grocy saves a chore log before stock consumption. The backend now keeps that log if consumption fails. The PHP comparison covers this state change. It replaces the former test for atomic chore execution.

Stock actions reject inactive products. Purchase, consumption, transfer, and inventory checks also follow the upstream rules for an explicitly supplied inactive location. Barcode reads use SQLite case rules and return the upstream error status for missing or inactive products.

Child stock opening follows the PHP conversion loop. The remaining amount is converted again for each child entry. This can open more stock than requested. A missing conversion uses factor 1. These behaviors are deliberate runtime compatibility rules.

Task completion and battery tracking accept exact timestamps in `YYYY-MM-DD HH:MM:SS` format. Other scalar forms use the current time. Arrays and objects return 500 before a record changes. Chore tracking also accepts a date alone. A chore with `track_date_only=0` keeps that date without adding midnight. With `track_date_only=1`, it stores midnight. Imports and startup upgrades preserve both dates and timestamps.

Chore frequency uses SQLite's Julian day calculation and integer truncation, as in Grocy. For example, a one-hour interval can truncate to zero after the floating point calculation. Mixed dates and timestamps remain distinct records in that calculation. New and existing databases also receive Grocy's index on chore ID, undo state, and tracked time.

A local synthetic history with four chores and 1,000 records per chore gave the same average before and after the index. The median query time over three runs fell from 94.46 ms to 0.21 ms. The index used 120 KiB and took 0.59 ms to build in that fixture. Query plans changed from full scans and a temporary sort to index searches. These measurements apply to that fixture. They do not use a production history. The index adds storage and write work for each execution.

System times and database change times use the server time zone. Timed calendar events include a time zone and an equal start and end time. Calendar exports include time zone transitions for their event range. System metadata reports the pinned database version, 253. The `php_version` field reports the input worker's PHP runtime version.

Feature flag environment values now follow Grocy's conversion rules. `true` and `false` become booleans. Other values stay strings. Thus, `0` disables a flag, but `off` is a nonempty true string. The configuration response preserves these types. Disabled calendar groups produce no events. Disabled freezing keeps the normal purchase and transfer due dates. Disabled due-date tracking omits label due dates. Disabled location tracking creates location ID 1 when it is absent, including for existing users. Printer requests follow the feature flag and server execution setting.

Sources: [chore service](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/services/ChoresService.php), [timestamp validation](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/helpers/extensions.php), [frequency SQL](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/migrations/0167.sql), [battery API](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/controllers/BatteriesApiController.php), [stock service](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/services/StockService.php), [system service](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/services/ApplicationService.php), and [calendar API](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/controllers/CalendarApiController.php).

## Verification

The local suite passed 253 tests. It skipped 209 reference cases. The default comparison suite passed 384 cases and skipped the disabled-flag case. The disabled-flag profile passed both cases. Default checks ran in UTC and Europe/Bucharest. The disabled profile also passed in both zones. Ruff, basedpyright, and the frontend build passed.

The 51 new input cases also passed through HTTP against the built Docker image with PHP 8.4.26. The local reference checks used PHP 8.3.31. The built wheel contains all 380 vendor files with their original checksums and both worker files. Two local checks cover worker failure, recovery, shutdown, and startup without PHP. User deletion checks cover both startup and CLI upgrades from the saved revision 0011 schema, import of deleted-user records, and restart after last-user deletion. Six permission workflows also passed through HTTP in Docker. The three user deletion cases and a last-user restart check passed against the current Docker image.

The regression tests exercise public HTTP requests and stored state. The same new workflow cases run against the local backend and a disposable PHP reference server. The release archive has a pinned SHA-256 checksum. The reference server uses real API keys, English, default feature flags, and no physical label printer. CI runs comparisons in UTC and Europe/Bucharest. Label comparisons use a local HTTP receiver. They compare label fields, request formats, and stored stock after printer errors. Each new label regression failed on the previous code before the repair.

Run the full local checks:

```bash
cd backend
uv run pytest
uv run ruff check src tests
uv run basedpyright
```

Run the PHP comparisons:

```bash
uv run --project backend python scripts/check-reference.py
uv run --project backend python scripts/check-reference.py --timezone Europe/Bucharest
```

These checks do not test every plugin, physical printer, configuration, or third-party client. The `/api/v2` API, MCP, authentication storage, and server configuration are application extensions. See [the compatibility record](compatibility.md) for their boundaries.

The remaining audit must cover more input coercion, validation, and combined error cases. The current date types do not support year 0000, which PHP accepts. Generic object date inputs also need more checks. Image processing uses Pillow, so encoded image bytes can differ from PHP GD. Printer error text uses the local HTTP library and differs from Guzzle. Nested values, combined input and permission errors, and response edge cases need checks. Permission replacement with invalid input and other partial failures still need checks. These gaps prevent a claim of full runtime parity.
