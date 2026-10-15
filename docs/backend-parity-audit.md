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
