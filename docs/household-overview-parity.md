# Household overviews and preferences

The reference is Grocy 4.5.0, commit `21aa5eab218c8466f90729154cb293fffbe10c21`. This note describes the native household settings controls and the effects their overview callers must preserve. It does not establish complete overview parity.

## Native settings pages

| Page | Reads on opening | Writes on a valid change | Default | OK destination |
| --- | --- | --- | --- | --- |
| `/choressettings` | `chores_due_soon_days` | ` chores_due_soon_days` (one leading space) | `5` | `/choresoverview` |
| `/batteriessettings` | `batteries_due_soon_days` | ` batteries_due_soon_days` (one leading space) | `5` | `/batteriesoverview` |
| `/taskssettings` | `tasks_due_soon_days` | `tasks_due_soon_days` | `5` | `/tasks` |
| Chore tracking-button checkbox | `chores_overview_swap_tracking_buttons` | `chores_overview_swap_tracking_buttons` | `false` | `/choresoverview` |

The number controls are required integers with minimum zero and step one. Values remain strings in the setting write. The native number picker adds or subtracts one, permits an invalid visible draft, and saves only a valid change. Typing commits on the number input's native change event, rather than saving each intermediate keystroke. The checkbox writes a boolean. There are no Save or Reset buttons on these pages and no page-specific query parameters that select or override a preference.

All writes use `PUT /api/user/settings/{key}` with `{ "value": ... }`. The shared native change handler checks input validity, reads the literal `data-setting-key`, and calls `SaveUserSetting`. That helper uses loose equality to suppress unchanged values and updates its page-local value before sending the request. A failed write therefore leaves the current control and page-local value changed; the same unchanged value is not automatically retried.

The leading spaces are a pinned defect in the chore and battery settings templates. Neither the shared handler nor the API helper trims the key. The overviews continue to read the canonical keys without spaces, so changing those number controls does not change their due-soon threshold. Reopening the settings page displays the canonical value again. The task settings key has no space, so a successful task settings change affects its overview after navigation. Tests must distinguish these behaviors instead of treating an alias write as an effective preference change.

## Overview effects

The canonical due-soon setting controls the corresponding controller's upcoming interval, filters and row highlighting. Zero hides due-soon filters/highlighting. Chore and battery settings preserve their defective alias writes; canonical values may still come from defaults, configuration or another supported settings caller.

The chore settings checkbox initializes through the browser's `BoolVal`, which accepts `true`, `1`, `"true"`, `"1"` and `"on"` case-insensitively. The overview template uses PHP `boolval` instead: nonempty strings such as `"false"` and `"off"` are true there. With swapping enabled, the primary action tracks now and the secondary action tracks the next schedule; otherwise the primary action tracks the next schedule and the secondary action tracks now. Do not normalize the overview's PHP behavior to the settings checkbox's browser rule.

Table column visibility, order, grouping and saved filters belong to the individual overview table state. These settings pages contain no additional controls for them.

## Source and evidence

The controls are defined in `views/choressettings.blade.php`, `views/batteriessettings.blade.php` and `views/taskssettings.blade.php`; the corresponding `public/viewjs/*settings.js` files initialize their canonical reads. Defaults are in `config-dist.php`. The shared autosave and duplicate-write behavior is in `public/js/grocy.js` (`.user-setting-control`, `SaveUserSetting`), with `BoolVal` in `public/js/extensions.js`. Overview controllers consume the canonical due-soon keys, while `views/choresoverview.blade.php` selects tracking-button meanings with PHP `boolval`.

The initial router-test baseline for all three settings URLs rendered Not Found before their native routes were added. `frontend/tests/household-settings.test.tsx` owns the settings controls and their persistence/navigation contracts. Each overview suite must also exercise the corresponding visible effect. HTTP fixtures demonstrate frontend request and rendering behavior; they do not establish database persistence or real-browser/device equivalence.

On the shared working tree for this increment, all 17 settings cases passed. These cover defaults and native destinations, change-only autosave, exact key spellings and value types, validity and number controls, duplicate suppression, failed-write drafts, checkbox initialization and disabled features. Integration cases navigate into the real overview routes: chore and battery alias writes leave the canonical due-soon option visible and reopen at the canonical value; task zero removes its due-soon option and reopens at zero; changing the canonical chore swap boolean changes the primary tracking action while retaining the raw-string BoolVal/PHP distinction. Owned-file lint, formatting and whitespace checks passed. No new real-browser or release-image comparison is claimed.

## Operational table sources

The native operational pages are `views/choresoverview.blade.php`, `views/batteriesoverview.blade.php` and `views/tasks.blade.php`, with their same-named files under `public/viewjs`. Initial row metadata and due highlighting come from `ChoresController`, `BatteriesController` and `TasksController`; quick actions use the compatibility APIs. The Python contexts are `/api/v2/chores/overview`, `/api/v2/batteries/overview` and `/api/v2/tasks/overview`. They authenticate readers without granting unrelated user-directory access or changing write permissions.

The overview suites own row, filter, custom-column, menu and partial-refresh behavior. Chores invalidate cached table cells after `Grocy.FormFocusDelay` (500 milliseconds); batteries leave their cached cells unchanged after charge. Hidden chore assignment IDs remain unchanged even when the visible assignee changes. Today rows initially carry a due-soon token, while refreshed chore rows carry only the today token. The battery refresh retains an existing info class while changing warning/danger classes. Null battery dates compare as an empty string in the initial PHP template but are invalid dates in browser counters.

Task completion with Show done unchecked and deletion remove DOM nodes without removing their cached DataTables entries. A later draw can restore them. Completion with Show done checked retains a disabled Complete action, while a row initially loaded as done has Undo. Undo reloads the page. Delete does not refresh counters. The source Clear handler triggers an event named `checked` rather than unchecking Show done; the checkbox and URL remain unchanged. Bare flags and explicitly empty flags have the same server inclusion effect and different browser checkbox effects. Raw history query text is required to retain that distinction when the router would otherwise normalize it.

`views/components/chorecard.blade.php`, `batterycard.blade.php` and their JavaScript components own one retained card per page. Closing a card or choosing another record does not cancel its callbacks; late replies update shared fields in completion order, including while hidden. Card Edit links enable after a successful read regardless of the row menu’s separate master-data permission. Owner departure and successful table reset discard that memory. `BeginUiBusy` changes the cursor and does not lock unrelated controls or serialize actions.

The native row menus download `/chore/{id}/grocycode` and `/battery/{id}/grocycode` with `download=true`. Journals preserve the selected ID and embedded table type; battery row editors are embedded, while card editors navigate directly. Printer payload reads and client webhook dispatch follow the owning page’s lifetime. Native browser downloads have their own lifetime.
