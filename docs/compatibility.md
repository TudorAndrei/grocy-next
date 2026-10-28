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
- Compatibility recipe routes use the legacy serving rules. The recipe card saves desired servings and uses these routes for consumption and shopping writes.
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
- Barcode forms apply opening, location, and price tracking flags. Scan defaults accept numeric values and the legacy browser boolean forms, including `"on"`.
- Opening the web root uses the configured `ENTRY_PAGE`. Native page names map to the related web routes. Today remains available at `/today`.
- Stock shortages use the server result. Minimum gauges exclude opened stock when required, and parent product displays and consumption forms use the aggregated stock amounts.
- Stock forms select the default purchase or consume unit and use the resolved product conversions. Amounts and prices use the checked legacy rounding rules. The forms support unit prices, total prices, gross tare weights, and exact consumption amounts. Tare success messages show the booked stock change.
- The barcode page and barcode editor support camera scans with the six legacy formats: EAN-8, EAN-13, Code 39, Code 128, Data Matrix, and QR. Camera selection uses the legacy storage key. The scanner applies camera and torch flags, stops after the first result, and releases the stream on close, camera change, or page change. Browser checks decoded official ZXing images through a virtual video stream. Physical camera and torch checks remain open.
- Legacy routes decode the URI path before matching, then decode each captured argument. Barcode comparisons check escaped percent values, product selection, and all five stock actions. Real HTTP checks also confirm that these values select the expected product. Directly encoded slashes retain the legacy route rejection.
- Stock preferences expose price input and display precision, quick consume amounts, and purchase dates. Preference checkboxes read the legacy browser boolean forms. Purchase and inventory forms omit the purchase date when it is disabled, and price history uses the saved display precision.
- Calendar export retains the legacy error when a time-zone transition falls outside UTC years 0000 through 9999. Boundary comparisons cover the historical Bucharest offset and valid year-zero exports. Date-list tests remove their year-zero tasks so later calendar checks use their own data.
- The web app provides the 33 legacy languages. It reads the saved language, loads the pinned translation catalog, and applies its plural rules and text direction. Navigation, screen labels, form labels, and action messages use the translation helper. User names, product names, custom captions, and saved field values retain their original text. Quantity units support saved plural forms. Text without a legacy translation keeps its English fallback; remaining wording and date displays still need review.
- The saved night-mode settings control all web pages. The appearance form supports system, on, off, automatic time ranges, and ranges across midnight. It retains the native exclusive time limits, strict `HH:mm` parser, `24:00` value, and invalid-input rules. Checks run every 60 seconds in production and every four seconds in other modes. The internal enabled flag is saved when it changes. Before login, the app uses the system color scheme. Twenty recorded results from the pinned legacy JavaScript check the schedule rules.
- New-product presets expose location, group, quantity unit, due days, opened-stock treatment, and stock label type. The editor applies them only to new records and uses the preset unit for all four unit fields. A stock-unit choice fills other empty unit choices and retains an existing choice. Existing records keep their saved values, and disabled tracking fields retain their submission rules.
- The header clock follows its saved setting, updates each second, and uses the legacy long and short formats. The short format is shown below 576 pixels. It uses the catalog's `moment_locale` value, including its English fallback. Clock code loads when the setting is enabled. Its interval stops when the clock is disabled or removed.
- Recipe preparation and equipment descriptions display formatted text, lists, tables, and images. Python prepares a display copy through the authenticated content endpoint. Stored descriptions and compatibility API responses retain their values. The display copy removes active scripts and adds an iframe sandbox without same-origin access.
- Recipe and equipment views support full-screen cards. Recipe links retain the `#fullscreen` form. The controls remain visible during scrolling. Keyboard focus stays in the card, Escape closes it, and closing restores page access and prior focus. Automatic data refresh waits while a card is in full-screen mode. Equipment manuals display as PDFs and retain authenticated downloads.
- The appearance form exposes both screen-on settings. The first user action enables the saved preference. Always-on has priority over the conditional setting. The app releases its lock when the page is hidden, the setting is disabled, or the conditional card closes. It can acquire a new lock when the page becomes visible. A late request also releases its lock after close or removal. Browsers without the native API use the legacy NoSleep.js 0.12.0 method.
- Recipe cards include every nested recipe once and sort the included cards by name without case sensitivity. Python reads the pinned recipe views and keeps separate ingredient rows, nesting amounts, unit conversions, groups, notes, variable amounts, stock status, prices, and calories. The web reader supports keyboard tab selection and the saved ingredient checkbox and product-group settings. Check marks remain local to the page and reset on reload. Desired servings start with the saved value. Changes are saved in order before stock or shopping actions can run. Consumption can proceed when stock is insufficient, as in the legacy version.
- The Python recipe overview returns normal recipes in name order without case sensitivity. It includes ingredient names, due scores, missing ingredient counts, and all three stock states. Internal meal-plan recipes remain available to their API users but do not appear in this overview. The web list and gallery support ingredient search and stock filters. The list supports sorting and an optional desired-servings column. Gallery pictures use authenticated requests.
- Recipe preferences expose the legacy side-by-side setting, with its enabled default. The page selects the first normal recipe and supports the legacy `recipe`, `search`, `status`, `tab`, and `embedded` query fields. It saves the list or gallery choice under `recipes_last_tab_id`. When side-by-side display is disabled, selection opens a full-screen dialog. Closing through the Recipes link preserves filters and restores focus. Closing during loading also prevents a late response from opening the dialog again. On phones, an explicit recipe selection waits for the recipe data before it scrolls and moves focus.
- Recipe consumption requires confirmation and shows the legacy partial-stock and single-unit-check rules. Shopping confirmation lists missing ingredient positions from Python, including nested and repeated rows. Each row starts checked. Unchecked rows supply `excludedProductIds` to the compatibility shopping route. Cancellation makes no stock or shopping write. Escape closes the confirmation, keeps an expanded recipe open, and returns focus to the action button.
- Recipe printing includes every nested card, with each included recipe starting on a separate page. It prints pictures, ingredient amounts, notes, costs, and preparation while it hides navigation, lists, editors, and stock-status text. Long preparation text can span pages. Printing leaves normal full-screen mode before it calls the browser printer. A recipe opened in a dialog stays open after printing. Print colors remain readable with a saved dark theme.
- Recipe copy reads the new ID from the Python response and selects it at `/recipes?recipe=ID`. It clears prior filters, closes an open recipe dialog, and keeps the configured path prefix. The side-by-side view displays the copied recipe; list-only mode selects its row. This also works when the source is an included recipe.
- Recipes can add meal-plan entries from the list, gallery, or reader. The form starts with the local date, the selected normal recipe, one serving, and the first section in the saved sort order. It permits a different recipe, date, section, and fractional serving count. Servings and section choices remain available when the form is reopened on the page. The date and recipe reset on reopening. The minimum and step use the saved amount precision. Successful writes use the Python compatibility route and refresh meal data. Failed saves retain input for retry. The meal-plan feature flag controls these actions.

Full Python parity is not complete. Open work includes further configuration options, translated web text, remaining form and meal-plan behavior, recipe code downloads and labels, custom recipe columns, and saved table options. More saved preferences still need their web effects. Camera decoding in the new recipe meal-plan form still needs a browser check. Test results must identify the runtime and selected cases.

## Verification

On 2026-10-27, the full reference comparison passed on Python commit `b91d908` in `Europe/Bucharest`: 1,850 tests passed and 56 were skipped. The release image also passed HTTP checks for startup, catalog, stock, undo, settings, custom fields, files, calendar, the API specification, and profile access. The image had no PHP executable. These results cover the checked cases; they do not prove complete web feature coverage.

On 2026-10-28, the same commit passed the full reference comparison in `UTC`: 1,850 passed and 56 skipped. The normal Python test run passed 1,008 tests and skipped 1,062 cases that required other test environments. The disabled-feature comparison also passed both selected cases.

The latest full comparisons on Python commit `e9a1b62` passed in both `Europe/Bucharest` and `UTC`: 1,862 tests passed and 56 were skipped in each run. The release image passed the HTTP checks, including escaped barcode product selection and the new web language endpoint. It had no PHP executable. The stock aggregation case stays two days from the date boundary; separate cases check the date-boundary rules.

Language checks passed 70 frontend tests and five Python endpoint tests. Formatting, lint, type checks, and the web build passed. Browser checks covered German and Hebrew settings, saved numeric values, desktop text direction, and the Hebrew mobile menu. These checks do not establish complete translation coverage.

The appearance changes passed 93 frontend tests. Browser checks covered saved light and dark modes, the `24:00` schedule value, and a 390-pixel phone view. The language check also passed in that phone view. The menu stays outside the closed view after a direction change and opens from the correct side. Test settings were restored after these checks.

The product-preset changes passed 95 frontend tests, formatting, lint, type checks, and the web build. Browser checks saved all six presets, created a product, and checked the values in the Python database. The saved due-days value remained `-1`. The preset form also fit a 390-pixel phone view. The test product was removed and the prior settings were restored.

The production web image at `95bbe28` also passed a browser check with the `/house` path prefix. Nginx served the built assets and forwarded requests to the Python API image at `e9a1b62`. Saved product presets survived a reload. German text and the saved night mode worked through that prefix. Neither image had a PHP executable.

The header clock passed 66 recorded format cases for the 33 legacy languages. An additional comparison checked 11,088 combinations of language, month, weekday, and hour against the pinned Moment 2.30.1 output; all matched. The app uses Moment 2.31.0 and retains the older Catalan and Ukrainian apostrophes in clock text. The package audit reported no vulnerabilities. All 162 frontend tests, lint, formatting, type checks, and the web build passed. Browser checks covered live updates, saving and disabling the setting, and English and German at desktop and phone sizes. Test settings were restored.

The formatted-content and full-screen changes passed 14 selected Python tests and all 170 frontend tests. Formatting, lint, type checks, and the web build passed. The package audit reported no vulnerabilities. The refresh regression failed with the earlier refresh code at the expected changed stock value and passed with the correction. Content tests check domain access, formatted output, script removal, encoded literal text, iframe isolation, missing records, and preservation of saved values. Screen-on tests check visibility, setting changes, rejected and late requests, removal, and the actual legacy video method.

Browser checks covered direct full-screen links, formatted recipe and equipment text, keyboard exit, desktop and phone PDF views, and controls during long-page scrolling. The browser's native screen-lock API acquired a lock in full-screen mode and released it on Escape. The saved always-on setting also acquired a lock outside a card. These checks confirm browser requests and lock release; they do not check physical display sleep.

Both release images built. The Python image passed the HTTP checks, including both formatted-content routes and saved-description preservation. The production web image passed the recipe, clock, scroll, and native screen-lock checks through `/house`. Checked API and asset requests used that prefix. Neither release image had a PHP executable. Browser fixtures were removed, test settings were restored, and the temporary release containers and network were removed.

The included-recipe repair passed nine selected Python integration tests and all 172 frontend tests. Formatting, lint, type checks, and the web build passed. The Python tests cover nested card order, shared child recipes, separate ingredient rows, converted amounts, single-unit checks, groups, notes, stock and shopping amounts, access checks, and safe preparation output. The frontend tests cover full unit names, keyboard selection, temporary check marks, saved servings, and ordered saves before native consumption. The saved-serving regression failed with the earlier page: it showed `1` when the saved value was `4`. It passed after the correction.

The recipe release images built and passed their checks. The Python image passed HTTP checks for nested recipe cards and safe preparation output. The production web check covered desktop and phone views through `/house`, included preparation, and saving the ingredient checkbox setting through the preference form. The browser then cooked a recipe that needed 200 grams with 50 grams in stock. Python recorded consumption of 50 grams and the remaining stock was zero. Neither release image had a PHP executable. Browser fixtures were removed, test settings were restored, and the temporary release containers and network were removed.

The recipe overview changes passed ten selected Python integration tests and all 177 frontend tests. Formatting, lint, type checks, and the web build passed. Tests cover normal recipe selection, all three stock states, ingredient search, sorting, saved gallery selection, authenticated pictures, legacy query fields, embedded views, and dialog closure during loading. The overview test failed with the previous page because the selected recipe was absent beside the list. The dialog close test also failed before its correction. Both passed after the changes.

The Python release image passed HTTP checks for the overview, all three stock states, nested cards, safe preparation output, and the earlier release checks. The production web image passed checks through `/house` for list and gallery display, side-by-side columns, saved preferences, authenticated gallery pictures, and dialog closure with filter and focus preservation. Checked API and asset requests used the prefix. Neither final image had a PHP executable.

Visual checks covered the 1280-pixel desktop view and the 390-pixel phone list and gallery. The phone table now preserves short words. A separate phone check found that an explicit recipe link scrolled before its data loaded. After the correction, the loaded recipe started at the top of the view, held focus, and caused no page overflow. All seven recipe tests passed again, as did formatting, lint, type checks, and the release build. Final visual captures used an isolated Chromium container. The scrolled-page capture did not render correctly, so the selection position was checked through the browser DOM.

The shared picture fixture was replaced with a valid PNG. The old fixture had an invalid checksum, which release libgd rejected. Both Python test APIs then returned the valid image successfully, and the release gallery displayed it. This was a test fixture repair. Browser test records were removed, prior settings were restored, and the temporary release containers and network were removed.

The recipe action changes passed ten selected Python tests and all 178 frontend tests. Formatting, lint, type checks, and the web build passed. The two action tests failed with the previous reader because its confirmation dialogs were absent. The Python presentation test failed with the previous response because it had no missing-ingredient list. The repaired tests check confirmation before a write, cancellation, fresh choices after reopening, exclusions from repeated rows, nested ingredient positions, and ordered serving saves. A final run of all eight recipe tests also passed.

Both action release images built. The Python image passed the release HTTP checks, including empty and populated missing-ingredient lists. Neither image had a PHP executable. Production web checks through `/house` covered both confirmations inside a full-screen recipe. Escape closed only the confirmation and restored action-button focus. Cancellation left stock and shopping data unchanged. With Flour unchecked, the shopping request saved only three units of the nested Pepper ingredient. Confirmed consumption then booked the two available Flour units and retained all five units of the check-only ingredient. Desktop and 390-pixel phone captures showed the confirmations and their buttons within the screen. The phone page had no horizontal overflow. The consumption capture used isolated Linux Chromium after the first browser capture failed. Both browser sessions, all three temporary containers, and their network were removed. The local Python test server was restarted and its new recipe response was checked.

The print and copy changes passed all 181 frontend tests, formatting, lint, type checks, and the web build. The three new cases failed against an isolated copy of the previous code: its reader had no Print button, and copying did not select the returned ID in either display mode. The print test checks that full-screen state, scroll locking, and page isolation are cleared before the browser print call. Copy tests check the returned ID, selected row, new card, filter reset, and closure of an open dialog.

The final production web image passed browser checks through `/house` with the Python action release image. A direct recipe and a recipe dialog each produced a four-page PDF. Both documents retained all 22 preparation paragraphs, the final step, the authenticated picture, ingredient amounts, notes, and the included sauce on its own page. PDF text checks excluded list and editing controls. Visual checks covered the first and included-recipe pages. The saved inline dark color scheme initially made page margins dark; the final print rule overrides it, and the final page margin was white. Printing a direct full-screen recipe cleared its hash and scroll lock. Printing a dialog kept that dialog open. The 390-pixel phone controls fit the page.

The release browser copied the included sauce in list-only mode and selected its saved copy. It then copied the main recipe in side-by-side mode and displayed the new card. The copied preparation, ingredient, and nested recipe were retained in Python. Checked API requests kept the `/house/api/` prefix, and neither release image had a PHP executable. The browser session, three temporary containers, and their network were removed.

The recipe meal-plan changes passed all 184 frontend tests and eight selected Python tests. Formatting, lint, type checks, and the web build passed. Both positive meal-plan cases failed against an isolated copy of the previous reader because its controls were absent. The new tests check the local date, selected recipe, ordered sections, initial focus, retained choices, required date, fractional servings, the compatibility request fields, save errors, retry, and the feature flag. A lifecycle test also found that removing the page with a form open could retain a full-screen scroll lock. It failed with `overflow: hidden` before the shared dialog cleanup correction. All 22 recipe, camera, and full-screen cases passed after the correction. The final 14 recipe cases also passed after the payload checks were made independent of JSON field order.

The production web image passed meal-plan checks through `/house` with the Python action image. The form used the selected recipe, today's local date, one serving, and the first section by sort number. With amount precision set to two places, its minimum and step were `0.01`. Desktop and 390-pixel phone captures showed all fields and both action buttons within the dialog. After entry through the native date control, Python saved `2027-04-07`, the changed recipe, `0.5` servings, section `2`, and type `recipe`. Reopening retained servings and section and reset the date and recipe. Escape preserved the underlying full-screen recipe and restored focus to its action button. Neither release image had a PHP executable. The browser session, three temporary containers with their test records, and their network were removed.

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
