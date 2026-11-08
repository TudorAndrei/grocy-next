# Household master lists and overviews

The reference is Grocy 4.5.0, commit `21aa5eab218c8466f90729154cb293fffbe10c21`. Source paths below are relative to that reference. This increment separates master-data navigation from operational overviews; it does not establish complete household web parity.

## Reference behavior

| Entry point | Reference source | Behavior |
| --- | --- | --- |
| `/chores` | `controllers/ChoresController.php::ChoresList`, `views/chores.blade.php`, `public/viewjs/chores.js` | Master records ordered by name, active records by default. The presence of `include_disabled` includes inactive records, regardless of its value. Columns include Name, Period type, Description and configured custom fields. Add opens `/chore/new`; row Edit opens `/chore/{id}`. Delete and chore merge operate on selected master records. |
| `/batteries` | `controllers/BatteriesController.php::BatteriesList`, `views/batteries.blade.php`, `public/viewjs/batteries.js` | The same active/default and query-presence inclusion rules. Columns include Name, Description, Used in, Charge cycle interval and configured custom fields. Add and row Edit use `/battery/new?embedded` and `/battery/{id}?embedded`. The charge interval sorts numerically. |
| `/choresoverview` | `controllers/ChoresController.php::Overview`, `views/choresoverview.blade.php`, `public/viewjs/choresoverview.js` | Operational current rows with estimated/last tracking, assignment and due state. Primary tracking follows the next schedule unless the saved button-swap preference selects tracking now. Separate actions include tracking now, skipping, rescheduling, selected chore card, journal, Edit and Grocycode. Manual chores cannot skip a schedule. |
| `/batteriesoverview` | `controllers/BatteriesController.php::Overview`, `views/batteriesoverview.blade.php`, `public/viewjs/batteriesoverview.js` | Operational active current rows with Used in, last/next charge and due state. Actions include recording a charge, selected battery card, journal, embedded Edit and Grocycode. |
| Tracking cards | `public/viewjs/components/chorecard.js`, `public/viewjs/components/batterycard.js` | Both card Edit links are direct: `/chore/{id}` and `/battery/{id}`. Both journals are selected embedded URLs, `/choresjournal?embedded&chore={id}` and `/batteriesjournal?embedded&battery={id}`. Battery card Edit differs from its embedded master-list/overview-row Edit link. |

Both master-list scripts use `Show disabled` to navigate to the corresponding URL with or without `include_disabled`. Their Clear filter handler only clears the local search and unchecks the checkbox; it does not remove the URL parameter or reload the records. Consequently, already loaded disabled records remain after that handler. The controller tests query presence, while the initial checkbox script tests the query value's truthiness. Those are distinct reference rules.

Master-list Add/Edit/Delete controls and overview tracking controls have different permission boundaries. Feature-disabled routes must not expose the corresponding records through their page. The household editors and their complete field, save, retry, permission and embedded protocols require their own evidence.

## Verification scope

`frontend/tests/household-master-data.test.tsx` exercises real app routes and fetch responses. The initial baseline failed four cases for the intended reasons: the old `/chores?include_disabled=0` and `/batteries?include_disabled=0` pages read operational current rows and omitted inactive master records; both native overview URLs rendered Not Found.

The owner suite covers query-presence inclusion, default active filtering and Show disabled navigation, master Add/Edit destinations, operational overview booking and refresh, selected journal links, tracking-card Edit destinations, and feature-disabled entry pages. It supplements the editor, tracking and journal suites. Run results must identify the actual checked revision; initial baseline failures are not successful implementation evidence.

On the shared working tree for this increment, all 17 owner cases passed with `vitest run tests/household-master-data.test.tsx`. The test TypeScript configuration, owned-file lint and formatting checks, and diff whitespace checks also passed. These are router/DOM and HTTP-fixture checks; no real-browser or release-image comparison was performed for this owner suite.

The five additional owner cases cover delete cancellation/selected-ID deletion and filter reset, merge failure/details/retained selection/retry, and read-only controls. Further comparison remains for complete native overview scheduling and button preferences, assignments and due filters, rescheduling, code controls, raw checkbox query spellings, translated/custom columns, additional table/embedded lifetimes and real browser rendering. Retaining an operational Done/Charged action while separating page URLs does not prove the reference's complete schedule-tracking behavior.

## Subsequent operational increment

The separate [overview and preferences notes](household-overview-parity.md) cover the native operational controls added after the initial master-list slice. The master owner suite now has 26 cases: the additional table covers chores, batteries and task categories with bare, explicitly empty and `0` flags. Bare and `0` values check Show disabled; an explicitly empty value includes inactive rows while leaving the checkbox clear. Clear retains the included rows and URL, and a later toggle writes the bare native flag. The overview integration checks now open selected row menus and use the native tracking actions and resource routes. The earlier 17-case result remains historical evidence for that smaller slice.
