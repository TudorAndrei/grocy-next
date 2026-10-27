# Grocy compatibility

The baseline is Grocy 4.5.0, commit `21aa5eab218c8466f90729154cb293fffbe10c21`. The OpenAPI file and its checksum are in `contracts/`.

## Release target

The release uses Python. Keep `GROCY_USE_NATIVE_PHP=false`. This applies to the API, files, input filtering, printing, barcode lookup, and all business rules. The release image does not install PHP.

PHP is only a test reference. Original `config.php` files and PHP plugins are reference inputs. The Python application uses `GROCY_` environment variables or `.env`. It does not execute those PHP files. Legacy features must have Python implementations.

The old native adapter remains available for test investigation. A test that passes with `GROCY_USE_NATIVE_PHP=true` does not establish Python parity. The older [backend audit](backend-parity-audit.md) records many results from that adapter. Those results are historical evidence about the reference behavior.

## Current coverage

The Python API provides the 86 contract operations and reads for the 33 listable entities. Route coverage does not prove full behavior parity. The separate `/api/v2` routes provide application features such as nutrition, API key management, and meal completion.

The database uses the pinned Grocy views, triggers, permission hierarchy, and allocation counters. Imports preserve source data and counters. See [migration](migration.md) for upgrade and recovery limits.

The current repair work covers these confirmed differences:

- Stock undo reads booking arrays and refreshes the entry list.
- Stock forms save price, store, purchase date, note, location, and open state.
- Shopping purchases preserve saved units and use one database transaction per item. A retry does not purchase a removed item again.
- Calendar export downloads the authenticated calendar document.
- Chore and battery forms send the legacy date and time format.
- Stock list filters use the same query rules as generic lists.
- Compatibility recipe routes use the legacy serving rules. The web app uses v2 routes for selected servings.
- Input filtering runs in Python. It preserves the checked HTML, entity, null, boolean, and numeric value rules.
- Permission replacement preserves the legacy delete and batch failure order.
- Custom field writes preserve earlier successful values when a later field fails. Field reads preserve numeric name and object-key comparison rules.
- Numeric settings keys retain the legacy distinction between a full settings response and a single-setting response.
- Recipe copy, consumption, and shopping writes preserve the checked transaction and partial failure rules.
- Barcode lookup supports [Python plugins](python-barcode-plugins.md), image downloads, and the legacy write order.
- File responses use content-based MIME types and preserve the checked stream and header rules.
- API key and session checks preserve the checked expiry, byte value, credential order, and use-record rules.
- HEAD, OPTIONS, method errors, and CORS headers use the legacy API response rules.
- User profile errors and self-edit ID checks follow the checked legacy rules. The web profile form retains the saved photo.
- `GROCY_DEFAULT_USER_SETTINGS` supplies Python configuration defaults. Saved values have priority, and recipe views use the same defaults.
- Python authentication modes support API keys, sessions, and reverse proxy identities. Session mode also works with web login and logout.
- Python LDAP login checks the directory password, uses the returned user ID attribute, and creates users with the configured default permissions. Real directory tests compare these rules with legacy login. TLS tests check LDAPS, StartTLS, and rejection of an untrusted certificate.

Full Python parity is not complete. Open work includes exact image output, further printer transport errors, further configuration options, base paths, mode-specific databases, and web feature flags and form options. Test results must identify the runtime and selected cases.

## Verification

Run the normal tests without PHP:

```bash
cd backend
GROCY_USE_NATIVE_PHP=false uv run pytest
```

Run the separate legacy comparisons from the repository root:

```bash
GROCY_USE_NATIVE_PHP=false uv run --project backend python scripts/check-reference.py
```

The comparison command downloads Grocy 4.5.0 and checks its SHA-256 checksum. It creates a temporary database, starts the legacy server, compares public responses and saved state, and then stops the server.

The reference server requires PHP 8.1 through 8.4 with `bcmath`, `ctype`, `curl`, `dom`, `fileinfo`, `gd`, `iconv`, `intl`, `libxml`, `mbstring`, `pdo_sqlite`, `simplexml`, and `zip`.

Use `--timezone UTC` or `--timezone Europe/Bucharest` to set the test time zone. Use `--php /path/to/php` to select the reference executable. Use `--release /path/to/grocy_4.5.0.zip` for a local release archive. Use `--dry-run` to check the setup.

Use repeated `--feature-flag NAME=VALUE` options to set the same flags on both applications. The disabled-feature CI check selects its own cases with `PYTEST_ADDOPTS='-k disabled_feature_flags'`.

For an existing reference server, set `GROCY_REFERENCE_URL`, `GROCY_REFERENCE_API_KEY`, and `GROCY_REFERENCE_DISPOSABLE=1`. Its database must be safe to change. Set `GROCY_REFERENCE_DATABASE` when a case needs direct test setup. For a remote Python test server, use the corresponding `GROCY_BACKEND_URL`, `GROCY_BACKEND_API_KEY`, and `GROCY_BACKEND_DISPOSABLE=1` values.

## Boundaries

The compatibility API must retain observed Grocy 4.5.0 behavior, including partial writes and known defects. The v2 API keeps its documented application rules. For example, the shopping purchase extension uses an atomic write for each item.

PHP version text, PHP interpreter warnings, and execution of arbitrary PHP code are properties of the reference runtime. They must not make PHP a release dependency. Equivalent product features belong in Python.
