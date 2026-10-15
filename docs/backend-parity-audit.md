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

Source: [stock service and undo rules](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/services/StockService.php), [stock API and label payloads](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/controllers/StockApiController.php), and [stock field handling](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/migrations/0183.sql).

## Recipes, meal plans, and shopping

Meal writes maintain day, week, and individual meal recipes. Startup restores derived recipes in existing project databases. An individual meal recipe produces the output product and serving quantity from its source meal.

Recipe fulfillment uses the pinned SQL results for costs, calories, price completeness, due score, product names, and stock status. Normal ingredient quantities use stock units. The v2 recipe input converts supplied units before storage. Recipe copy follows the Grocy name, serving, and ingredient defaults.

Recipe shopping accepts excluded product IDs. Presence-only ingredients keep an unrelated unit when no conversion exists. Shopping additions keep the requested or purchase unit. Automatic minimum-stock additions use the acting user's settings. Removal uses the configured decimal threshold and the first matching product entry across lists.

Sources: [recipe service](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/services/RecipesService.php), [recipe API](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/controllers/RecipesApiController.php), and [stock and shopping service](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/services/StockService.php).

## Users and permissions

New users receive configured default permissions. The pinned default is `ADMIN`. An empty or null password update keeps the existing password. User creation, profile changes, and permission reads now use their specific permission checks. Shopping item and list writes use the add or delete permission. External barcode lookup requires master data access.

Sources: [user service](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/services/UsersService.php), [user API](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/controllers/UsersApiController.php), and [default permissions](https://github.com/grocy/grocy/blob/21aa5eab218c8466f90729154cb293fffbe10c21/config-dist.php).

## Verification

The final local suite passed 91 tests. The comparison suite passed 80 test cases. Ruff, basedpyright, and the frontend build also passed.

The regression tests exercise public HTTP requests and stored state. The same new workflow cases run against the local backend and a disposable PHP reference server. The release archive has a pinned SHA-256 checksum. The reference server uses UTC, English, default feature flags, and no physical label printer.

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
```

These checks do not test every plugin, physical printer, configuration, or third-party client. The `/api/v2` API, MCP, authentication storage, and server configuration are application extensions. See [the compatibility record](compatibility.md) for their boundaries.
