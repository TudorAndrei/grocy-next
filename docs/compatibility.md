# Grocy compatibility

The baseline is Grocy v4.5.0 at commit `21aa5eab218c8466f90729154cb293fffbe10c21`. The OpenAPI file and its hash are in `contracts/`. Permission IDs and their parent relationships follow upstream migration 0110.

The compatibility API implements the 86 operations in the contract. It returns stock booking arrays and uses status 204 for empty actions. The generic API supports the 34 exposed entities, including calculated view records. List queries support `query[]`, `order`, `limit`, and `offset`. Query operators are `=`, `!=`, `~`, `!~`, `<`, `>`, `<=`, and `>=`. The `§` operator uses regular expressions with a match timeout.

The six exposed SQLite views use 17 pinned Grocy view definitions, including their dependencies. Quantity conversion and recipe views read current records instead of upstream caches. The permission hierarchy uses the pinned permission records. The application package includes the SQL definitions and Grocy's license notice.

The `/api/v2` API adds nutrition, API key management, and meal completion. MCP and the web application use the same domain services as the compatibility API.

System information reports the pinned Grocy API version and a separate application version. Configuration exposes public Grocy feature flags and the display currency. Localization strings use the pinned English defaults. System time supports offsets in seconds. Database change time includes SQLite WAL writes.

## Verification

The normal test suite checks API routes, response types, storage, stock quantities, recipe units, undo, permissions, files, calendars, import, and MCP startup.

To run the PHP comparisons with a new reference database:

```bash
uv run --project backend python scripts/check-reference.py
```

This command requires PHP and the modules that Grocy lists as required. It downloads the v4.5.0 release, verifies its SHA-256 checksum, starts a local reference server, and runs the comparison suite. It removes the temporary database and stops the server after the run. The `php-reference` CI job uses the same command.

Use `--php /path/to/php` to select another PHP executable. Use `--release /path/to/grocy_4.5.0.zip` to use an existing archive. `--dry-run` checks local inputs. `--output json` writes a machine-readable result to standard output and sends test output to standard error.

To compare state with upstream PHP, start a disposable Grocy v4.5.0 instance and supply its key:

```bash
cd backend
GROCY_REFERENCE_URL=http://127.0.0.1:9283 \
GROCY_REFERENCE_API_KEY=your-reference-key \
GROCY_REFERENCE_DISPOSABLE=1 \
uv run pytest tests/differential
```

The suite creates records in the reference database. It compares stock purchases, consumption, recipe fulfillment, recipe consumption, task completion times, task assignments, chore schedules, skipped executions, rescheduling, charge counts, undo, and household labels. It verifies the reference version before it writes. Use a fresh reference database for each run. Disable physical printing in the reference with `LABEL_PRINTER_RUN_SERVER=false`.

The normal suite also uses 14 schedule cases from the pinned Grocy SQLite view. These cases cover hourly, daily, weekly, monthly, yearly, adaptive, manual, and rollover schedules. To regenerate the stored results from a Grocy v4.5.0 source checkout:

```bash
backend/.venv/bin/python scripts/generate-household-goldens.py \
  /path/to/grocy-4.5.0 backend/tests/fixtures/household-grocy-4.5.0.json
```

Grocy 4.5.0 uses the last logged execution in its weekly schedule query, including an undone execution. This API uses that same date for weekly schedules. Chore tracking counts and last completed times exclude skipped and undone executions.

Purchase comparisons cover supplied purchase dates, price history, weighted prices, stock value, average shelf life, and calculated price and barcode records. Grocy's average price view uses integer division when all amounts and prices are integers. This API uses that same rule. Decimal input keeps decimal division.

Stock entry edits return an old booking and a new booking. Undo restores the prior entry. Later stock changes must be undone first. Price caches keep their last value when an undo leaves no calculated price row, as in Grocy 4.5.0.

Transfers return linked `transfer_from` and `transfer_to` bookings. They keep the stock ID, store, and note. Freeze and thaw settings set the new due date. Booking undo restores its linked pair. Transaction undo restores all active bookings in that transaction.

## Boundaries

Route and entity coverage does not prove complete upstream behavior parity. The PHP comparison suite covers selected state changes. Full differential coverage for all options and third party clients is not established.

Calculated view fields and row IDs follow the pinned SQLite definitions. Import checks compared all six exposed SQLite views with the reference database. Purchase price caches are stored and imported. Domain services implement writes. Internal recipe caches and other upstream triggers are not imported as active behavior.

File image requests support bounded resizing. Generic queries support the upstream regular expression operator. A label request returns Grocycode data and can send it to a configured HTTP printer. Thermal printing uses a configured TCP printer or a local printer device. Without a thermal printer, the API returns `READY` and printable text.

Calendar subscription keys grant calendar access only. Revoke a subscription key through API key management. Server configuration responses omit API keys and the database URL.

Transfer undo keeps the original source location and store. Grocy 4.5.0 can use the current default location and omit the store when it restores a fully transferred entry. This implementation keeps the original booking data in that case.
