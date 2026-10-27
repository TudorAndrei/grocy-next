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
- A configured API base path supports the checked route, authentication, error page, and encoded file rules. Python extension routes keep their JSON errors and CORS rules under the prefix.
- Demo and prerelease modes use their own database files. The tests check reads, writes, missing schemas, return to production data, and initialization at startup.
- The API specification includes current custom entities and uses the configured URL rules for server and key management links.
- Locale selection uses the saved locale, request language preferences, and configured default. Translation output preserves empty entries and plural forms. Recipe copies use the selected translation.
- User profile errors and self-edit ID checks follow the checked legacy rules. The web profile form retains the saved photo.
- `GROCY_DEFAULT_USER_SETTINGS` supplies Python configuration defaults. Saved values have priority, and recipe views use the same defaults.
- Python authentication modes support API keys, sessions, and reverse proxy identities. Session mode also works with web login and logout.
- Python LDAP login checks the directory password, uses the returned user ID attribute, and creates users with the configured default permissions. Real directory tests compare these rules with legacy login. TLS tests check LDAPS, StartTLS, and rejection of an untrusted certificate.
- Picture responses use libgd from Python. Reference checks compare exact bytes for PNG, JPEG, GIF, WebP, and BMP, including palette images, EXIF rotation, and fractional resize values. The release image includes libgd and does not include PHP.
- Recipe printer labels expose the native fields. Empty printer paths return the checked legacy error.
- The web app applies server feature flags to navigation, direct routes, quick actions, Today requests, household choices, and data management choices. String values retain PHP truth rules: `"0"` disables a feature, but `"off"` enables it.
- Stock forms, stock tables, shopping tools, and label choices use the related tracking and printer flags. Disabled entry fields retain the legacy submission rules, including price `0`, location `1`, and a closed entry.
- The product editor includes freezing warnings, opened-stock treatment, stock label defaults, automatic label reprinting, and purchase price type. Product fields use the checked legacy hidden defaults when tracking is disabled.
- Web builds, page links, API requests, and authenticated downloads support a configured path prefix. The release web server and Vite proxy use the same prefix as the Python API.
- Product and recipe editors support picture upload, preview, replacement, and removal. They save the record and custom fields before upload. An upload retry reuses a new record. File deletion failure does not cancel the record update. Picture requests use authentication headers.
- Python configuration exposes the configured energy unit, code type, and calendar week-number setting. The product energy field uses the configured unit without a value conversion.

Full Python parity is not complete. Open work includes further configuration options, translated web text, and remaining form behavior. Test results must identify the runtime and selected cases.

## Verification

On 2026-10-27, the full reference comparison passed on Python commit `b91d908` in `Europe/Bucharest`: 1,850 tests passed and 56 were skipped. The release image also passed HTTP checks for startup, catalog, stock, undo, settings, custom fields, files, calendar, the API specification, and profile access. The image had no PHP executable. These results cover the checked cases; they do not prove complete web feature coverage.

On 2026-10-28, the same commit passed the full reference comparison in `UTC`: 1,850 passed and 56 skipped. The normal Python test run passed 1,008 tests and skipped 1,062 cases that required other test environments. The disabled-feature comparison also passed both selected cases.

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

The PHP template cache and its first-request redirects are checked only on the reference runtime.

Python checks environment configuration at process startup. It rejects the checked invalid settings before it starts the HTTP server. PHP reloads `config.php` for each request and can return an HTML configuration error. The tests check the same value rules at each runtime's configuration boundary.
