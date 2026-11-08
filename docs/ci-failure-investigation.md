# Retired CI failure investigation

The [historical CI run](https://github.com/TudorAndrei/grocy-next/actions/runs/42504755970) tested commit `59ddfea`. CI was subsequently removed with the old React frontend. This investigation does not restore either.

## Findings

- The prefixed web-resource job failed with `Native login targets escaped the public URL rules`. Its checker compared the complete login-context response with a two-field dictionary. The API also returns `browser_session_supplied`, which the existing API owner explicitly tests. The obsolete checker was stale; the error does not establish incorrect login URLs.
- Both PHP-reference jobs were cancelled, but each logged 71 passes followed by a failure marker. The matching 72nd collected case is `test_reference_native_thermal_connector_errors[empty-path]`. Reproducing it with PHP 8.3.35 fails: the reference returns `Path cannot be empty`, while Python returns the canonical PHP 8.4 diagnostic `Path must not be empty`. Both return the required HTTP 500. The original case passes with PHP 8.4.26.
- The backend job passed its static checks and was cancelled during the test suite. Its available test progress contains passes and skips, with no failure marker. Cancellation is not a complete-suite pass. No further backend failure is established by those logs.

## Repair

The existing printer-connector owner now checks the original PHP diagnostic against its reported runtime version and independently requires Python's exact canonical PHP 8.4 diagnostic. The HTTP status assertions and exact cross-backend comparisons for missing-parent and network errors remain. Production API code is unchanged. This follows the existing runtime-aware error assertions for chore operations.

The removed web-resource checker is not restored. The existing login-context API owner remains the source of regression coverage for public targets and cookie presence.

## Validation

Before the test repair, actual PHP 8.3 reproduced one failure and one pass, stopping at the empty-path case. After repair, all 23 thermal-printer cases passed in each combination of PHP 8.3.35 / PHP 8.4.26 and UTC / Europe/Bucharest, using the checksum-pinned original Grocy 4.5.0 release. Each selected run exited zero with no skips; the remaining 2,078 differential cases were deselected. The seven existing login-context cases also passed. The two dependency deprecation warnings remain visible in the logs.

These are scoped follow-up runs, not a new complete Python or PHP suite. The earlier certification counts retain their original candidate attribution. No missing printer functionality or production API regression was found in this investigation.

To repeat the thermal selection with a chosen PHP executable and its required modules:

```sh
GROCY_USE_NATIVE_PHP=false PYTEST_ADDOPTS='-k native_thermal' \
  uv run --project backend python scripts/check-reference.py \
  --php /path/to/php --timezone UTC
```
