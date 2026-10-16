# Grocy compatibility

The baseline is Grocy v4.5.0 at commit `21aa5eab218c8466f90729154cb293fffbe10c21`. The OpenAPI file and its hash are in `contracts/`. Permission IDs and their parent relationships follow upstream migration 0110.

The backend requires PHP 8.1 through 8.4 for its pinned HTMLPurifier, Slim, LessQL, and Gumlet runtime. It also requires the PDO SQLite and GD extensions. Set `GROCY_PHP_EXECUTABLE` when the executable is not named `php`. The Docker image includes the runtime. See [the backend setup](../backend/README.md).

Generic object reads and custom field operations now use the original pinned Grocy classes. Native
SQLite queries apply PHP query parsing, filters, order, limits, and offsets. The read adapter returns
PHP response bytes and native column order. SQLite regular expressions use PHP `mb_ereg`, including
its rules for nulls, invalid patterns, and long patterns. A separate PHP worker answers SQLite function
calls while the main worker waits for the database. The native `ceil` function also uses PHP.

The compatibility API implements the 86 operations in the contract. It returns stock booking arrays and uses status 204 for empty actions. The generic API supports the 33 listable entities, including calculated view records. The contract blocks generic API key reads and writes. The separate `/api/v2/api-keys` API manages keys. List queries support `query[]`, `order`, `limit`, and `offset`. Query operators are `=`, `!=`, `~`, `!~`, `<`, `>`, `<=`, and `>=`. Filtered list reads use the native Grocy controllers. The `§` operator uses the native PHP regular expression function.

The database uses all 45 pinned Grocy views and all 54 native triggers in their original creation order. Quantity conversion and recipe views read current records. Native triggers maintain the internal caches and inverse conversions. The permission hierarchy stores the pinned permission records. The application package includes the SQL definitions and Grocy's license notice.

The `/api/v2` API adds nutrition, API key management, and meal completion. MCP and the web application use the same domain services as the compatibility API.

System information reports the pinned Grocy API version and a separate application version. Configuration exposes public Grocy feature flags and the display currency. Localization strings use the pinned English defaults. System time supports offsets in seconds. Database change time includes SQLite WAL writes.

System information includes the pinned database version, 253. Its `php_version` field reports the input worker's PHP runtime version. System and database change times use the server time zone. Record timestamps use spaces and whole seconds. Timed calendar events include the time zone, equal start and end times, and time zone transitions for the event range.

User preferences include the pinned defaults. Stored values can be null. Deleting a preference restores its default. Database upgrades preserve existing values and add update timestamps.

User, permission, and single-setting requests execute the original Grocy `UsersApiController` and `UsersService`. PHP parses their raw bodies and creates password hashes. User creation requires both `username` and `password`. An empty password is accepted when the field is present. Profile edits require `username`, `first_name`, and `last_name`; omitted picture names clear the saved picture. Self-edit permission checks use PHP's numeric ID comparison. Setting values and numeric setting keys retain native LessQL and PHP array behavior. Bulk setting writes and deletion use the separate `/api/v2/user/settings` extension.

Custom field reads include declared fields with null values when no value is stored. Empty and null writes clear the stored value. Unknown field names return an error. Named custom record types use `userentity-{name}`. The web forms use field types, defaults, required inputs, and preset options from their definitions.

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

The comparison suite uses 15 schedule cases from the pinned Grocy SQLite view in migration 0185.
Migration 0167 supplies its frequency view. Each case checks native details, list reads, and calendar dates. These cases cover hourly, daily, weekly, monthly, yearly, adaptive, manual, and rollover schedules. To regenerate the stored results from a Grocy v4.5.0 source checkout:

```bash
backend/.venv/bin/python scripts/generate-household-goldens.py \
  /path/to/grocy-4.5.0 backend/tests/fixtures/household-grocy-4.5.0.json
```

Grocy 4.5.0 uses the last logged execution in its weekly schedule query, including an undone execution. This API uses that same date for weekly schedules. Chore tracking counts and last completed times exclude skipped and undone executions.

Task completion and battery tracking use the exact timestamp form `YYYY-MM-DD HH:MM:SS`. Other scalar forms use the current time. Chores also accept `YYYY-MM-DD`. Stored dates keep that precision unless the chore's date-only setting requires a midnight timestamp. Import and startup upgrade preserve both forms. Chore frequency uses the same SQLite calculation and integer truncation as Grocy, including its floating point effects.

Task completion and undo, battery charging and undo, battery details, and all chore operations execute the unchanged native controllers and services. They retain PHP request parsing, numeric ID conversion, year 0000 dates, errors, and JSON bytes. The native permission checks run at the original controller boundary. Each action has its own PHP current-user constant and uses the application database. `TZ` sets the server time zone for both runtimes.

Chore execution retains native boolean and user ID conversion, date-only values, year 0000, and partial writes after assignment or stock errors. Merge IDs use the strict native integer check. A merge moves the full execution history in one transaction. A failed merge restores all records and permits a retry. The adapter uses the current PHP PDO runtime to retain its transaction errors, including implicit SQLite rollback. Calendar chore dates read the same native schedule view. Manual schedules return null. Daily schedules keep the saved start clock. Native triggers supply the current clock for omitted, null, and empty start dates.

Purchase comparisons cover supplied purchase dates, price history, weighted prices, stock value, average shelf life, and calculated price and barcode records. Grocy's average price view uses integer division when all amounts and prices are integers. This API uses that same rule. Decimal input keeps decimal division.

Stock entry edits return an old booking and a new booking. Undo restores the prior entry. Undo checks later linked bookings. An entry edit can be undone after an unlinked consumption, as in Grocy 4.5.0. Price caches keep their last value when an undo leaves no calculated price row, as in Grocy 4.5.0.

Transfers return linked `transfer_from` and `transfer_to` bookings. They keep the stock ID, store, and note. Freeze and thaw settings set the new due date. Booking undo restores its linked pair. Transaction undo restores all active bookings in that transaction.

Partial opening keeps the scanned stock ID on the opened amount. The closed remainder keeps its store, price, and note. Opening supports child products, product restrictions, and linked transfers. Stock selection uses the default consume location, opened state, due date, and purchase date.

Recipe checks support child stock, rounded ingredient amounts, price factors, and ingredients that only require some stock. Recipe use leaves those presence-only ingredients in stock. Consumption records store the recipe ID and share a transaction ID. A recipe can create its output product as a self-production booking with its cost per serving. Ingredient consumption commits before output creation. A failed output booking or label request keeps that consumption and any output writes already made, as in Grocy 4.5.0.

Recipe fulfillment, consumption, copy, and missing-ingredient actions use the original controllers and services. The native routes ignore the `servings` query parameter. Fulfillment returns the native numeric flags and resolved fields. Copy returns a string ID and can retain its new recipe after a later insert fails. Duplicate ingredients can make a later consumption fail and roll back the full ingredient transaction. Recipe copy uses the original English localization service and pinned Gettext packages. Output labels use the original webhook helper and pinned Guzzle packages, including their HTTP error text.

All six shopping actions also use the original stock controller and service. PHP retains integer amount conversion, default list selection, boolean filtering, null body errors, and permission order. The web recipe page uses `/api/v2/recipes/{id}/fulfillment`, `/consume`, and `/add-not-fulfilled-products-to-shoppinglist` for selected servings and ingredient details. These extension writes require the stock consumption or shopping add permission.

Stock purchases, consumption, opening, transfers, inventory, entry edits, merges, barcode actions, remaining stock reads, and undo execute the original stock controller and service. PHP retains scalar conversion, numeric URL rules, date parsing, permission order, and partial writes. Labels also use the original product, stock entry, chore, battery, and recipe controllers with native Guzzle requests and errors. External barcode providers and thermal printing still use application code.

The native consumption controller retains its `transactiontype` field typo. Nonempty text passed as a PHP boolean can become true, including `spoiled: "false"`. Purchase label modes outside 0 through 2 use the original runtime branches. An entry edit requires `amount`. If `open` is omitted, it can save an old booking before returning the native type error. Native merge uses the existing product-deletion cleanup for nutrition records inside its transaction. A rejected merge restores those records and permits a retry.

## Boundaries

Route and entity coverage does not prove complete upstream behavior parity. The PHP comparison suite covers selected state changes. Full differential coverage for all options and third party clients is not established.

Calculated view fields and row IDs follow the pinned SQLite definitions. Generic writes use the unmodified pinned LessQL library. Each successful SQL statement commits before the next statement. Nested writes can therefore keep a parent after a child fails. Creation can return the last child ID. A private native schema checks column names before execution. The generic API exposes native columns and excludes local extension columns. Custom field values use the separate field endpoint.

Imports retain the 33 modeled native tables and their allocation history. The runtime also creates the native conversion cache, permission hierarchy, session table, and migration table. Source session and migration records are not imported. Authentication remains an application extension.

File requests use the original Grocy controller, file service, and Gumlet image code with PHP GD. The application selects the storage root. Uploads and downloads use streams through a separate PHP process for each request. Generic queries support the upstream regular expression operator. A label request returns Grocycode data and can send it to a configured HTTP printer. Thermal printing uses a configured TCP printer or a local printer device. Without a thermal printer, the API returns `READY` and printable text.

Native file paths require Base64 file names and the five Grocy storage groups: `equipmentmanuals`, `recipepictures`, `productpictures`, `userfiles`, and `userpictures`. Plain file names, bounded uploads, and Pillow image processing remain available through `/api/v2/files/{group}/{file_name}`. Nutrition photos use that extension. The equipment page uploads native manuals and can also download saved manuals from the old `equipment` group through the extension. Calendar exports include stock due dates, all-day tasks, chore schedules and assignments, battery charges, and meal section times.

User deletion removes only the user row, including when the current user deletes their own row. Saved keys, settings, permissions, assignments, and history keep their user IDs. A key for a deleted user returns 401. A retained header key whose user was deleted also prevents a query key from replacing it. A missing user delete returns 500. New user IDs do not reuse deleted IDs. Upgrades and imports preserve these records and the user ID sequence. The last user stays deleted after restart.

Permission replacement uses the native `permissions` field and Slim's unfiltered body parser. Single permission writes apply the Grocy input filter. Unknown permission IDs and user IDs without user rows are accepted. A failed replacement batch can leave the old permissions deleted. Missing, null, and scalar replacement values clear the permissions. PHP, PDO, LessQL, and SQLite keep the native value conversion and error rules. Permission row IDs keep their allocation counter after deletes, upgrades, and imports.

All 33 modeled native tables now use Grocy's SQLite allocation counters. Later inserts do not reuse deleted IDs. Imports keep the source counters even when they exceed all remaining IDs. Revision 0014 adds the remaining 31 counters to existing project databases. It preserves saved records, constraints, indexes, views, and triggers. An older table without a saved counter starts from its highest remaining ID. See [the upgrade limits](migration.md#project-schema-upgrades).

The modeled tables also use all 27 native `CHECK` expressions across 16 tables. These include boolean values, due types, purchase price types, and the positive chore interval. Checked numeric inputs use SQLite affinity. For example, task completion accepts `"1e0"` as 1 and rejects `"invalid"`. A rejected insert or update returns 400 with the native SQLite error message. The rejected update keeps the saved record.

Generic object creation returns only `created_object_id`, as a string. Clients can read the new record through its object URL. The frontend uses this response type. Other generic validation and reference rules still need comparison.

Generic names accept empty text and preserve spaces. Empty text reads as null, as in PDO. An empty object body returns ID `"0"` and inserts no row. A nonempty body that omits a required name returns the native database error. Meal section names are unique. The required default section has ID -1, an empty name, and sort number -1. Its delete guard returns 500, as in Grocy.

Generic object URL IDs remain text until SQLite compares them with the stored ID. Numeric exponents, signs, decimal forms, spaces, and leading zeros follow SQLite column affinity. The original URL text remains the custom field reference for single record reads. Missing IDs return `Object not found`, with 404 for reads and 400 for writes. Unknown and blocked entity operations use the native 400 messages. Calculated views keep their own SQL comparison rules. Some views list a dummy ID of 1 but return 404 for a single record request with that ID. Permission hierarchy IDs use the native integer comparison rule. Label handlers retain their separate missing-record behavior.

The native tables keep ORM links without the 36 extra database foreign keys from earlier project versions. Tasks can retain an unknown category ID. Other native references can also remain without a parent row. Imports preserve those records. Nutrition and custom foreign keys remain active. Native triggers retain the separate insert rules for barcodes and recipe ingredients. Some updates can keep references that those insert rules reject.

Nine unmodified native trigger definitions handle unit defaults, barcode and ingredient insert validation, conversion duplicates, and the default meal section delete guard. An orphan shopping item with no supplied unit keeps null. Recipe ingredient units can also be null when the native insert rules permit that state. Revision 0016 applies these rules to existing project databases.

Equipment names, shopping list names, and recipe nesting pairs now use their native unique keys. Duplicate inserts and updates return 400 with the native database error. These rejected duplicate writes keep the saved rows and do not consume an ID. Names use SQLite's case-sensitive comparison. Empty text and spaces remain distinct. A nonempty shopping list request without a name returns the native required-name error. Revision 0017 adds missing unique indexes without copying table data.

SQLite defaults and nullability match all 289 modeled native columns. Revision 0019 applies these rules to saved databases. It keeps data, counters, and custom SQL. A failed copy restores the original database. Required extension columns also have database defaults, so direct SQL can insert native records. Native null creation timestamps remain null in API responses. Meal-plan updates accept the native default product amount of zero. ORM input defaults and nested SQL execution remain separate open work.

Revision 0020 also matches native storage affinity for these columns. It corrects 15 differences across nine tables. A native `REAL` factor of 2 makes `1 / factor` return 0.5. Decimal application codecs remain available. The copy retains saved values and rejects precision loss. Dates and full timestamps remain distinct. This storage repair is another prerequisite for native SQL execution; it does not replace the current generic write code.

Custom values now use stable field IDs and text object keys. Field renames and entity changes keep their saved values. Keys `1` and `01` remain distinct. The field endpoint accepts text keys without requiring a parent record. With no declared fields, it returns an empty array. Each field write commits before the next field, as in Grocy. A later invalid field can leave earlier values saved.

Field responses use PHP array keys and comparisons. Names `0` and `1` can produce a JSON array. Names `0` and `00` can return the same saved value. Fields use their declared sort number and SQLite `NOCASE` name order. Without definitions, a generic single record has `userfields: null`, and a generic list record omits that property. Generic lists compare object keys with PHP numeric rules. A value stored under `01` can therefore appear on list record 1 while its direct field read remains distinct.

Field definitions belong to the exact requested entity. Custom record fields use `userentity-{name}`. The `userobjects` endpoint does not add those definitions. Its value lookup still includes the native namespace aliases. A namespace value can hide a direct value with the same name, as in Grocy 4.5.0. The PHP worker keeps these response rules. The web editor reads custom record values from their namespace and saves each field group through its field endpoint. A retry after a failed field save reuses the record created by the first attempt.

Four unmodified native triggers remove empty values, map stock transaction IDs to stock IDs, and apply the native field deletion rule. That deletion rule removes only values whose object key equals the deleted field ID. Other values remain orphan records. A new field with the same name has a new ID and does not inherit those values.

Product, chore, and battery deletion clears their custom values. Location, task, and custom record deletion keeps values, as in Grocy. Deleting a custom record type also keeps its records and field definitions. The old namespace becomes invalid until a type with that name exists again. Imports retain native orphan field IDs. See [revision 0018](migration.md#project-schema-upgrades) for legacy name-keyed data.

Chore merging requires `MASTER_DATA_EDIT`. An administrator can replace their own permissions and remove their own administrator access. The next request uses those permissions, as in Grocy 4.5.0.

Chore execution filters input before its permission check. Missing chore execution and undo permissions return 400. User permission reads and writes return 403. Their caught errors include the upstream permission name in `error_message`. Task and battery permissions run before input checks.

Request filtering uses the pinned Grocy HTML, CSS, URI, and entity settings. PHP parses the original JSON bytes. Top-level scalar values pass through HTMLPurifier; booleans and arrays remain intact. Empty optional numeric and date values use the handler defaults. Filtered routes require the exact `application/json` content type. The backend keeps the upstream rules for null bodies, PHP array keys, and large numeric exponents. Empty database text is read as null, as in PDO.

A file upload cannot replace an existing file. Reads use the inline disposition and upstream cache duration. Only `force_serve_as=picture` enables image processing. PHP GD keeps the native image format and encoded bytes. Native image errors and cache names follow Grocy, including the height-only error. Native uploads omit a chunk whose complete content is the single byte `0`. Range headers do not change the complete response. List filters support SQLite wildcards, ASCII case matching, text values with leading zeros, and upstream null rules. The query parser also copies ignored operators and value truncation. Invalid generic object queries return the upstream status 500.

Stock label modes follow the Grocy 4.5.0 runtime: 0 for no label, 1 for one label, and 2 for one label per whole unit. The pinned OpenAPI file lists 1, 2, and 3. The runtime values take precedence for compatibility. Per-unit bookings share a transaction ID. As in PHP, mode 2 omits a fractional remainder. Stock counts accept a purchase date. They count the product across all locations and use the last price and store when these values are omitted.

Purchase labels use the new entry before stock entries combine. Automatic open, freeze, and thaw labels use the old entry and the new due date. Printer failures preserve the same prior stock changes as Grocy. Label requests support JSON and form encoding. Form requests omit database row fields, as PHP does. `GROCY_LABEL_PRINTER_PARAMS` supplies extra label values and defaults to the upstream font. The calculated due date takes precedence over these values. Set `GROCY_LABEL_PRINTER_HOOK_JSON=false` for form requests. Set `GROCY_LABEL_PRINTER_RUN_SERVER=false` to return label data without server printing.

Missing label records retain the upstream status rules. A missing stock entry returns 500. Missing products, chores, and batteries return 400. A missing recipe can return 200 with null label data.

Calendar subscription keys grant calendar access only. Revoke a subscription key through API key management. Server configuration responses omit API keys and the database URL.

Transfer undo follows Grocy 4.5.0. If the original source entry no longer exists, undo creates an entry at the current default location. It leaves the store empty and uses the default closed state. Consumption undo creates a separate entry and leaves the store empty.

Equivalent purchases combine into one stock entry. Entries with per-unit labels or nonempty stock custom fields remain separate. Purchase undo deletes all stock with that booking's stock ID. Thus, undo of one combined purchase can remove the stock from another purchase. This behavior matches Grocy 4.5.0. Open undo can leave a closed split entry with a separate stock ID.

Stock custom field writes use the purchase, inventory, or entry edit transaction ID. Reads use the stock ID. Generic stock reads include these values. Stock unit changes require a conversion after the first stock booking. They convert current stock, history, related amounts, prices, quick amounts, tare weight, and calories. Existing databases receive missing inverse conversions on upgrade.

Meal plan writes maintain day, week, and individual meal recipes. Startup restores missing or changed contents for existing project databases. Matching contents keep their IDs and timestamps. Consumption of an individual meal recipe uses the output product and servings from its source meal. Recipe fulfillment includes the pinned cost, calorie, price completeness, and product name fields. Normal ingredient amounts use stock units. The `/api/v2/recipes` input converts supplied units before storage. Recipe copy uses Grocy's name and serving defaults.

Shopping writes keep the requested unit, or use the purchase unit. Minimum stock settings can add missing items after product changes, consumption, or opening. Shopping removal uses the configured decimal threshold and the first matching product entry across lists, as in Grocy 4.5.0.

New users receive `GROCY_DEFAULT_PERMISSIONS`, whose default is `["ADMIN"]`. An empty password update keeps the stored password. User writes and permission reads apply the operation-specific permission checks.

Null and `"0"` password updates also keep the stored password. The current-user response is an array. User fields keep null values, and permission responses include row IDs. Authentication accepts the API key query parameter, including fallback from an invalid header key. Many compatibility reads require authentication only, as in Grocy. User reads, external barcode lookup, and writes retain their specific permission checks. MCP and v2 keep their application access rules.

Chore consumption uses the gross tare amount. Chore tracking saves its log before stock consumption, so a failed stock booking leaves that execution in the log. Assignment reads use the stored assignee until assignment calculation runs. Equal least-done counts use user ID order. Child stock opening copies PHP's repeated conversion of the remaining amount. This can open more stock than requested.

Feature flag environment values follow the upstream string and boolean rules. Only `true` and `false` become booleans. `0` stays a false string; `off` stays a true string. Flags control calendar groups, freeze and thaw dates, label due dates, and default location creation. They do not disable API routes. Explicit printer flags and `GROCY_LABEL_PRINTER_RUN_SERVER` control server printing. Existing Grocy Next printer settings still enable their printer flag when that flag is not set explicitly.

The audit still needs more input coercion, validation, and combined error cases. Python date types do not support year 0000, which PHP accepts. Generic object date inputs need more checks. Encoded image bytes can differ between Pillow and PHP GD. Printer error text differs from Guzzle. ID gaps from rejected or repeated writes and internal write order need more checks. Generic nested writes, field definition defaults, and more response edge cases need checks. These gaps remain outside the verified behavior.

See [the backend parity audit](backend-parity-audit.md) for the repair scope and verification results.

To check a disposable running backend with the shared workflow tests, set
`GROCY_BACKEND_URL`, `GROCY_BACKEND_API_KEY`, and `GROCY_BACKEND_DISPOSABLE=1`.
Select the `local` cases. The database must be disposable because these cases write data.

Generic reads preserve saved BLOB values through the PHP protocol. Valid UTF-8 becomes JSON text.
Invalid UTF-8 and nonfinite numbers cause the native PHP JSON serialization error. Uncaught native
errors include message, stack, file, and line fields. Paths and outer stack frames depend on deployment.
Caught field errors keep their separate native 400 response. Earlier field writes remain committed.

No database migration is needed for this runtime repair. The pinned source files retain their original
release bytes and license. Git attributes prevent line-ending changes in that package.
