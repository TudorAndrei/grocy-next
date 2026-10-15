# Grocy compatibility

The baseline is Grocy v4.5.0 at commit `21aa5eab218c8466f90729154cb293fffbe10c21`. The OpenAPI file and its hash are in `contracts/`. Permission IDs and their parent relationships follow upstream migration 0110.

The compatibility API implements the 86 operations in the contract. It returns stock booking arrays and uses status 204 for empty actions. The generic API supports the 34 exposed entities, including calculated view records. List queries support `query[]`, `order`, `limit`, and `offset`. Query operators are `=`, `!=`, `~`, `!~`, `<`, `>`, `<=`, and `>=`. The `§` operator uses regular expressions with a match timeout.

The `/api/v2` API adds nutrition, API key management, and meal completion. MCP and the web application use the same domain services as the compatibility API.

## Verification

The normal test suite checks API routes, response types, storage, stock quantities, recipe units, undo, permissions, files, calendars, import, and MCP startup. It also tests the positive workflows after record deletion or state reversal. It does not use tests that only assert the absence of removed code.

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

## Boundaries

Route and entity coverage does not prove complete upstream behavior parity. The PHP comparison suite covers selected state changes. Full differential coverage for all options and third party clients is not established.

Calculated views come from application services. Their extra fields and row IDs can differ from upstream SQLite views. Internal recipe cache records and upstream triggers are not imported as active behavior.

File image requests support bounded resizing. Generic queries support the upstream regular expression operator. A label request returns Grocycode data and can send it to a configured HTTP printer. Thermal printing uses a configured TCP printer or a local printer device. Without a thermal printer, the API returns `READY` and printable text.

Calendar subscription keys grant calendar access only. Revoke a subscription key through API key management. Server configuration responses omit API keys and the database URL.
