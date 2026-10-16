# Backend parity audit

Audit date: 2026-10-16. Baseline: Grocy 4.5.0, commit `21aa5eab218c8466f90729154cb293fffbe10c21`.

The backend has routes for all 86 contract operations. The audit found missing state changes despite that route coverage. The repairs below address those findings. Full behavior parity for every client and input is not established by these checks.

## Catalog and database rules

Stock unit changes now require a conversion after a product has stock history. They convert current stock, history, recipe, shopping, chore, and meal quantities. They also convert prices, quick amounts, tare weight, and calories. Undo reads the converted quantities and prices from the stock log. Conversion writes maintain inverse records. Upgrades add missing inverse records.

Product deletion removes linked stock, history, barcodes, conversions, recipe ingredients, shopping items, and product meal entries. It clears recipe output references and removes custom values. Chore, battery, shopping list, and recipe deletion also removes their linked core records. Custom value cleanup follows its separate native rules.

Generic ingredient, barcode, and shopping writes apply the Grocy unit defaults. Shopping items and ingredients accept zero amounts. Product writes use the upstream opened-stock default and parent rules. The generic API blocks API key reads and writes. It permits key deletion under the application permission checks.

All 33 modeled native tables now use SQLite `AUTOINCREMENT`, as in the pinned Grocy database. Revision 0014 adds the remaining 31 counters. Catalog, stock, and history IDs no longer reuse deleted IDs. The comparison cases check the exact next ID, including the additional ID for an inverse unit conversion. The four nutrition extension tables keep their existing rules.

Imports retain all 33 source counters, including counters above every remaining row ID. The project upgrade preserves a complete saved data set, custom views, indexes, cross-table triggers, foreign keys, and unnamed check constraints. A failed table copy restores the original schema and data. A legacy table without a saved counter starts from its highest remaining ID. Its lost allocation history cannot be recovered from that table.

The modeled schema now includes all 27 native `CHECK` expressions across 16 tables. Revision 0015 adds missing expressions to existing project tables. This covers the native boolean fields, product due and purchase price types, and the positive chore interval. Checked fields use SQLite integer affinity instead of the previous Python integer parser. Task completion now accepts numeric strings such as `"1e0"`, `" 1 "`, and `"0.0"`. Invalid text and nonintegral boolean values fail the native check.

Generic create and update database errors return 400 with the native SQLite error message. A rejected update preserves the full saved record. Creation returns only the string `created_object_id`, as in Grocy. The frontend response type and local callers use that field. This does not establish parity for other generic validation, defaults, or reference rules.

Generic names now accept empty text and preserve spaces. Empty text reads as null, as in PDO. An empty object body returns ID `"0"` and inserts no row. A nonempty body that omits a required name returns the native database error. Meal section names are unique. The required section has ID -1, an empty name, and sort number -1. Its native delete guard returns 500.

Revision 0016 removes 36 extra database foreign keys across 15 modeled native tables. The ORM keeps its reference metadata through conditional DDL. The native tables can retain unknown parent IDs. Nutrition and custom foreign keys remain active. Imports also retain native dangling references.

Nine unmodified native triggers keep the separate barcode and ingredient insert rules, unit defaults, conversion duplicate errors, and the internal section delete guard. Some updates can keep references that an insert rejects. Recipe ingredient units become nullable so their native default trigger can run. A shopping item for a missing product keeps a null unit when no unit was supplied.

Equipment names, shopping list names, and recipe nesting pairs now have their native unique keys. Duplicate creates and updates return 400 with the native error message. A failed update keeps all fields in the saved row. Failed writes do not consume an ID. Case variants and spaces use SQLite's native comparison rules. Shopping lists no longer receive an application name default when a nonempty request omits the name.

Revision 0017 adds missing unique indexes without copying tables. It retains existing unique keys and full unique indexes with matching key columns. It preserves all rows, counters, custom constraints, views, and triggers. Existing duplicate records make the upgrade fail. The transaction also removes indexes created earlier in that failed upgrade.

Custom values now use stable field IDs and text object keys. Renames and entity changes keep their values. Keys `1` and `01` remain distinct. The field API validates the entity without requiring a parent record. Each field write commits before the next field. A later invalid field therefore keeps earlier writes, as in Grocy.

Four unmodified native triggers handle empty values, stock transaction mapping, and field deletion. Empty writes remove the record but keep its allocation history. The native deletion trigger only removes a value when its object key equals the deleted field ID. Other values remain under the old field ID and do not attach to a replacement definition. Product, chore, and battery deletion clears their custom values. Location, task, and custom record deletion keeps values. Custom record type deletion keeps records and definitions, as in Grocy.

Revision 0018 maps known legacy names to definition IDs. Unmatched names keep their values under reserved negative IDs, with their old labels retained as metadata. The upgrade cannot infer identity already lost by the former name-based storage. It preserves meaningful values, IDs, timestamps, counters, custom views, indexes, and triggers. Null and empty legacy records become absent values. Original Grocy imports keep orphan field IDs and text object keys.

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

Meal writes maintain day, week, and individual meal recipes. Startup restores missing or changed contents in existing project databases. Matching contents keep their row IDs and timestamps. An individual meal recipe produces the output product and serving quantity from its source meal.

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

Permission writes now use the pinned Slim body parser and LessQL query builder. A single permission write applies the Grocy input filter. Replacement writes use the unfiltered parser, including JSON media type suffixes, form data, and XML. The frontend sends the native `permissions` field.

Replacement deletes the old rows before the batch insert. Duplicate or null values can make that insert fail and leave no permissions. Missing, null, or scalar replacement values and unparsed bodies also clear the rows. An object in `permissions` supplies its values as the replacement list. Unknown permission IDs and user IDs without a user row stay saved. SQLite keeps native numeric and text types. Reads use its permission index order.

The native query builder also keeps PHP float formatting, PDO quoting, embedded null handling, and nested relation errors. A query callback captures SQL before the private memory database can execute it. The Python backend runs that statement against its own database. Caught SQLite errors use the upstream error text and status 400. Nested replacement arrays can return 500 after the delete.

Revision 0013 gives saved permission rows the Grocy allocation counter. Replacements keep input order for new row IDs, and later writes do not reuse deleted row IDs. Startup upgrades preserve custom views, indexes, and triggers. Imports keep the source counter, including values above all remaining row IDs.

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

Before the final empty-BLOB fetch repair, the full local run passed 608 tests and skipped 531 cases that need the reference server or another feature profile. The default comparison suite passed 1,028 cases and skipped the disabled-flag case in both UTC and Europe/Bucharest. The disabled-flag profile passed both cases in both zones. The final 67-case native read comparison passed. Ruff, basedpyright, and PHP syntax checks passed.

The 51 new input cases also passed through HTTP against the built Docker image with PHP 8.4.26. The local reference checks used PHP 8.3.31. The current built wheel contains all 437 vendor files with their original checksums and all three worker files. Two local checks cover worker failure, recovery, shutdown, and startup without PHP. User deletion checks cover both startup and CLI upgrades from the saved revision 0011 schema, import of deleted-user records, and restart after last-user deletion. Six permission workflows also passed through HTTP in Docker. The three user deletion cases and a last-user restart check also passed in Docker.

The 45 permission write cases passed on both backends. Before the repair, 38 local cases failed and all 45 reference cases passed. Separate upgrade and import checks also failed before the counter repair. Docker passed those 45 cases and the 51 input cases through HTTP, for 96 passes with PHP 8.4.26. The source comparisons used PHP 8.3.31. Ruff, basedpyright, and the frontend build passed after the repair.

The 26 new allocation cases passed on both backends, for 52 passes. Before the repair, all 26 local cases failed and all 26 Grocy cases passed. The import check also found 31 missing counters. The saved-data restart check found that startup changed valid meal-plan row IDs and timestamps. Both defects are repaired. Three storage checks now cover all-counter imports, upgrade and restart preservation, and rollback after a failed copy.

The new Linux Docker image upgraded a saved revision 0013 database to 0014. All saved rows remained equal, all 33 native counters were present, and SQLite integrity and reference checks passed. The image then passed the 26 new API cases through HTTP. A restart kept every stored row and allocation counter unchanged, including meal-plan IDs and timestamps.

The 31 new generic constraint and response cases passed on both backends, for 62 passes. Before the repair, 30 local cases failed and all 31 native cases passed. Two extended storage cases also failed on the previous commit. Four storage cases now cover imports, a complete saved-data upgrade, and failed upgrades from revisions 0013 and 0014. The upgrade retains a task counter of 9000 and allocates the next task as 9001. Direct database writes confirm that native checks remain active after the copy, including checks on read-only API tables.

The revision 0015 Linux image upgraded the saved revision 0013 database. Every stored row stayed equal. All 33 native counters and 27 native checks were present. Integrity and reference checks passed. The image passed the 31 new API cases and the previous 26 allocation cases through HTTP. Restart kept all rows and counters unchanged. A separate startup with an invalid task failed the upgrade and kept the original revision 0013 schema, rows, counters, views, and triggers.

The 48 new name, reference, default, and delete cases passed on both backends, for 96 passes. All 48 local cases failed on the previous commit. Three extended storage cases also failed there. Five storage cases now cover imports, the saved-data upgrade, and failed copies from revisions 0013, 0014, and 0015. A separate import check retains unknown product and location IDs. The upgrade check permits direct writes through all 36 former native foreign keys while retaining a custom task location constraint and the nutrition constraints.

The new Linux image upgraded revision 0013 to 0016. It kept every saved row and added the required native section. All 33 counters and 27 checks remained present. It passed 104 HTTP cases and kept all rows and counters unchanged after restart. The legacy fixture's custom equipment check still rejects an empty name. A fresh container passed all 48 new native API cases, including empty equipment names. A failed startup with duplicate legacy section names restored the full original revision 0015 database.

The five new uniqueness cases passed on both backends, for ten passes. Before the repair, all five local cases failed and all five native cases passed. Two extended storage cases also failed on the previous commit. The saved-data upgrade now checks all three unique keys through direct database writes. A failed index creation from revision 0016 restores the full original schema, rows, counters, and revision.

The revision 0017 Linux image kept all saved rows during upgrade and retained the required native section. It passed 108 HTTP cases on the legacy database and 53 on a fresh database. Restart kept all rows and counters unchanged. A startup upgrade with duplicate recipe nesting pairs failed and restored the original revision 0016 schema, rows, counters, views, and triggers. This includes rollback of unique indexes created before the failing index.

The 14 new field lifecycle cases passed on both backends, for 28 passes. Before the repair, 13 local cases failed and all 14 native cases passed. Three new storage cases and the extended native orphan import check also failed on the previous commit. Storage checks now cover the native narrow deletion rule, empty-write allocation, legacy identity mapping, a counter of 4000, timestamps, custom SQL, and full rollback after a rejected text-key conversion. The wider saved graph test uses native value identity for current API setup. The separate revision 0017 fixture covers legacy name-based values.

The revision 0018 Linux image upgraded a saved revision 0017 database. It retained meaningful values, orphan metadata, timestamps, counters, custom views, and triggers, and cleared empty records. All 14 new API cases passed over HTTP. Restart kept all stored rows and counters unchanged. A fresh Linux database passed those cases and the existing stock compaction case, for 15 passes. A failed copy restored the full original revision 0017 schema and data, including empty records.

The seven new field response cases passed on both backends, for 14 passes. Six local cases failed on the previous commit. All seven native cases passed there. The cases check numeric field names, PHP key types, case-insensitive name order, exact definition namespaces, generic empty response types, namespace value collisions, and numeric object comparisons in lists. The new Linux image passed these cases and the existing stock compaction case over HTTP, for eight passes. Browser checks confirmed edit, create, and retry after a failed field save. Stored rows kept both entity groups and contained one new record after the retry.

The 38 new generic URL and entity guard cases passed on both backends, for 76 passes. Before the repair, 33 local cases failed and all 38 native cases passed. The cases cover text ID forms on locations, products, and recipes, distinct field keys, updates, deletes, missing IDs, large numbers, calculated view IDs, permission IDs, and entity guards. The first full run found five changed label responses. The repair now retains the domain not-found error type. All 61 focused lookup and missing-record cases then passed. The rebuilt Linux image passed the 38 new cases and the previous seven field response cases over HTTP, for 45 passes. No schema upgrade was required.

The native SQL check found 102 default or nullability differences across 32 native tables. Revision 0019 and fresh metadata now use the pinned rules for all 289 modeled native columns. Two required extension columns also receive their existing application defaults at the database level. This lets native SQL omit those extension fields. Null timestamp serialization and meal-plan zero amounts now follow the native values.

All 11 new storage cases failed on the previous commit and pass after the repair. They cover direct SQL defaults, null timestamp API reads, saved rows, a counter of 9000, an absent empty-table counter, custom SQL, and complete rollback after a rejected copy. Separate checks compared every native column rule on fresh and upgraded databases. All rows and counters in the saved revision 0018 database remained equal. The initial wider run found a zero-amount validator and non-null timestamp assumptions. Those errors are repaired. The 35 focused storage, import, and meal-plan cases passed.

The revision 0019 Linux image passed 68 HTTP cases on both fresh and saved databases. Both databases matched all 289 native column rules. Direct SQL defaults and null timestamp reads passed. Restart kept every row and counter unchanged. An invalid legacy meal section made startup fail and restored the full original revision 0018 database, including custom views, indexes, triggers, and counters.

Native storage checks found 15 affinity differences across nine tables. For example, a conversion factor stored as `NUMERIC` could make `1 / factor` use integer division. Revision 0020 uses the native storage declarations while retaining application Decimal codecs. Date-only and full chore log times use native `DATETIME` affinity. Fresh and saved databases now match native storage affinity, defaults, and nullability for all 289 modeled native columns.

All nine new storage cases failed on the previous commit and pass after the repair. They check fractional SQL results, saved fractional values in `INTEGER` columns, date-only values, timestamps, nulls, empty text, a counter of 9000, and custom SQL. Two rejected copies check numeric precision loss and a custom integer storage constraint. Both restore the complete original database. The copy uses SQLite assignment without SQL casts. The wider checks also found numeric expression construction and legacy date-copy errors. Both are repaired.

The revision 0020 Linux image passed 70 HTTP cases on both fresh and saved databases. Both matched all 289 native storage, default, and null rules. Native fractional arithmetic passed. Restart kept all saved values and counters equal. Both rejected copy modes restored the original revision 0019 schema, values, counters, views, indexes, and triggers.

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

The remaining audit must cover more input coercion, validation, and combined error cases. Some domain date types do not support year 0000, which PHP accepts. Generic object date inputs also need more checks. Native file processing now uses PHP GD; the versioned extension keeps Pillow. Printer error text uses the local HTTP library and differs from Guzzle. More nested relationships, scalar and binary inputs, ID gaps from complex failed writes, combined permission errors, response edge cases, and further partial failures still need checks. These gaps prevent a claim of full runtime parity.

Field response types and namespace selection now follow the native API. A field named `0` can return `["Saved"]`. Sequential numeric names produce an array only when their PHP key order permits it. Sparse keys remain an object. The native loose comparison can give fields `0` and `00` the same value. Generic lists also use loose object-key comparisons. Their reads can differ from direct field reads for a key with a leading zero.

Custom record definitions now use the exact requested entity. Generic reads omit namespace definitions. They retain the native resolved value aliases, including the case where a namespace value hides a direct value with the same name. Empty field sets return an array on the field endpoint, null on a generic single record, and no field property in a generic list. The existing PHP worker assembles these responses. SQL supplies the native sort and value order. No schema upgrade is required.

The web editor reads namespace values through the field endpoint. It sends each entity's fields in a separate request. Form keys include the entity name, so equal names in different entities remain separate inputs. A retry after a field request fails updates the previously created record. The browser check confirmed both field groups in stored data and no duplicate record after retry.

Generic object IDs now reach SQLite as URL text. Numeric exponent, decimal, sign, space, and leading-zero forms follow the native stored column's affinity. Single record field reads retain the original URL key. Reads return 404 when the stored ID does not match. Updates and deletes return 400. These errors omit the application error code, as in Grocy. The domain still uses its not-found error type, so the separate label error and empty-label rules remain active.

Single calculated view reads now use a SQL predicate instead of a Python scan. The dummy `1` expression in three stock views has no integer column affinity. Those views can list rows with ID 1 while a single record request returns 404. The permission hierarchy uses its native integer comparison rule. Unknown entities, blocked reads, and blocked writes return the native operation-specific errors.

Generic writes now use the unmodified pinned LessQL library through the existing PHP worker. A resumable protocol sends its actual statements to the application SQLite connection. Each successful write commits separately. Native triggers handle defaults, validation, inverse conversions, caches, cascades, and internal meal recipes. The former Python copies of these effects are removed.

Revision 0021 installs all 45 native views and all 54 native triggers in their original order. It adds the conversion cache, permission hierarchy, sessions, and migrations tables. It fills new cache and permission records. Missing legacy internal meal recipes are repaired once during upgrade. Normal startup keeps the saved graph unchanged. Existing revision 0020 core rows and counters remain equal.

A private PDO schema checks each statement before execution. This prevents local extension columns and tables from changing native write errors. Generic reads return native columns directly. They retain raw timestamp text and numeric values. The API accepts explicit primary keys and key changes. Native database rules now supply omitted values. The product editor sends purchase factors through the conversion API. It uses the separate field endpoint for custom values.

A location write with `userfields` fails on `userfields_id`. An empty `locationsList` saves the parent. A nonempty list can save the parent before a child fails on `locations_id`. A nested shopping graph saves its parent links and returns the last child ID. The 24 new API cases check those rules, partial saves, omitted defaults, negative native values, explicit keys, and raw timestamps. All 24 cases failed on the previous commit. The native-logic rollback test also failed there.

The first full run exposed stored fractional seconds hidden by the former response serializer. Household writes now store whole seconds. Generic date fields retain SQLite's native values. Old stored timestamp text is not rewritten. A review also removed needless undo snapshot updates, which could have fired price-cache triggers twice. Undo already reads converted amounts and prices from the stock log.

The three uniqueness differences from the previous audit are repaired. Duplicate barcode checks also return 400 in both backends.

The revision 0021 Linux image passed 107 HTTP cases on each of two databases, one new and one upgraded from revision 0020. All 45 source views and 54 source triggers matched the pinned definitions. Trigger creation order matched. The upgrade kept all original core rows and allocation counters. Restart kept the complete stored state. A custom view with a native table name made startup fail and restored the full saved database. The first rollback probe copied an incomplete SQLite main file. A complete, closed database copy confirmed rollback.

The browser check created a product with 12 stock units per purchase unit. An edit changed the factor to 15. Both native conversions changed correctly, and the form read the saved factor. No request sent the old product extension column. CLI initialization now runs the same migrations as server startup. Its checks cover direct SQL recipe defaults and native API writes with startup migrations disabled.

A further import check found that Python date parsing rejected a native year 0000 timestamp. Imported timestamps now bypass the runtime codec. The extended import case retains both that value and fractional seconds exactly. The 22 focused import, identity, initialization, and upgrade checks passed. This does not establish year 0000 support in every domain operation.

All 110 checks outside the differential suite passed after the final initialization, import, and custom trigger repairs. Replacing a native view now keeps custom triggers on that view. The extended saved-graph test executes the retained trigger after upgrade. It failed before that repair. The final Linux image also passed this trigger check, direct SQL and API writes after CLI initialization, and exact timestamp imports. Its image ID is `sha256:f6421a49641e766140d8cef951355d761269e1a0db73fec2cc4821f5efffa4f7`.

Generic object reads now execute the pinned `GenericEntityApiController` and `BaseApiController` code. Custom field reads and writes execute the pinned `UserfieldsService`. The source includes its required base classes, helper functions, original OpenAPI file, and license. All eight added files match the release archive byte for byte. All 445 managed vendor file checksums match. Git attributes retain the original source whitespace and line endings.

The native controller parses the raw query string through Slim and PHP. This fixes array parameters, numeric limit conversion, negative offsets, extra order components, invalid order errors, and SQL field errors. For example, `limit=bad` becomes zero, `limit=1.9` becomes one, and `limit=-2` keeps all matching rows. Uncaught query errors include the native diagnostic fields. Their file paths and outer stack frames reflect the packaged runtime.

The main PHP worker sends its actual SQL to the application connection. A second PHP worker evaluates `mb_ereg` and `ceil` callbacks. Nulls, invalid patterns, long patterns, and stored BLOB inputs now follow the native regular expression rules. Fault checks terminate each worker, verify recovery, and check that shutdown leaves no worker running.

Native field writes now use LessQL directly. A structured value fails on `value_id`. Earlier fields stay committed, and an existing value stays unchanged. The six new cases check insert and update errors for empty arrays, object values, and nonempty arrays. The first full reference run exposed a fixture assumption about unrelated field definitions. The corrected test checks its own three values. Both full reference runs then passed.

Generic and field read responses retain PHP JSON bytes, status, and headers. The protocol carries BLOB and nonfinite values without a Python JSON conversion failure. A valid UTF-8 BLOB remains text. An invalid UTF-8 BLOB or infinite numeric value reaches the native PHP serialization error. The final byte check also found the backend table's different column order. The adapter now uses the pinned cursor column order. This case failed before that repair.

Twenty-eight local cases failed on the previous commit. Eleven existing or accepted cases passed there. The repaired batch adds 29 public cases, with both implementations as targets. The final Linux image passed 144 HTTP cases on each of a fresh database and a saved revision 0020 database. Two BLOB cases require direct database access and were checked separately inside Linux. Those checks passed, as did CLI initialization, import, custom view trigger preservation, restart, and failed-upgrade rollback. All original saved rows and counters remained equal. The image is `sha256:2ad667aab459afc532a36ab5628d81e89b0bc2b1afbd624b9de7831d7cdfc21d`.

This batch needs no new database revision. Other filtered list endpoints still use the Python filter. Input parsing outside the native read controller, more structured inputs, remaining domain date limits, image bytes, printer errors, and combined permission errors still require work. The full parity goal remains open.

Generic object and custom field writes now pass raw bodies to the unchanged native `BaseApiController`. Slim parses the JSON. Grocy filters its top-level values once. Nested values stay in PHP until LessQL compiles their SQL. The body no longer passes through a Python dictionary or a second JSON conversion.

Invalid JSON now returns the full native error text without an application error code. Invalid Content-Type errors include the native diagnostic fields. Entity checks run before body parsing. Authentication and permission checks still run first. The pinned Slim `HttpException` class and license are included unchanged. All 447 managed vendor checksums match. The built wheel also retains those files and all three PHP adapters exactly.

A nested infinite number no longer causes a transport error with status 503. Native LessQL and database triggers determine the result. A nested shopping amount becomes zero. A nested location row fails on `locations_id` after its parent is saved. A structured custom value fails on `value_id` after earlier fields are saved. The extended public cases check those results for creation and update. They also check recovery after invalid JSON.

The previous backend failed 35 of the selected cases. All 72 PHP reference cases passed before the repair. After the repair, all 144 selected comparison cases passed. The Linux image passed 73 HTTP cases on each of a fresh database and a saved revision 0020 database. Those cases include deletion of the full combined stock entry when one purchase is undone. The upgrade retained all original rows and allocation counters. Restart retained the complete state. A rejected upgrade restored the full saved database. The image is `sha256:6e4a8871e9b50ed2155beb7ac2d9a278f1a70ffa9bc5f053ff2ae3145ac33ece`.

This batch needs no database revision. Parsing in other write handlers, the Python filters on other list endpoints, domain date limits, image bytes, printer errors, and combined permission errors still require work. Full runtime parity is not yet established.

All eight formerly filtered list handlers now use native SQL results. Five original controllers and six read services are included unchanged. The user list uses the original users service and base filter, with its original exception boundary. Python checks its permission before that call. The former Python filter and three unused domain read methods are removed.

Tasks, chores, batteries, users, recipe fulfillment, product stock entries, product locations, and location stock entries now use Slim's raw query parsing. Numeric limits, offsets, array parameters, field errors, sort errors, and native JSON bytes follow Grocy. The current task list ignores `include_done`, as in Grocy. Stock list IDs retain PHP's numeric conversion or SQLite's column affinity. Subproduct flags use PHP's boolean conversion. Native read responses include the three source CORS headers, including uncaught read errors.

Task lists retain year 0000 and fractional timestamp text. An unfiltered task list also retains its native user and category records. The previous backend failed all 30 initial list cases. A further saved-date case failed with `ValueError: year 0 is out of range`. The source recipe view uses `recipe_id` as its record key; the first test setup was corrected to use that key.

The first full Bucharest run exposed a stock selection error after midnight. Grocy uses SQLite's UTC day for due and expiry selection. The Python code used the local day. Stock overview and volatile stock now run the original stock controller and database service. The SQL bridge keeps the source service's raw query calls and grouped object fetch mode. Shared shopping selection now uses the same SQL date predicates. Numeric day parameters also retain native conversion, including `0` selecting the default five-day range.

Both new stock selection cases failed on the previous code. The expanded 67-case comparison passed in Europe/Bucharest, including the existing parent-stock case. Four upgrade checks passed after their old-schema setup read stored user IDs directly. That setup runs before the native user DTO view exists. The upgrade assertions remain in place.

An existing corruption test left an infinite stock minimum in the shared reference database. A later stock overview then returned the native serialization error in both implementations. The corruption case now deletes its own product after checking the error. The six-case shared-state check passed. The Linux image passed 60 HTTP cases on each of a fresh database and a saved revision 0020 database. All original saved rows and allocation counters remained equal. Restart retained the full state. A rejected upgrade restored the saved database. The image is `sha256:a4cbf73988fedadda0d0e2d86b9087bb1bbd153d8b67d05b984a73f3e0c57fcc`.

All 459 managed vendor checksums match. All 20 Grocy core files retain the release bytes. The built wheel retains those vendor files and all four PHP adapters. Ruff, basedpyright, and PHP syntax checks passed. This batch needs no database revision.

A separate disposable experiment ran the complete pinned PHP API on a copy of the project database. It created records, combined two purchases, and deleted the full combined entry on undo. It needed native migration records and a native valid key expiry. Its generic product response exposed the local purchase-factor column. Direct use of that runtime still needs a boundary for project storage extensions. This experiment does not replace the current API implementation.

An empty saved BLOB now reads as null, matching native PDO. The nullable conversion runs after a SQL fetch. Function arguments retain their raw values. The extended saved-BLOB case checks both the null response and its regular expression match. Before the repair, that case failed on the backend and passed on Grocy. The five existing controls passed. After the repair, 120 focused comparison cases passed in each time zone. The final Linux image passed the empty-BLOB, UTF-8 BLOB, invalid BLOB, regular expression, CLI initialization, import, saved trigger, and package checksum checks. The final wheel retains all 459 vendor checksums and all four adapter files. That image is `sha256:4447b68e57d48bbe240821bc18e74875ae57a693642dba651987187be0e7353a`.

Other write parsing, domain dates, printer errors, and combined permission cases still require work. Full runtime parity remains incomplete.

## Native files and image bytes

File requests now execute the unchanged Grocy 4.5.0 `FilesApiController` and `FilesService`. The pinned Gumlet PHP Image Resize 2.0.4 code uses PHP GD. The adapter selects the configured storage root and supplies request and response streams. Each request owns its PHP process. Completed responses, client disconnects, and application shutdown release that process.

The native endpoint retains Base64 file names, the five native groups, name validation, error details, MIME detection, CORS headers, inline disposition, and cache duration. It also retains the native single-byte `0` upload chunk behavior and image parameter errors. Generated cache files can be read by their native names. Deleting an original image removes its cached sizes. HEAD sends no body. Range requests return the complete file.

The versioned file extension keeps plain names, bounded uploads, and Pillow processing. Nutrition photos use `/api/v2/files`. Equipment uploads use the native `equipmentmanuals` group. Downloads can also read old saved manuals through the versioned `equipment` group.

Before the repair, 24 of the 25 new local workflow cases failed. The accepted array-width control passed. All four image byte cases also failed. After the repair, all 50 workflow comparisons passed. PNG, JPEG, GIF, and WebP bytes matched the PHP reference for original-size processing and two resize forms. A separate public stream check passed with a large binary file, a client disconnect, a later successful read, an invalid image, deletion, and application shutdown. All recorded PHP processes stopped.

The full local suite passed 635 tests and skipped 561 cases that need a reference server or another feature profile. The full comparison suite passed 1,084 tests and skipped one disabled-feature case in each of UTC and Europe/Bucharest. The disabled-feature profile passed both cases in each zone. Ruff, basedpyright, and the frontend build passed.

The Linux image passed 69 HTTP cases on each of a new database and a saved revision 0020 database. These include file workflows, native list reads, and combined-purchase undo. All 45 source views and 54 source triggers retained their definitions and creation order. The upgrade retained every original core row and allocation counter. Restart retained the complete saved state. A rejected upgrade restored the full original database. CLI initialization, import, saved custom triggers, BLOB reads, and all 466 vendor checksums passed in Linux.

The final image is `sha256:4d8cf9e5b0c960f7c0e8f10c5542aaea883df8d03fb35777e45f580fb0612139`. The wheel retains all 466 vendor files, all 22 Grocy core files from the release archive, and all five PHP adapter files. PHP syntax checks passed. Separate route declarations remove duplicate API operation IDs. The final route and file selection passed 31 tests and skipped 25 reference-only cases. Browser checks confirmed native manual upload, saved file bytes, native manual download, and download from the old equipment group without an error.

This batch needs no database revision. Other write parsing, domain dates, printer errors, and combined permission cases still require work. Full runtime parity remains incomplete.

## Native task and battery actions

Task completion and undo, battery charging and undo, and battery details now execute the original Grocy controllers and services. Requests retain their raw JSON and Content-Type header. Native PHP handles date validation, numeric ID conversion, errors, and response bytes. A date in year 0000 remains in storage and in the battery details response.

The original `User` class checks permissions through the application connection. Each action owns a PHP process with its authenticated user ID as Grocy's current-user constant. Authentication still selects the application API key. The native controller decides when to check permissions and which errors to catch. The action process stops before the request returns. PHP workers use `TZ` when it is set, so fallback timestamps use the same server time zone as Python.

All 21 new cases passed on Grocy before the repair. Nineteen failed on the former backend. The cases cover malformed JSON, null bodies, exact Content-Type rules, nested time values, numeric ID forms, undo state, year 0000, battery details, and ignored battery fields. The existing restricted-user workflow now also checks native permission messages, diagnostic fields, and CORS headers. The worker lifecycle case checks that a completed task action leaves no child process running.

The first focused run passed 110 comparisons. The extended action and permission checks passed 44 comparisons in Europe/Bucharest. Ruff and basedpyright passed.

The first Linux HTTP run found that battery undo retained a temporary `null` response body after setting status 204. Grocy's HTTP emitter suppresses that body. The adapter now applies the same rule for statuses 204, 205, and 304. The action ID case checks an empty undo body and then reads the saved undone record through the same connection. The final Linux image passed all 56 selected HTTP cases on both a new database and a saved revision 0020 database. All original core rows and allocation counters remained equal. Restart retained the complete state. All 45 source views and 54 source triggers retained their definitions and order.

The local suite also found that PHP used UTC when `TZ` was absent on a machine with another system time zone. The worker now uses the existing `server_timezone` function for its PHP configuration. All 34 local time and worker checks passed after this repair. Before the final worker argument change, the full comparison suite passed 1,126 tests and skipped one disabled-feature case in each time zone. The final Europe/Bucharest action selection then passed 110 comparisons. The disabled-feature profile passed both cases in each zone.

The final Linux image is `sha256:d3b7d9d589ae642b820ccab7730db5a9b9d6a4fe0342e99abeb706b67c150191`. It passed native user context, year 0000, empty undo response, process cleanup, CLI initialization, import, saved custom trigger, BLOB, and all 469 vendor checksum checks. The wheel retains those files, all 24 Grocy core files from the release archive, all six PHP adapter files, and the final Python worker arguments. Git also retains the original vendor bytes. PHP syntax checks passed.

The local full run passed 655 tests and skipped 582 reference or feature-profile cases. Its one failure came from the revision 0013 test setup, which called the current battery handler before installing native permission views. That fixture now stores the old charge record directly. After the upgrade, the current API reads its exact saved timestamp and charge count. All six allocation and upgrade cases passed after this fixture repair. The complete integration and unit selection then passed all 111 tests.

This batch needs no database revision. Other household, stock, recipe, and user writes, other domain dates, printer errors, and further combined permission cases still require work. Full runtime parity remains incomplete.

## Native users, permissions, and settings

All native user, permission, and single-setting routes now execute the unchanged `UsersApiController` and `UsersService`. Each request uses the authenticated user constant and application connection. The adapter supplies configured default permission names and pinned setting defaults. PHP retains request parsing, password hashing, numeric ID conversion, permission checks, exception boundaries, array keys, and write order. The former Python user writes and permission statement compiler are removed.

User names retain spaces and PHP scalar conversion. Missing required fields and invalid field types keep their native errors. Profile edits require the native name fields. An omitted picture clears the saved name. Empty, null, and `0` passwords on an edit preserve the saved hash. New user passwords use PHP's default hash. Self-edit checks use PHP's loose numeric ID comparison. Duplicate names return the native status 400 and SQLite message.

Setting writes retain native LessQL value rules. Array and object values return the native error. Numeric setting keys keep the native distinction between direct reads and the merged settings map. Bulk setting writes and deletion remain available through `/api/v2/user/settings`. The existing due-status case checks bulk writes for two users and deletion of only the acting user's settings. The web user form now supplies an empty password when creating a user without a typed password. Browser checks confirmed creation and a later profile edit without an error.

Before the repair, all 15 initial local user cases failed and all 15 reference cases passed. Five of eight setting cases failed; three accepted controls passed. An isolated copy of the previous commit failed all three self-edit ID cases while Grocy passed them. The stored password check also failed there because the previous hash used scrypt. After the repair, the extended selection passed 167 comparisons in Europe/Bucharest.

The full local suite passed 674 tests and skipped 608 reference or feature-profile cases. The full comparison suite passed 1,170 tests and skipped one disabled-feature case in each of UTC and Europe/Bucharest. The disabled-feature profile passed both cases in each zone. The integration fixtures now use complete native profile requests and explicit empty passwords. Saved revision 0011 and 0012 fixtures store their old users before native permission views exist, then check current API behavior after upgrade. Ruff, basedpyright, and the frontend build passed.

The final Linux image passed 80 HTTP cases on both a new database and a saved revision 0020 database. These include user writes, permissions, self-edit IDs, and combined-purchase undo. The upgrade retained all original core rows and allocation counters. Restart retained complete stored state. All 45 source views and 54 source triggers retained their definitions and order. Separate Linux checks passed for invalid setting update persistence, numeric setting keys, preserved user name spaces, PHP password verification, empty-password edits, worker cleanup, CLI initialization, import, saved custom triggers, and BLOB values.

The final image is `sha256:99563baa04510fd64937d2765c9cc4c56c0967f50c94525cb7318afbc14368f8`. The wheel retains all 470 managed vendor files, all 25 Grocy core files from the release archive, and all six PHP adapter files.

This batch needs no database revision. Other household, stock, and recipe writes, domain date limits, printer errors, and further combined permission cases still require work. Full runtime parity remains incomplete.


## Native chore actions and schedule reads

All chore routes now use the unchanged `ChoresApiController` and `ChoresService`. Details, execution, undo, assignment calculation, and merge retain native request parsing, permission boundaries, numeric conversions, response bytes, and errors. PHP accepts date-only values and year 0000. Its boolean filter keeps invalid skipped values false. Empty user arrays use the current user. Invalid user text returns the original error.

The SQL adapter now forwards raw writes and explicit transactions from the original database service. Chore consumption can write through `stock_next_use`. The private native schema includes the source triggers, which SQLite needs to prepare that view write. Generic object writes still commit separately unless the original service starts a transaction. Merge uses the original transaction to move all execution history and delete the old chore.

The private PDO connection follows the application transaction state. This retains actual PHP runtime errors after implicit SQLite rollback. PHP 8.3 reports the SQLite rollback error. PHP 8.4 reports no active transaction. The checks install disposable ABORT, FAIL, and ROLLBACK triggers. Each failed public merge retains all original rows. Removing the trigger permits a successful retry. A random assignment error also retains the earlier execution log and cleared reschedule date, as in Grocy. Its error text follows the PHP version.

Schedule reads now use the final release view from migration 0185. The previous stored results used migration 0167. That earlier migration still supplies the frequency view. The corrected 15 cases check details, current lists, and calendar output on both backends. Manual schedules return null. Daily schedules keep the saved start clock. Three more API cases check omitted, null, and empty start dates. Native triggers fill those dates with the current clock. The calendar's shared household service now reads the native view instead of a separate Python calculation.

Before the repair, the final 45-case selection failed 33 local cases. All 45 reference cases passed, along with 12 local controls. The corrected schedule and merge failure selection then passed all 42 comparisons. The legacy allocation and user-deletion fixtures now store their old chore logs before the native permission views exist. The import check retains null schedules for legacy null start dates and checks the schedule after a public start-date update. All 97 integration and unit cases passed.

The full local suite passed 705 tests and skipped 653 reference or feature-profile cases. The full comparison suite passed 1,260 tests and skipped one disabled-feature case in each of UTC and Europe/Bucharest.

The Linux image passed 79 selected HTTP cases on both a new database and a saved revision 0020 database. Three direct trigger cases require local database access and are skipped over external HTTP. Separate Linux PHP 8.4 checks passed all three merge failure modes and their retries. The upgrade retained every original core row and allocation counter. Restart retained complete state. All 45 source views and 54 source triggers retained their definitions and order. CLI initialization, import, saved custom triggers, BLOB values, and worker cleanup also passed.

The image is `sha256:5011ac21e8f1f79ddfbe9e711130dfc74874bbe72293d564bf8aa1728e72a6c4`. All 470 vendor checksums match. The wheel retains those files, all 25 original Grocy core files, and all six PHP adapters. Git retains the original vendor bytes. The final image and wheel match all 613 application and bundled source files. Ruff, basedpyright, and PHP syntax checks passed. The disabled-feature profile passed both cases in UTC and Europe/Bucharest.

This batch needs no database revision. Stock and recipe writes, calendar date limits, printer errors, and further combined permission cases still require work. Full runtime parity remains incomplete.


## Native recipe and shopping actions

Recipe fulfillment, consumption, copy, and missing-ingredient actions now execute the unchanged recipe controller and service. The six shopping actions execute the unchanged stock controller and service. Native permissions run at their original boundaries. PHP retains request parsing, numeric URL comparisons, integer amount conversion, default list IDs, boolean filtering, null body errors, and response bytes.

The native recipe routes ignore the `servings` query parameter. Fulfillment returns the native resolved fields and numeric flags. Ingredient consumption runs in one transaction. Duplicate ingredients can make a later booking exceed the remaining stock. That error restores all earlier ingredient changes. Output creation runs after the ingredient transaction commits. An output error retains consumed ingredients. A failed output label can also retain the output stock already saved.

Raw prepared statements now run through the application connection and return native insert IDs. Recipe copy retains the original column lists and string response ID. Its separate statements can leave the new parent recipe saved after a later ingredient insert fails. A retry creates another copy. The former unused Python copy method is removed.

Recipe copy uses the original localization service, English translation files, and pinned Gettext libraries. Output labels use the original Grocycode and webhook helpers with pinned Guzzle dependencies. The source files, licenses, package revisions, and checksums come from the verified release archive. Native JSON and form requests retain the original row serialization. Native HTTP errors keep Guzzle's exact message.

The web recipe page now uses the versioned recipe routes for selected servings and ingredient details. Copy uses the native route. Scaled consumption and missing-ingredient writes require their separate stock and shopping permissions. The public extension check covers selected quantities, ingredient details, denied writes with unchanged records, and permitted writes. The browser check confirmed doubled requirements, saved shopping amounts, consumption of the chosen amounts, and copy. It found a missing JSON body on the shopping action. The page and API helper now send that body.

The initial 34-case comparison passed all reference cases and failed 30 local cases. The extended 45-case comparison failed 41 local cases before the repair. All 45 reference cases and four local controls passed. The additional duplicate-ingredient case also failed on the previous backend while the reference passed. Both output-label cases failed there. The versioned extension case returned 404 on the previous commit. After the repair, the recipe, shopping, and shared merge fixture selection passed 96 comparisons. The additional duplicate and label checks each passed both variants. All 11 focused integration cases passed after correcting native numeric flag expectations and moving the existing scaled quantity check to the extension.

The full local suite passed 752 tests and skipped 701 reference or feature-profile cases. The full comparison suite passed 1,354 tests and skipped one disabled-feature case in each of UTC and Europe/Bucharest.

The Linux image passed 49 selected HTTP cases on both a new database and a saved revision 0020 database. The direct copy trigger case requires database access and is skipped over external HTTP. A separate Linux check proved copy partial saves and retry. Native JSON and form labels, HTTP errors, committed ingredient and output stock, and worker cleanup passed on PHP 8.4. The upgrade kept all original core records and allocation counters. Restart kept complete state. All 45 views and 54 triggers retained their source definitions and order. CLI initialization, import, saved custom triggers, BLOB values, and the earlier native user and chore checks also passed.

The image is `sha256:a6bb6d2d3b0b3441128de37779e8049781d01c9dff3b2c564a7aa28060f0d7e8`. All 651 vendor checksums match. The wheel and image retain all 801 current application and bundled source files. The 36 Grocy core files match the release archive. Git retains all original vendor bytes. Ruff, basedpyright, PHP syntax, and the frontend build passed. The disabled-feature profile passed both cases in UTC and Europe/Bucharest.

This batch needs no database revision. Stock writes and remaining stock reads, calendar date limits, label endpoints, printer paths outside recipe output, and further combined permission cases still require work. Full runtime parity remains incomplete.


## Native stock routes and label endpoints

Stock purchases, consumption, opening, transfers, inventory, entry edits, merges, barcode actions, remaining stock reads, and undo now execute the unchanged stock controller and service. The original product, stock entry, chore, battery, and recipe controllers handle all five label endpoints. PHP retains request parsing, numeric URL conversion, permission checks, SQL order, transaction boundaries, response types, and Guzzle errors. External barcode providers and thermal printing remain separate work.

The native purchase API accepts PHP boolean and numeric argument conversion. Invalid optional price, location, store, and date inputs use the original defaults. Year 0000 dates survive booking, entry reads, and product details. Numeric label modes outside the documented range use the original branches. Consumption retains the controller's `transactiontype` typo. Its typed boolean argument can treat the text `false` as true. Barcode resolution runs before the action permission check. Unknown barcode errors can therefore precede permission errors.

Entry edits require an amount. When `open` is omitted, the original service can save the old booking before returning the `BoolToInt` type error. A retry with `open` supplied follows the original nullable date rules. Merge IDs use the native strict integer check. Self-merge keeps the original error and stored state. Numeric URL forms work for stock details, entries, price history, bookings, and undo. Product label codes use the resolved product ID. Chore, battery, and recipe label codes retain the URL text.

A native product merge exposed a local nutrition foreign key conflict. The raw product delete now uses the existing application-owned deletion cleanup inside Grocy's transaction. A rejected delete restores the original nutrition records. A later retry succeeds, keeps the retained product's nutrition, and removes records owned by the deleted product. The public test failed with the foreign key error before this repair and passes after it.

The final 42 new workflow cases pass against the reference. The previous backend failed 41 of them and passed one accepted control. Five earlier stock cases also remained in the baseline selection. Its complete result was 41 failures and 53 passes. The repaired stock and label selection passed 93 comparisons before the separate two self-merge comparisons passed. The label mode check now uses a real local HTTP receiver on both backends. It replaces the earlier HTTPX-specific mock and checks per-unit labels, inventory labels, explicit labels, disabled automatic printing, and disabled server printing.

The first local integration run found four fixture errors. Three old-schema fixtures called the current stock handler before native permission views existed. They now store their legacy stock, bookings, and caches directly, then check the current API after upgrade. The stock edit fixture now supplies its required `open` value. All 14 focused legacy, allocation, and stock cases passed after these corrections. The full comparisons also exposed a test that compared generic object rows with stock-entry responses after earlier custom field definitions. It now compares snapshots from the stock-entry endpoint.

The full local suite passed 794 tests and skipped 744 reference or feature-profile cases. After the snapshot correction, the full comparison suite passed 1,439 tests and skipped one disabled-feature case in each of UTC and Europe/Bucharest. The corrected local entry check also passed.

The Linux image passed 65 selected HTTP checks on both a fresh database and a saved revision 0020 database. The upgrade kept all original core records and allocation counters. Restart kept complete state. All 45 views and 54 triggers retained their source definitions and order. Separate Linux checks passed native nutrition merge rollback and retry, year 0000, PHP booleans, numeric URL undo, empty responses, actual Guzzle labels and errors, prepared recipe copy, CLI initialization, import, custom triggers, BLOB values, and worker cleanup.

The image is `sha256:5381d0ae460c0838bb4dc6fe3249a32735dc4e54bd799de3bf4916830e72924c`. The image and wheel match all 801 current application and bundled source files. All 651 vendor checksums retain their original bytes in Git. Ruff, basedpyright, and PHP syntax checks passed. The disabled-feature profile passed both cases in UTC and Europe/Bucharest.

This batch needs no database revision. External barcode providers, thermal printing, calendar date limits, remaining system behavior, and further combined request and permission cases still require work. Full runtime parity remains incomplete.

## Native calendar export and sharing links

Calendar export and sharing links now execute the unchanged calendar controller, calendar service, API key service, and URL manager. The release's eluceo/iCal 2.14.0 library handles event IDs, dates, time zones, escaping, and folding. The original response keeps its calendar content type and attachment name. Task descriptions remain empty. Event IDs change on each export. Stock, task, chore, battery, and meal events retain year 0000 dates. Malformed task dates and meal section times retain the original PHP type errors.

Sharing links use the original 50-character alphanumeric secret and `special-purpose-calendar-ical` key type. The service reuses a valid key across users. It does not repair keys owned by deleted users. Native calendar key expiry uses the server's local clock and whole seconds. Authentication now selects only identity and validity fields. It does not parse unused user timestamps. Saved application `calendar` keys still permit calendar access. Other API key expiry rules remain unchanged.

The former Python calendar serializer, time-zone builder, unused household service, and unused label builder are removed. No database revision is needed.

The initial nine calendar cases failed on the previous backend and passed against Grocy 4.5.0. The three additional authentication cases also failed locally before the authentication repair and passed against the reference. After the repair, the focused calendar, chore schedule, and reference calendar selection passed 55 checks in Europe/Bucharest. All nine access and user-deletion integration checks passed. The earlier full integration and unit selection passed 98 checks.

The full local suite passed 806 tests and skipped 756 reference or feature-profile cases. The full comparison suite passed 1,463 tests and skipped one disabled-feature case in each of UTC and Europe/Bucharest. The final whole-second text expiry comparison also passed 19 selected local checks and all 24 calendar comparisons in Europe/Bucharest.

The Linux image passed 26 selected HTTP checks on both a new database and a saved revision 0020 database. Four direct database or shared-fixture cases were skipped over HTTP. Separate Linux checks proved native and saved calendar secrets, calendar-only scope, local expiry, secret rotation, unused user dates, MIME headers, empty task descriptions, random event IDs, and year 0000 dates. The saved fixture had a fractional chore start date. Export retained the native type error. The HTTP checks then used a whole-second chore date. Upgrade kept all original rows and allocation counters. Restart kept complete state. All 45 source views and 54 source triggers retained their definitions and order. CLI initialization, import, saved custom triggers, BLOB values, native stock and recipe actions, and worker cleanup also passed.

The image is `sha256:73571a09edb218475e3697499b064816d272da3453da8b35210f6ad9317f1dd4`. The wheel and image match all 868 current application and bundled source files. All 720 managed vendor files retain their original bytes in Git. All 40 Grocy core files and 65 iCal files match the pinned release archive exactly. Ruff, basedpyright, and PHP syntax checks passed. A repository-wide format check still reports four pre-existing files. The disabled-feature profile passed both cases in UTC and Europe/Bucharest.

External barcode providers, thermal printing, remaining system behavior, and further request, authentication, and permission cases still require work. Full runtime parity remains incomplete.

## Native thermal shopping list printing

Thermal shopping list printing now executes the unchanged print controller and service. The unchanged stock service formats the rows. The pinned release supplies mike42/escpos-php 4.0, gfx-php 0.6, printer capabilities, and package licenses. The adapter supplies printer settings and the application connection. No database revision is needed.

The original formatter rounds quantities, selects singular or plural unit names, adds notes, and pads quantity columns. It also prints completed shopping items. The original printer library controls character encoding, headers, line feeds, and cut commands. File and network connectors retain their native errors. The API route runs when the thermal printer UI feature flag is false. An explicit header query enables the header only when its text is exactly `true`. Numeric list strings use the original database comparison. The controller checks the shopping permission before it validates the list.

The native `GROCY_TPRINTER_*` settings now control printing. The existing device, host, and port settings remain aliases. Explicit native settings take precedence. The existing device integration case now checks both forms. It checks the complete native receipt bytes. The former text preview expectation is removed because Grocy attempts a real printer connection.

After correcting the test fixtures, the baseline failed all 18 local cases and passed five reference workflow controls. The 13 paired printer cases completed their reference calls before each local failure. The repaired implementation passed all 23 focused comparisons. These cover file and network receipt bytes, headers, numeric list forms, quantity and note switches, completed items, missing lists, native connector errors, and permission order. The initial five meal and catalog integration cases also passed before the second configuration case was added to the full run.

The full comparison suite passed 1,486 tests and skipped one disabled-feature case in each of UTC and Europe/Bucharest. The full local run passed 811 tests and skipped 774 reference or feature-profile cases. One broad smoke test still expected a successful text preview without a printer. That obsolete printer entry is removed. The configured receipt and native error cases remain the primary printer checks. The other 98 integration and unit cases passed. The corrected smoke test passed separately.

The Linux image passed 31 selected HTTP cases on both a new database and a saved revision 0020 database. Four direct database or shared-fixture cases were skipped over HTTP. Separate Linux checks passed native file and network receipt delivery, environment boolean parsing, unit names, notes, completed items, native file connector errors, unchanged shopping records, and worker cleanup. Upgrade and restart kept the saved records and allocation counters. All 45 source views and 54 source triggers retained their definitions and order. The earlier CLI initialization, import, custom trigger, BLOB, native stock, recipe, and calendar checks also passed.

The final image is `sha256:6f72660cca02a9e0e1f475a811bd82f7c74d9d2e325212815fbf48488f8eee64`. The wheel and image match all 956 current application and bundled source files. All 806 managed vendor files retain their original bytes in Git. All 42 Grocy core files and 84 printer package files match the pinned release archive exactly. Ruff, basedpyright, and PHP syntax checks passed.

External barcode providers, remaining system behavior, and further request, authentication, and permission cases still require work. Full runtime parity remains incomplete.

## Native external barcode lookup

External barcode lookup now executes the unchanged stock controller and service. The release's base plugin validator, Open Food Facts plugin, and demo plugin are bundled without changes. Open Food Facts remains the default. User PHP plugins take precedence over bundled plugins. Native actions now use the persistent `GROCY_DATAPATH` directory. Their serializer cache remains temporary. Docker uses `/data` for plugin data.

The original controller requires master-data edit permission for all lookups. It accepts arbitrary barcode text and keeps the exact `add` query rules. Plugin validation retains its native errors, null output, required fields, active entity references, and conversion factor checks. Successful additions return a string product ID. Duplicate product names fail before later writes. The former Python provider implementation and its unused URL setting are removed.

Image downloads use the original Guzzle code and source version user agent. A shared native file adapter directs both downloaded pictures and public file requests to `GROCY_FILES_ROOT`. Image request errors remain ignored. A later barcode insert error leaves the product and image saved. Different purchase and stock units expose another native partial-write case. Product creation saves reciprocal conversion rows with factor 1. The later explicit conversion insert can then fail with `QU conversion already exists`. The product, barcode, image, and both default conversion rows remain saved.

All 22 new public cases failed on the previous route and passed against Grocy 4.5.0. After the repair, all 44 focused comparisons passed. The cases cover user plugin precedence, arbitrary barcode text, add values, exact plugin output errors, permissions, string IDs, duplicate names, image download success and failure, public file retrieval, raw plugin names, and barcode or conversion partial saves. All 99 integration and unit cases passed. The test fixture uses an isolated persistent data directory.

The full local suite passed 834 tests and skipped 796 reference or feature-profile cases. The full comparison suite passed 1,530 tests and skipped one disabled-feature case in each of UTC and Europe/Bucharest.

The Linux image passed 31 selected HTTP cases on both a new database and a saved revision 0020 database. Four direct database or shared-fixture cases were skipped over HTTP. Separate Linux checks passed the original bundled demo plugin, user plugin precedence, query parsing, Guzzle image requests and user agents, native file reads, ignored image errors, partial barcode writes, and reciprocal conversion conflicts. Real HTTP checks passed a Unicode image filename and exact picture bytes. User plugins and image bytes survived container restart. A new request after restart used the saved plugin.

Upgrade kept all original rows and allocation counters. Restart kept complete database state. All 45 source views and 54 source triggers retained their definitions and order. The earlier CLI initialization, import, custom trigger, BLOB, native stock, recipe, calendar, thermal printer, and worker cleanup checks also passed.

The final image is `sha256:ad411c10d4673ab09452b06d204f6d44def5fd3dbfac8de12fffa3c80c08fc48`. The wheel and image match all 962 current application and bundled source files. All 811 managed vendor files retain their original bytes in Git. All 47 Grocy core files match the pinned release archive exactly. The seven PHP adapters include the shared native file service. Ruff, basedpyright, and PHP syntax checks passed.

Remaining system behavior and further request, authentication, and permission cases still require work. Full runtime parity remains incomplete.

## Native system routes and locales

All six system routes now execute the unchanged system controller and application service. The request adapter forwards headers and the URL. The original locale middleware selects a saved user locale before request language preferences. All release translations are bundled. The original Slim request-response strategy validates controller results.

Time queries retain PHP integer validation, query-array errors, overflow behavior, native response fields, and PHP date formatting. System information reports the request user agent, PHP and SQLite runtime versions, operating system, and the saved native migration version. Configuration reports the original defaults and current printer, plugin, locale, and URL settings. Localization responses retain the native cache header. Recipe copies now use the selected locale.

Database change time now uses the main database file timestamp. It retains Grocy's behavior when WAL has newer writes. The production missing-translation method returns null in the original controller. The original Slim strategy raises its response type error. The backend now returns that native 500 response, including when the request body contains invalid JSON.

Revision 0022 records native schema version 253 only when the version table is empty. Supplied migration history remains unchanged. Imports now copy that history and preserve raw timestamp text. Imports also keep the native calendar key type. They no longer change it to the old application calendar type. The import check proves that the saved calendar secret remains in the sharing link after upgrade.

The final baseline failed 25 local comparison cases and passed 20 reference controls. Both additional import and main-file timestamp cases also failed on the previous backend. The repaired system, locale, current configuration, and unused user-date selection passed all 45 focused comparisons in Europe/Bucharest. All 100 integration and unit cases passed. The former system smoke checks for a successful missing-translation call and an application-only entity inventory were removed. Their public operations now have stronger source comparisons and actual object requests.

The full local suite passed 853 tests and skipped 819 reference or feature-profile cases. The full comparison suite passed 1,571 tests and skipped one disabled-feature case in each of UTC and Europe/Bucharest.

The Linux image passed 48 selected HTTP cases on both a new database and a saved revision 0020 database. Four direct database or shared-fixture cases were skipped over HTTP. Separate Linux checks passed all 33 locales, user and header locale selection, localized recipe copy, current configuration, request metadata, live migration versions, integer and overflow rules, the production response error, and main-file timestamps. Import checks retained native migration history, year 0000, fractional timestamps, and canonical calendar key types.

Upgrade kept all original rows and allocation counters. Restart kept complete database state, user plugins, and image bytes. All 45 source views and 54 source triggers retained their definitions and order. The earlier native stock, recipe, calendar, thermal printer, barcode, BLOB, CLI initialization, saved custom trigger, and worker cleanup checks also passed.

The image is `sha256:7e2f3aa473815b073a3b4e062c36a39c986ddfb0dea325a3730d0e5644f67b85`. The image and wheel match all 1,266 current application and bundled source files. All 1,114 managed vendor files retain their original bytes in Git. All 348 Grocy core files match the pinned release archive. Ruff, basedpyright, and PHP syntax checks passed.

Authentication use records and expiry still require work. The final audit must also check unused user-setting dates, default-setting propagation, configuration modes, HTTP methods, and common error behavior. Full runtime parity remains incomplete.

## Native HTTP routing and API specification

HTTP method selection now uses the original Grocy route declarations and Slim router. The pinned FastRoute and PSR packages supply its dependencies. The original CORS middleware handles preflight requests and wildcard headers. The original exception controller formats route errors. HEAD executes the matching GET operation and returns no body. OPTIONS returns an empty 200 response before authentication. Unauthorized responses retain the native empty body and HTML content type. An unknown API path can return 405 because the native wildcard OPTIONS route matches that path. Application v2 and health routes keep their existing request rules.

The original OpenAPI controller now serves `/api/openapi/specification`. It adds current custom entities, the release version, and request URLs. Setting queries select only keys and values. Unused year 0000 or malformed setting timestamps no longer block requests. No database revision is needed.

The first baseline failed 13 local cases and passed two reference workflow controls. The additional API specification case also failed locally after its source request passed. All 16 focused comparison cases passed after the repair. The worker recovery test now checks replacement workers and shutdown without assuming a fixed total worker count. It also stops the separate HTTP worker and proves request recovery. Both worker integration cases passed.

The Linux image passed 48 selected HTTP workflows on both a new database and a saved revision 0020 database. Four direct database cases were skipped over HTTP. Additional real HTTP checks passed HEAD, OPTIONS, method errors, wildcard CORS, empty unauthorized responses, and the original API specification. Upgrade and restart kept all saved core records and allocation counters. All 45 original views and 54 original triggers retained their definitions and order. CLI initialization, imports, custom triggers, BLOB data, native actions, all 33 locales, saved plugins and images, and worker shutdown also passed.

The image is `sha256:1ceb3e38f25f19244ea19cc6b22626b9aaa04a5e8a8c9332547f34e643aa41dc`. The wheel and image match all 1,380 current application and bundled source files. All 1,221 managed vendor files match the pinned release archive and staged Git bytes. All 352 bundled Grocy core files retain their release bytes. Ruff, basedpyright, and syntax checks for all eight PHP adapters passed.

The full local suite passed 855 tests and skipped 833 reference or feature-profile cases. The full comparison suite passed 1,587 tests and skipped one disabled-feature case in each of UTC and Europe/Bucharest.

Authentication use records and expiry, setting defaults, configuration modes, and more combined request and permission cases remain open. Full runtime parity remains incomplete.

## Native API key authentication and use records

Native credentials now use the unchanged API key middleware, its base middleware, and API key service. The adapter supplies the request, native route context, and application database connection. The original service retains local whole-second expiry, null-expiry rejection, PHP empty values, repeated-header handling, query parsing, calendar scope, and credential selection. Valid checks save `last_used` before the user lookup. This also updates a key whose user was deleted. The main database file timestamp is restored after that write. A repeated request within one second can skip the unchanged write and still authenticate.

Array query values retain the original LessQL behavior. An array can replace all three validation parameters, including the expiry threshold. This native behavior remains unchanged. PDO supplies null for omitted bindings. Extra bindings retain SQLite error 25. The Python statement adapter now applies these rules after its driver rejects the binding count.

Application keys use the separate `grocy-next` type. New CLI, bootstrap, and v2 keys retain the existing application expiry rules. A valid application header takes precedence over query credentials. Application calendar keys retain their existing scope. Revision 0023 classifies saved application keys without changing their secrets, users, expiry values, or counters. New imports record native key identities. Older imports recover those identities from their saved source copy. Both ID and secret must match. Imported keys remain excluded from application-key classification, including native keys with null expiry or application-shaped text.

The isolated baseline reproduced five differences. All five passed after the repair. The expanded public comparison passed all 28 cases against Grocy 4.5.0. These include local expiry, null expiry, key `0`, duplicate headers and query parameters, fallback, orphan users, repeated use, text expiry, array replacement, and binding errors. The additional array-error case failed before the binding repair. The new import and main-file-time tests both failed on the committed previous backend and passed after the repair. Both current and saved import formats keep their native and application expiry rules.

The first broad integration and unit run passed 102 tests. Its remaining schema expectation omitted the new metadata table. The corrected six-case saved-graph selection passed. File streaming, worker recovery, transient worker shutdown, native key use timestamps, main-file time, and application credential priority also passed.

The Linux image passed 48 selected HTTP workflows on both a new database and a saved revision 0020 database. Four direct database cases were skipped over HTTP. Additional real HTTP checks passed repeated native key use, orphan selection before fallback, null expiry, key `0`, duplicate headers, query fallback, native array replacement and errors, application header priority, saved use timestamps, and unchanged main-file time. A probe initially supplied a valid application fallback while it expected 401. The corrected probe removed that fallback from the invalid-key cases and passed.

The saved database kept its records and allocation counters. The old application key type changed to `grocy-next` as required by revision 0023. Restart kept complete database state, plugins, and image bytes. All 45 original views and 54 original triggers retained their definitions and order. Linux CLI initialization, imports, saved custom triggers, BLOB values, stock, recipes, calendar, printing, barcode lookup, all 33 locales, and worker shutdown also passed.

The image is `sha256:ac384924b27744783ec0c375f6ff7954c981cb2c7d26e32f58c335c02d1664d5`. The wheel and image match all 1,383 current application and bundled source files. All 1,223 managed vendor files match the pinned release archive and staged Git bytes. All 354 bundled Grocy core files retain their release bytes. Ruff, basedpyright, and syntax checks for all eight PHP adapters passed.

All 86 API operations declared in the original route file have application routes. HEAD and OPTIONS use the original Slim rules. This route inventory does not prove full logic parity.

The full local suite passed 872 tests and skipped 847 reference or feature-profile cases. The full comparison suite passed 1,615 tests and skipped one disabled-feature case in each of UTC and Europe/Bucharest.

A separate follow-up probe found remaining query-byte and nested-array differences. An invalid UTF-8 query key returns native 401 but local 503. A stored native key with that byte authenticates in Grocy but returns local 503. A nested query array returns native 401 but local 500. Header-byte comparisons also need a real HTTP check because TestClient changes non-ASCII header encoding. These probes remain outside the passing suite and require further repair.

Setting defaults, configuration modes, arbitrary request bytes, and further combined request and permission cases still need comparison. Full runtime parity remains incomplete.

## Native PDO parameters and request bytes

Prepared parameters now pass through the real PDO driver for validation. A private EXPLAIN statement checks the bindings without executing the write. The adapter retains parameter names, string conversion, arrays, omitted values, and native binding errors. It also retains prior values when a prepared statement is reused. The resulting SQL keeps SQLite text values and embedded bytes. Unary plus removes the affinity introduced by the hexadecimal text representation. The previous Python binding-count translation is removed.

Invalid UTF-8 text now remains bytes when Python reads SQLite. The unchanged PHP controller still decides whether its response can be encoded. Credential metadata uses base64 between PHP and Python. Raw header values use their actual UTF-8 bytes for application-key selection. A byte value can no longer select a different application key through Latin-1 decoding.

The five original byte and nested-array probes failed on the previous backend and passed after the repair. The expanded public selection passed all 52 comparisons. It covers raw headers, invalid UTF-8 query values, stored byte credentials, named and unknown parameters, nested arrays, partial use timestamps, NUL values, quote truncation, and application-key byte collisions. The previous-commit selection failed eight cases and passed 36 controls before the later NUL and collision cases were added. The collision case separately failed locally and passed against Grocy before its repair.

The first integration run found incorrect response-column mapping across the native and application table layouts. Mapping by the original field names corrected it. All 12 focused access and stock cases then passed. All 103 integration and unit cases also passed.

The Linux image passed 48 selected HTTP workflows on both a new database and a saved revision 0020 database. Four direct database cases were skipped over HTTP. Additional real HTTP checks passed invalid UTF-8 headers and query values, stored byte credentials, application-key byte collisions, nested arrays, named binding errors, partial key-use writes, NUL quote truncation, raw SQLite text storage, and the unchanged main-file timestamp. Both containers kept complete restart state, including invalid text credentials, plugins, and image bytes. All 45 original views and 54 original triggers retained their definitions and order.

Linux CLI initialization, imports, saved custom triggers, BLOB values, stock, recipes, calendar, printing, barcode lookup, all 33 locales, and worker shutdown also passed. The image is `sha256:254e5303b21a4e2a3c7c86ef50104562c51438e8be1db850acbe722a719b9c54`. The wheel and image match all 1,384 current application and bundled source files. All 1,223 managed vendor files retain their original staged bytes. All 354 bundled Grocy core files remain unchanged. Ruff, basedpyright, and syntax checks for all nine PHP adapters passed. This batch needs no database revision.

The full local suite passed 884 tests and skipped 859 reference or feature-profile cases. The full comparison suite passed 1,639 tests and skipped one disabled-feature case in each of UTC and Europe/Bucharest.

A separate custom-configuration probe found the next difference. The original runtime returns configured default values of 37 due-soon days, two amount decimal places, and currency EUR. The backend still returns five days, four decimal places, and USD for the same data-directory configuration file. Configuration files, setting defaults, modes, and further combined request cases remain open. Full runtime parity remains incomplete.

## Native request configuration and authentication

Each compatibility request now owns a PHP context and one application database session. The context loads the data-directory `config.php`, original setting helpers, and `config-dist.php` before native validation and HTTP routing. Original setting override files and environment values retain their priority. Configuration constants, service caches, authentication, locale selection, and controller execution use that same request context. The separate SQL function worker can still answer while the request worker waits for SQLite. Request shutdown closes its worker.

Configured default user settings now reach native user responses. Saved settings take priority, and deletion restores the configured default. A configuration change takes effect on the next request. The configured due-soon default also reaches the original recipe SQL views. Invalid configuration returns the original plain HTTP 200 response before authentication or CORS, including OPTIONS requests.

The original default, API key, session, reverse proxy, and LDAP authentication classes now select native credentials. Session cookies retain local expiry, null-expiry rejection, duplicate-cookie order, percent decoding, literal plus signs, array handling, orphan-key fallback, and saved use timestamps. Reverse proxy authentication creates users with configured native permissions. Repeated proxy headers use the combined value that PHP supplies to Slim. Application keys keep their versioned extension rules.

The public selection passed all 52 comparisons, including the existing combined-purchase undo case. The previous committed backend failed 21 of these cases. Every reference case passed on that baseline run. The first proxy permission probe used a nonexistent permission name. The corrected probe uses `TASKS_MARK_COMPLETED`, checks stored permission identity, completes a task, and confirms that task creation remains denied. The comparison runner disables PHP opcode caching so edits to the disposable configuration take effect on each request. Printer fixtures now use native setting override files on both backends.

The first integration and unit run passed 102 tests. Its remaining worker test expected a persistent request process. The revised test checks a failed request, no database write, filtered input after recovery, SQL function worker recovery, and process shutdown. Both focused worker cases passed. This batch needs no database revision.

The full local suite passed 909 tests and skipped 884 reference or feature-profile cases. The full comparison suite passed 1,689 tests and skipped one disabled-feature case in each of UTC and Europe/Bucharest. The disabled-feature profile passed both cases in both zones. Ruff, basedpyright, and syntax checks for all ten PHP adapters passed.

The Linux image passed 48 selected HTTP workflows on each of a new database and a saved revision 0020 database. Four direct-database cases were skipped over HTTP. Further HTTP checks passed configured defaults, currency, early validation responses, authentication bypass, repeated proxy headers, new proxy users, session cookies, orphan-key fallback, saved use timestamps, and unchanged main-file time. Both databases kept their complete state after restart. All 45 original views and 54 original triggers kept their definitions and order.

Linux CLI initialization, imports, saved custom triggers, BLOB values, stock, recipes, calendar, thermal printing, barcode lookup, all 33 locales, and worker shutdown also passed. The thermal environment probe now changes and restores the native environment values between its scenarios. The image is `sha256:a2cbbd5c989e120b88970a2be4b1b300b106bde77827379f17c8d217993e7639`. The wheel and image match all 1,486 current application and bundled source files. All 1,321 managed vendor files retain their original staged bytes. All 360 bundled Grocy core files remain unchanged. The 92 files in the three added PHP packages also match the pinned release archive.

The full runtime goal remains open. The original PHP development server can emit an `ob_clean` notice in development mode when output buffering is disabled. The current worker protocol does not reproduce that response output. The development identity check uses an explicit configuration that disables displayed PHP errors. Demo and prerelease database filename selection, base-path routing and error responses, and the initial version/configuration cache redirect still need repair or comparison. Further cookie byte and structured-input cases also need checks.
