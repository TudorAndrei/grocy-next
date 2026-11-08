# Python API parity status

## Completion scope

The completion target is the Python implementation of the pinned Grocy 4.5.0 API. The API is the core product and supports independent clients. PHP Grocy is the behavioral reference, not a production dependency.

Independent clients consume this API; future cross-platform UI work will use Native Shell. The previous React client and GitHub Actions CI have been removed. Native web-page/template equivalence, browser layout, cameras, torch controls and physical printers are outside this completion target. Printer API payloads, webhooks, transport errors and file/code output remain in scope. Additional v2, nutrition and MCP features retain their regression tests but do not substitute for a missing Grocy API operation.

## Finite acceptance

The baseline contains 86 OpenAPI method/path operations and 33 listable exposed entities. All have Python implementations. Implementation coverage and behavioral certification are reported separately; route registration alone does not prove parity. The completion percentage is the fraction of the 21 fixed acceptance gates verified, with all mandatory gates required for release.

- [API operation inventory](../contracts/api-parity-status.json): exact handlers, primary behavioral owners, acceptance classes and concrete evidence gaps.
- [Release acceptance gates](../contracts/api-release-gates.json): 21 fixed API-only gates with explicit profiles and evidence requirements.
- [Certification results](../contracts/api-certification-results.json): actual profile counts, skip classifications, unchanged-production composition and artifact hashes.
- [Compatibility details](compatibility.md): historical and scoped implementation evidence; its broader frontend checklist does not redefine this API-only scope.

Completion requires all 21 API gates to close against the current candidate or identical relevant input hashes. A new case expands the checklist only when a concrete reproducible API discrepancy is found. The required test profiles are finite:

1. Complete normal Python suite with `GROCY_USE_NATIVE_PHP=false`, plus backend/scripts lint, formatting and type checks.
2. Complete differential suite against actual checksum-pinned PHP Grocy in UTC and Europe/Bucharest.
3. Existing seven-disabled-feature profile in both time zones, with its selection/deselection explicitly reported.
4. The existing API auth, raw HTTP, configured-path, input/error, storage/partial-write, files/images, printing and system/configuration acceptance classes.
5. A current Python API release image or relevant unchanged-image evidence, followed by source/result reconciliation and owned-service cleanup.

Case groups reuse full-suite evidence rather than running the same tests again for every gate. Browser/device checks cannot prevent API-only completion. Required API dependencies or failing API tests remain blockers until resolved; skips are not passes.

## Current certification

**Complete: 21 of 21 mandatory API gates verified (100%).** The independent final audit passed 40 checks with no blockers. All 86 native operations and 33 listable entities are verified within the declared acceptance scope. Owned certification runs have finished and reference-server cleanup is recorded.

The recorded certification predates removal of the standalone frontend, CI workflow and UI-only scripts. That cleanup does not change the Python API implementation or tests. Its historical source/evidence hashes remain attributed to the certified candidate; current local verification uses the API-only commands in the README.

A later [investigation of the retired CI run](ci-failure-investigation.md) repaired one differential test's PHP-version-dependent diagnostic assertion. API production code remains unchanged. All 23 thermal-printer cases passed with PHP 8.3 and 8.4 in both required time zones; seven existing login-context cases also passed. These selected follow-up results supplement the historical certification rather than replacing its full-suite counts or frozen test hashes.

The final collection contains **2,559 Python test cases**. All certification runs below finished successfully with `GROCY_USE_NATIVE_PHP=false`:

| Profile | Passed | Skipped | Deselected |
| --- | ---: | ---: | ---: |
| Complete normal Python suite, before the final test-only additions | 1,382 | 1,137 | 0 |
| Complete actual PHP differential suite, UTC | 2,005 | 56 | 0 |
| Complete actual PHP differential suite, Europe/Bucharest | 2,005 | 56 | 0 |
| Disabled-feature profile, each time zone | 2 | 0 | 2,059 |
| Strengthened stock/shopping owners, each time zone against PHP | 25 | 0 | 2,044 |
| Native localization owner, each time zone against PHP | 36 | 0 | 2,065 |
| Final changed owners, normal Python profile | 10 | 51 | 2,040 |

The two final test files strengthen existing owners: inventory changes stock from 2 to 4, bulk shopping actions assert saved quantities and list selection, and native localization covers all 33 pinned catalogs. Production API inputs are byte-identical to the complete-suite candidate. Certification composes those complete runs with the executed changed owners; it does **not** claim one complete execution of the final 2,559-case collection. Ruff, formatting and type checks also passed after application.

The normal suite's skips are 1,079 optional PHP comparisons, six PHP template-cache checks, 49 interpreter-output checks and three old PHP-adapter integration checks. Actual PHP profiles cover the comparisons. Their 56 skips are one separately executed disabled-feature case plus the six template-cache and 49 interpreter-output checks. PHP runtime/template mechanics and the old adapter are outside native Python API acceptance. The final selected normal profile's 51 reference-only skips are covered by the separate PHP owner runs. No unexplained required API skip remains. Dependency deprecation warnings remain visible in the logs.

The first restricted-runner attempt stalled in Starlette TestClient startup. The same exact case with admitted dependencies passed outside that runner, while a controlled restricted run reproduced the startup stall and captured its stack. Both owned stalled processes were terminated before certification continued in the admitted environment. This is recorded as test-environment admission evidence, not an API implementation failure or a passing suite.

No missing native API handler or reproduced behavior discrepancy remains in the pinned acceptance scope. The three direct state-assertion gaps are resolved by the strengthened owners. Release image evidence is reused only where relevant production inputs match: the current image has direct prefixed-path evidence; older root/literal-path observations retain their original image identity and an explicit native-input comparison.

The operation and gate ledgers contain the final verification state, scoped evidence paths and hashes. This certifies the finite Grocy 4.5.0 API acceptance contract, rather than claiming every possible input or third-party client has been tested. Native Shell is the chosen direction for future clients; no UI migration is part of this certification.

## Running the PHP oracle

From the repository root:

```sh
GROCY_USE_NATIVE_PHP=false uv run --project backend python scripts/check-reference.py --timezone UTC
GROCY_USE_NATIVE_PHP=false uv run --project backend python scripts/check-reference.py --timezone Europe/Bucharest
```

The runner verifies the original release checksum, creates disposable Grocy data, starts the actual PHP server, runs the Python differential owners and cleans up the server. An existing verified archive can be supplied with `--release`; `--php` selects an executable with the required modules. `--dry-run --output json` admits the runtime before test execution.

The reference owners compare responses, status/error behavior and relevant database/file side effects. Running Python with `GROCY_USE_NATIVE_PHP=true` would instead exercise the old PHP adapter and does not certify the Python implementation. PHP, GD/libmagic and LDAP dependencies belong to the test environment where needed; PHP remains absent from the production API image.
