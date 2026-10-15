# Grocy compatibility

The baseline is Grocy v4.5.0 at commit `21aa5eab218c8466f90729154cb293fffbe10c21`. The OpenAPI file and its hash are in `contracts/`. Permission IDs and their parent relationships follow upstream migration 0110.

The backend requires PHP 8.1 through 8.4 for the included HTMLPurifier 4.18.0 engine. Set `GROCY_PHP_EXECUTABLE` when the executable is not named `php`. The Docker image includes the runtime. See [the backend setup](../backend/README.md).

The compatibility API implements the 86 operations in the contract. It returns stock booking arrays and uses status 204 for empty actions. The generic API supports the 33 listable entities, including calculated view records. The contract blocks generic API key reads and writes. The separate `/api/v2/api-keys` API manages keys. List queries support `query[]`, `order`, `limit`, and `offset`. Query operators are `=`, `!=`, `~`, `!~`, `<`, `>`, `<=`, and `>=`. The `§` operator uses regular expressions with a match timeout.

The exposed SQLite views and recipe fulfillment API use 19 pinned Grocy view definitions, including their dependencies. Quantity conversion and recipe views read current records instead of upstream caches. The permission hierarchy uses the pinned permission records. The application package includes the SQL definitions and Grocy's license notice.

The `/api/v2` API adds nutrition, API key management, and meal completion. MCP and the web application use the same domain services as the compatibility API.

System information reports the pinned Grocy API version and a separate application version. Configuration exposes public Grocy feature flags and the display currency. Localization strings use the pinned English defaults. System time supports offsets in seconds. Database change time includes SQLite WAL writes.

System information includes the pinned database version, 253. Its `php_version` field reports the input worker's PHP runtime version. System and database change times use the server time zone. Record timestamps use spaces and whole seconds. Timed calendar events include the time zone, equal start and end times, and time zone transitions for the event range.

User preferences include the pinned defaults. Stored values can be null. Deleting a preference restores its default. Database upgrades preserve existing values and add update timestamps.

Custom field reads include declared fields with null values when no value is stored. Writes reject unknown field names and preserve null values. Named custom record types use `userentity-{name}`. The web forms use field types, defaults, required inputs, and preset options from their definitions.

## Verification

The normal test suite checks API routes, response types, storage, stock quantities, recipe units, undo, permissions, files, calendars, import, and MCP startup.

To run the PHP comparisons with a new reference database:

```bash
uv run --project backend python scripts/check-reference.py
```

This command requires PHP and the modules that Grocy lists as required. It downloads the v4.5.0 release, verifies its SHA-256 checksum, starts a local reference server, and runs the comparison suite. It removes the temporary database and stops the server after the run. The `php-reference` CI job uses the same command.

The reference server has authentication enabled and uses disposable API keys. Use `--timezone Europe/Bucharest` to run both servers in that zone. CI checks UTC and Europe/Bucharest. The test for access without module permissions needs a local reference database to create its key. The script supplies this path. For a separate reference server, set `GROCY_REFERENCE_DATABASE` to its disposable SQLite file or that test will be skipped.

Use repeated `--feature-flag NAME=VALUE` options to set the same flag values on both servers. CI also runs the `disabled_feature_flags` case with tasks, chores, batteries, meals, due-date tracking, and freezing disabled. That profile uses `PYTEST_ADDOPTS='-k disabled_feature_flags'` because other scenarios assume the default flags.

Use `--php /path/to/php` to select another PHP executable. Use `--release /path/to/grocy_4.5.0.zip` to use an existing archive. `--dry-run` checks local inputs. `--output json` writes a machine-readable result to standard output and sends test output to standard error.

To compare state with upstream PHP, start a disposable Grocy v4.5.0 instance and supply its key:

```bash
cd backend
GROCY_REFERENCE_URL=http://127.0.0.1:9283 \
GROCY_REFERENCE_API_KEY=your-reference-key \
GROCY_REFERENCE_DISPOSABLE=1 \
uv run pytest tests/differential
```

The suite creates records in the reference database. It compares stock purchases, consumption, recipe fulfillment, recipe consumption, task completion times, task assignments, chore schedules, skipped executions, rescheduling, charge counts, undo, and household labels. It also checks preferences, custom fields, list filters, calendar events, and binary file storage. It verifies the reference version before it writes. Use a fresh reference database for each run. Disable physical printing in the reference with `LABEL_PRINTER_RUN_SERVER=false`.

The normal suite also uses 14 schedule cases from the pinned Grocy SQLite view. These cases cover hourly, daily, weekly, monthly, yearly, adaptive, manual, and rollover schedules. To regenerate the stored results from a Grocy v4.5.0 source checkout:

```bash
backend/.venv/bin/python scripts/generate-household-goldens.py \
  /path/to/grocy-4.5.0 backend/tests/fixtures/household-grocy-4.5.0.json
```

Grocy 4.5.0 uses the last logged execution in its weekly schedule query, including an undone execution. This API uses that same date for weekly schedules. Chore tracking counts and last completed times exclude skipped and undone executions.

Task completion and battery tracking use the exact timestamp form `YYYY-MM-DD HH:MM:SS`. Other scalar forms use the current time. Chores also accept `YYYY-MM-DD`. Stored dates keep that precision unless the chore's date-only setting requires a midnight timestamp. Import and startup upgrade preserve both forms. Chore frequency uses the same SQLite calculation and integer truncation as Grocy, including its floating point effects.

Purchase comparisons cover supplied purchase dates, price history, weighted prices, stock value, average shelf life, and calculated price and barcode records. Grocy's average price view uses integer division when all amounts and prices are integers. This API uses that same rule. Decimal input keeps decimal division.

Stock entry edits return an old booking and a new booking. Undo restores the prior entry. Undo checks later linked bookings. An entry edit can be undone after an unlinked consumption, as in Grocy 4.5.0. Price caches keep their last value when an undo leaves no calculated price row, as in Grocy 4.5.0.

Transfers return linked `transfer_from` and `transfer_to` bookings. They keep the stock ID, store, and note. Freeze and thaw settings set the new due date. Booking undo restores its linked pair. Transaction undo restores all active bookings in that transaction.

Partial opening keeps the scanned stock ID on the opened amount. The closed remainder keeps its store, price, and note. Opening supports child products, product restrictions, and linked transfers. Stock selection uses the default consume location, opened state, due date, and purchase date.

Recipe checks support child stock, rounded ingredient amounts, price factors, and ingredients that only require some stock. Recipe use leaves those presence-only ingredients in stock. Consumption records store the recipe ID and share a transaction ID. A recipe can create its output product as a self-production booking with its cost per serving. Stock consumption and output creation commit together.

## Boundaries

Route and entity coverage does not prove complete upstream behavior parity. The PHP comparison suite covers selected state changes. Full differential coverage for all options and third party clients is not established.

Calculated view fields and row IDs follow the pinned SQLite definitions. Import checks compared all six exposed SQLite views with the reference database. Purchase price caches are stored and imported. Domain services implement writes. Internal recipe caches and other upstream triggers are not imported as active behavior.

File image requests support bounded resizing. Generic queries support the upstream regular expression operator. A label request returns Grocycode data and can send it to a configured HTTP printer. Thermal printing uses a configured TCP printer or a local printer device. Without a thermal printer, the API returns `READY` and printable text.

File paths accept the Base64 file names from the contract. Plain file names remain available for existing Grocy Next clients. Both forms use the same path checks. Calendar exports include stock due dates, all-day tasks, chore schedules and assignments, battery charges, and meal section times.

Chore merging requires `MASTER_DATA_EDIT`. An administrator can replace their own permissions and remove their own administrator access. The next request uses those permissions, as in Grocy 4.5.0.

Chore execution filters input before its permission check. Missing chore execution and undo permissions return 400. User permission reads and writes return 403. Their caught errors include the upstream permission name in `error_message`. Task and battery permissions run before input checks.

Request filtering uses the pinned Grocy HTML, CSS, URI, and entity settings. PHP parses the original JSON bytes. Top-level scalar values pass through HTMLPurifier; booleans and arrays remain intact. Empty optional numeric and date values use the handler defaults. Filtered routes require the exact `application/json` content type. The backend keeps the upstream rules for null bodies, PHP array keys, and large numeric exponents. Empty database text is read as null, as in PDO.

A file upload cannot replace an existing file. Reads use the inline disposition and upstream cache duration. Only `force_serve_as=picture` enables image resizing. Resizing keeps the image format. List filters support SQLite wildcards, ASCII case matching, text values with leading zeros, and upstream null rules. The query parser also copies ignored operators and value truncation. Invalid generic object queries return the upstream status 500.

Stock label modes follow the Grocy 4.5.0 runtime: 0 for no label, 1 for one label, and 2 for one label per whole unit. The pinned OpenAPI file lists 1, 2, and 3. The runtime values take precedence for compatibility. Per-unit bookings share a transaction ID. As in PHP, mode 2 omits a fractional remainder. Stock counts accept a purchase date. They count the product across all locations and use the last price and store when these values are omitted.

Purchase labels use the new entry before stock entries combine. Automatic open, freeze, and thaw labels use the old entry and the new due date. Printer failures preserve the same prior stock changes as Grocy. Label requests support JSON and form encoding. Form requests omit database row fields, as PHP does. `GROCY_LABEL_PRINTER_PARAMS` supplies extra label values and defaults to the upstream font. The calculated due date takes precedence over these values. Set `GROCY_LABEL_PRINTER_HOOK_JSON=false` for form requests. Set `GROCY_LABEL_PRINTER_RUN_SERVER=false` to return label data without server printing.

Missing label records retain the upstream status rules. A missing stock entry returns 500. Missing products, chores, and batteries return 400. A missing recipe can return 200 with null label data.

Calendar subscription keys grant calendar access only. Revoke a subscription key through API key management. Server configuration responses omit API keys and the database URL.

Transfer undo follows Grocy 4.5.0. If the original source entry no longer exists, undo creates an entry at the current default location. It leaves the store empty and uses the default closed state. Consumption undo creates a separate entry and leaves the store empty.

Equivalent purchases combine into one stock entry. Entries with per-unit labels or nonempty stock custom fields remain separate. Purchase undo deletes all stock with that booking's stock ID. Thus, undo of one combined purchase can remove the stock from another purchase. This behavior matches Grocy 4.5.0. Open undo can leave a closed split entry with a separate stock ID.

Stock custom field writes use the purchase, inventory, or entry edit transaction ID. Reads use the stock ID. Generic stock reads include these values. Stock unit changes require a conversion after the first stock booking. They convert current stock, history, related amounts, prices, quick amounts, tare weight, and calories. Existing databases receive missing inverse conversions on upgrade.

Meal plan writes maintain day, week, and individual meal recipes. Startup restores these derived recipes for existing project databases. Consumption of an individual meal recipe uses the output product and servings from its source meal. Recipe fulfillment includes the pinned cost, calorie, price completeness, and product name fields. Normal ingredient amounts use stock units. The `/api/v2/recipes` input converts supplied units before storage. Recipe copy uses Grocy's name and serving defaults.

Shopping writes keep the requested unit, or use the purchase unit. Minimum stock settings can add missing items after product changes, consumption, or opening. Shopping removal uses the configured decimal threshold and the first matching product entry across lists, as in Grocy 4.5.0.

New users receive `GROCY_DEFAULT_PERMISSIONS`, whose default is `["ADMIN"]`. An empty password update keeps the stored password. User writes and permission reads apply the operation-specific permission checks.

Null and `"0"` password updates also keep the stored password. The current-user response is an array. User fields keep null values, and permission responses include row IDs. Authentication accepts the API key query parameter, including fallback from an invalid header key. Many compatibility reads require authentication only, as in Grocy. User reads, external barcode lookup, and writes retain their specific permission checks. MCP and v2 keep their application access rules.

Chore consumption uses the gross tare amount. Chore tracking saves its log before stock consumption, so a failed stock booking leaves that execution in the log. Assignment reads use the stored assignee until assignment calculation runs. Equal least-done counts use user ID order. Child stock opening copies PHP's repeated conversion of the remaining amount. This can open more stock than requested.

Feature flag environment values follow the upstream string and boolean rules. Only `true` and `false` become booleans. `0` stays a false string; `off` stays a true string. Flags control calendar groups, freeze and thaw dates, label due dates, and default location creation. They do not disable API routes. Explicit printer flags and `GROCY_LABEL_PRINTER_RUN_SERVER` control server printing. Existing Grocy Next printer settings still enable their printer flag when that flag is not set explicitly.

The audit still needs more input coercion, validation, and combined error cases. Python date types do not support year 0000, which PHP accepts. Generic object date inputs need more checks. Encoded image bytes can differ between Pillow and PHP GD. Printer error text differs from Guzzle. More response edge cases need checks. These gaps remain outside the verified behavior.

See [the backend parity audit](backend-parity-audit.md) for the repair scope and verification results.

To check a disposable running backend with the shared workflow tests, set
`GROCY_BACKEND_URL`, `GROCY_BACKEND_API_KEY`, and `GROCY_BACKEND_DISPOSABLE=1`.
Select the `local` cases. The database must be disposable because these cases write data.
