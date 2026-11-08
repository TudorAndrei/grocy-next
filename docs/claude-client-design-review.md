# Grocy Next NSH client — design review and redesign proposal

This is advice from one Claude reviewer, not a multi-assessor audit, and it has no score. The proposal describes how the client should work. It does not implement anything.

**Evidence.** I read the frontend source and docs, and checked backend routes only where an action depended on them. In my own preview tab (demo key; navigation only, one Consume editor opened and cancelled) I saw Stock, Catalog and Shopping at 1440 px and 390 px, plus `/tmp/grocy-stock-*.png`. What I say about Recipes, Meal plan, Household and Nutrition comes from the **source only**. `.impeccable/*` belongs to the **deleted React client** and appears here only as prior art.

---

## 1. Diagnosis

The client is a GUI for the API's write endpoints, not a household tool. Every endpoint gets a button, and every button looks the same.

1. **Seven equal destinations, styled as buttons.** `App.tsx:40-48` gives Stock, Shopping, Recipes, Meal plan, Household, Nutrition and Catalog equal weight. At 390 px, "Meal plan" is clipped and four tabs sit off-screen (observed). Nutrition is an occasional review queue and Catalog is admin, yet both rank level with Stock. The tabs are `Action` buttons, so navigation, filters and commands all look identical.
2. **Every stock row repeats four equal buttons.** `Stock.tsx:240-255` adds Consume / Open / Transfer / Count to each row. Each row is about 150 px tall, so the 1440 px screen fits two products. On a phone, Count wraps onto a second line. Live, both demo rows read **0 Pieces / 0 Grams and still offer Consume and Open**. Transfer and Count are rare tasks, but they get the same space as eating something.
3. **Editors open far from the row that launched them.** Pressing Consume on row 1 inserts a 400 px panel *above the list*, under the filters (observed). That panel has a 30 px heading, a sentence about stock units, a product picker that is already filled in, and a "Save stock change" button. Shopping, Meal plan and Catalog use the same pattern: the form sits at the top and the data sits under it. On the phone, the Shopping form pushes the actual list below the fold (observed: "Your list is clear" at y = 842 of 844).
4. **The data is shown raw instead of meaningfully.** Rows show `Best before 2888-12-31`, which is Grocy's "never due" sentinel, and `No location` even when `product_default_location_name` is "Fridge" (live `/api/v2/stock/overview`). The "Due within 5 days" filter compares ISO strings. Household prints raw `due_date` / `next_estimated_execution_time` strings (inferred from source). Nothing is sorted by urgency.
5. **Typed dates and numeric flags.** "Best-before date (optional, YYYY-MM-DD)", "Calendar date (YYYY-MM-DD)" plus a "Load dates" button, "Freezer (0 or 1)", and chore `period_type` as free text (`Catalog.tsx:54,150`). This is database entry, not a kitchen interface.
6. **Shopping makes you confirm the same thing twice, and the list isn't the main thing on the screen.** "Mark bought", then a separate "Book purchase" for each item (`Shopping.tsx:386-416`). A list selector is shown even when only one list exists. The empty state says "Add a product above" even though Greek Yogurt is below its minimum, and nothing offers to add missing items.
7. **Product truth is hidden in Catalog.** Whole Milk exists in Catalog but is absent from Stock, because the overview omits products that are out of stock and not below their minimum. Stock search can't find it. A new product has to be created through the generic "Record type → Products → Add products" form, and that form shows foreign keys as plain choosers.
8. **Low-value text everywhere.** Each screen has a subtitle ("See what you have. Use what needs using."), a "Refresh …" button, and labels that repeat themselves ("Edit Greek Yogurt / Delete Greek Yogurt" as visible text). Success messages are a grey line that appears far from the row you acted on.

On colour: the problem is the mint-tinted neutrals on every surface and button, not the green accent. Nothing has hierarchy.

---

## 2. Information architecture

Organize the app around four household tasks. Product setup lives in context or in Settings.

| Destination | Contains | Replaces |
|---|---|---|
| **Stock** (home) | Needs attention + all products; product sheet | Stock, product parts of Catalog, Nutrition history |
| **Shopping** | Active list, check-off, put away | Shopping |
| **Meals** | This week's plan; Recipes as a second view | Recipes, Meal plan |
| **Chores** | Tasks, chores and batteries in one due-ordered list | Household |
| Settings (secondary) | Connection, locations, units/conversions, groups, stores, lists, task categories, equipment, generic records | Catalog |

**Review** is not a destination. When nutrition proposals are pending, a count badge appears on Stock and a one-line banner reads "2 nutrition changes to review". When nothing is pending, neither appears.

**Desktop (≥ 900 px):** a 200 px left rail with the wordmark, the four destinations, and Settings at the bottom. Content is capped at 960 px. The product sheet opens as a 400 px right panel and the list stays visible.

**Phone:** a bottom bar with the four destinations (56 px plus safe area). Settings sits behind a top-right button. The product sheet and editors are full-height sheets with the main action pinned at the bottom.

**Product sheet** (tap a stock row) is where all contextual product work happens: amount and entries by location and due date, actions (Use, Open, Count, Move), "Add to shopping list", product details (name, units, default location, minimum, default best-before days), and Nutrition (current values, revisions, restore). Generic CRUD stays only in Settings, as a fallback for the long tail.

---

## 3. Workflows

**Check what's available and due.** *Entry:* Stock, which is the landing screen after connecting. *Default:* a "Needs attention" group appears only when it has items: expired/overdue, then due within 5 days, then below minimum, ordered by date. Under it is "Everything", sorted alphabetically. Search covers **all products**, including out-of-stock ones, which show "Not in stock" and an Add purchase action. Due dates read as text: "Expired 2 days ago", "Due today", "Due in 3 days", "12 Mar". `2888-12-31` shows nothing. Location falls back to the default location with no "No location". *States:* loading uses skeleton rows, not "Loading…" above controls. If there are no products at all, show one sentence and an Add purchase button. If search finds nothing, offer "Create '‹query›'".

**Add a purchase, including a new product.** *Entry:* a primary "Add purchase" button in the Stock header (`a` key on desktop), "Add purchase" in the product sheet, or "Not in stock" search results. *Default:* one sheet. The product search field is focused. If you type a name with no match, "Create ‹name›" opens three inline fields (stock unit, default location, purchase unit = stock unit) prefilled from the last product created. That is enough for the `products` required fields. Amount has a unit suffix ("2 Pieces"). Best-before is left empty so the server applies `default_best_before_days` (`stock/service.py:101`), with the hint "Product default: 7 days". Chips set it explicitly: Today, +3 d, +1 w, +1 m, Never, Pick…. Location defaults to the product's location. *Steps:* search → amount → Enter. *Feedback:* a toast reading "Added 2 Pieces Greek Yogurt · Undo" (transaction undo). An "Add another" toggle keeps the sheet open for unpacking groceries. On failure the sheet stays open with values kept and the error shown beside the field.

**Consume / open / count / transfer.** *Use* is the only action on a row: a quiet "Use 1" button that books `quick_consume_amount` with one tap, an undo toast, and an optimistic amount update. It is hidden when amount = 0. *Use a different amount*, *Open* (only when `disable_open = 0` and amount > 0), *Count* ("Actually have: __"), and *Move* (only with stock in 2+ locations, prefilled source) live in the product sheet. Every result gets an undo toast for about 8 s. The last undo also stays reachable in the sheet.

**Shop and receive purchases.** *Entry:* Shopping. *Default:* the list is the screen. At the top is a single "Add item" search field with an inline quantity. The list switcher only appears when there are 2+ lists. Rows are a 48 px checkbox, the name, and the amount in the purchase unit. Tapping toggles `done` immediately and optimistically, and checked items sink to the bottom. If items are below minimum, an "Add 3 below-minimum items" action appears (`/api/stock/shoppinglist/add-missing-products`). *Receive:* when items are checked, a sticky bar shows "Put away 4 items". It calls the purchase endpoint per checked item and reports "4 added to stock" or "3 added, 1 failed: ‹reason›" with that row left in place. That's one confirmation, with no "Mark bought" then "Book purchase". *Real constraint:* the purchase route requires `done = 1` and takes no best-before, location or price (`shopping/service.py:273-293`), so stock gets product defaults. Say "Dates use product defaults" in the bar. Undoing a put-away restores stock but **not** the deleted list item, so the toast reads "Undo stock change". Per-item date entry at put-away waits until the API accepts it.

**Select and cook recipes; plan a meal.** *Entry:* Meals shows this week as seven days, with ‹ › instead of typed dates. *Plan:* "+" on a day opens recipe search, recipes you can cook now first (`missing_products_count = 0`), with servings defaulting to `desired_servings`. *Recipe detail:* ingredients marked have or missing, then the preparation text. Its actions are "Cook" (primary), which lists what it will deduct before consuming, and "Shop for missing". *Meal entries:* "Cooked" and "Shop for this". *Deferred:* note and product meal types, sections, recipe nesting.

**Complete household work.** *Entry:* Chores. *Default:* one list built from `/api/v2/tasks/overview`, `/chores/overview` and `/batteries/overview` (the client currently calls v1 `/api/tasks` etc.). It is grouped Overdue / Today / This week / Later / No date, each row showing a type hint ("Chore · every 7 days", "Battery · Smoke alarm"). There is one "Done" button per row and a toast "Recorded · Undo" using the existing undo paths. An "Add task" field takes the name plus due chips. Done tasks are hidden behind "Show completed". *Deferred:* chore assignment, rescheduling and equipment.

**Review external nutrition proposals.** *Entry:* the badge or banner. *Default:* a queue of cards, each showing the product, source and note, and a two-column **current vs proposed** table where changed values are bold and unknown values show "—". Approve (primary) or Reject. Conflicts appear as an inline warning above the buttons. History and restore live in the product sheet. They are not shown on a separate page with a "Nutrition product" chooser.

---

## 4. Visual direction

**Palette: neutral chrome with one accent.** Drop the mint tints entirely.

```
--page     #f7f7f5   --surface #ffffff   --line #e4e4e0   --line-strong #c9c9c3
--ink      #1b1d1c   --muted   #5e625f   --accent #22603f (primary buttons, selected nav, focus)
--danger   #b3261e (expired, destructive)  --warn #8a5a00 on #fbf1dc (due ≤ 5 days)
```

Green can stay as the accent if the owner likes it. It is not a requirement, and no "ok/fresh" status colour exists to clash with it. Rows with nothing wrong get no colour at all. Status colour appears only on the due label.

**Type.** Platform sans. Screen title 22/28 semibold (not 30). Row name 16/22 medium. Meta 13/18 in `--muted`. Amounts are right-aligned, 16 semibold, tabular numerals, with the unit in muted regular ("2 Pieces"). Drop all subtitles.

**Rows.** Single line on desktop, 52 px tall, separated by hairlines rather than cards.

```
Greek Yogurt                         Fridge   Due in 3 days     2 Pieces   [Use 1]
Rolled Oats                          Pantry   —               720 Grams   [Use 1]
```

On a phone, rows are two lines and 64 px tall:

```
Greek Yogurt                     2 Pieces
Fridge · Due in 3 days           [Use 1]
```

Long names wrap to 2 lines and then truncate. The amount and unit never wrap apart.

**Controls.** There are three levels:
- **Primary:** filled accent, at most one per view (Add purchase, Put away, Cook, Approve).
- **Secondary:** 1 px `--line-strong` outline on white.
- **Row/quiet:** text-coloured with no fill; on hover, a `#f0f0ec` background.

Filters are a segmented control or underlined tabs, not buttons. Navigation items are rail links, not buttons. Control radius is 8, sheet radius 12, and the focus ring is a 2 px accent at 2 px offset. Keep 44 px minimum targets, 48 px for touch-only rows.

**Spacing.** Use a 4 px base:
- 16 px phone gutter, 32 px desktop.
- 24 px between sections.
- 12 px row padding.

**Mobile ergonomics.** Primary actions sit in a bottom sticky bar inside sheets. Search goes at the top of lists. Nothing that matters should sit in the top-right corner. Use numeric keyboard hints for amounts.

From the old React client, keep the one-line rows, relative due chips, quick Consume and the review badge. Drop the caps, gauges, per-domain colours and the cobalt rail.

---

## 5. Implementation plan

**First three changes (these make it useful):**
1. **Rebuild the Stock rows and add the product sheet.** Single-line rows, relative due text, the 2888 sentinel hidden, default location as fallback, a "Use 1" quick action with an undo toast, and actions hidden at amount 0. Tapping a row opens the sheet holding Open/Count/Move/Add-to-list. Add the Needs-attention group. Remove the subtitle and the Refresh button.
2. **Collapse navigation.** Four destinations plus Settings, using a rail on desktop and a bottom bar on phones. Catalog moves into Settings. Nutrition becomes a badge and queue. Recipes and Meal plan merge into Meals.
3. **Make Shopping list-first.** One-tap check, batch "Put away N", add-missing, inline add, and the list chooser only when 2+ lists exist.

**Follow-up slices:** Add-purchase sheet with inline product creation and date chips → Chores merged list on the v2 overviews → Meals week view and the Cook confirmation → nutrition diff cards and product-sheet history → product details editing in the sheet → rewrite `DESIGN.md` to the tokens above (owner's call).

**Delete:**
- the four-button row actions and the "Refresh …" buttons
- page subtitles and the headings inside forms
- the stock-unit note (show the unit suffix instead)
- typed YYYY-MM-DD dates and "Load dates"
- 0/1 flags and free-text `period_type`
- the Record-type chooser as a primary surface
- `JSON.stringify` search

**Keep:**
- `remote()` and `operations()`
- forms that keep their values on failure
- transaction undo
- the key held in memory only
- plain-text rendering of HTML
- the generated types and 44 px targets
- delete confirmation, now in Settings and the product sheet

**Real constraints:**
- *API:* shopping purchase requires `done` and doesn't accept dates or locations. It works per item, so a batch means N requests with partial-failure handling.
- *API:* the overview omits out-of-stock products that aren't below minimum (a user setting), so full search must merge `/api/objects/products`.
- *API:* the required product fields are location and both units.
- *API:* undoing a shopping purchase doesn't restore the list item.
- *NSH:* the `nsh/base` controls are unstyled, so each control style is hand-built once in `ui.tsx`. `Select` is searchable.
- *NSH, not verified:* I did not verify NSH 0.4.0 support for overlay/sheet primitives, a native date picker, URL routing and the back button, or global key handlers. Check the NSH docs before committing to a shape. A sheet can be a positioned `View` if needed.

**Avoidable current choices:** the seven button-tabs, editors placed at the top of the screen, generic CRUD as the product editor, typed dates, the v1 household endpoints, and the tinted-everything palette.

---

## 6. Acceptance criteria

- **Sparse data:** with 0 products, Stock shows one sentence and Add purchase, with no filters or empty sections. With 2 products, nothing looks broken or padded.
- **Due display:** `2888-12-31` never appears. Expired, today and ≤ 5 days render as relative text with the right colour, and the rest show a short date. Needs-attention is sorted by date.
- **Zero stock:** a product with amount 0 offers no Use or Open. Out-of-stock products are findable through search.
- **Purchase:** from a product name that doesn't exist yet to a booked stock entry takes ≤ 4 interactions and needs no visit to Settings. Best-before can be left to the product default.
- **Consume:** using one item is one tap from Stock, with visible undo that restores the server amount.
- **Shopping:** checking an item is one tap. Putting away N checked items is one confirmation, with per-item failure reporting. At 390 px the first list item is visible without scrolling.
- **Navigation:** at 390 px all destinations are visible without horizontal scrolling. At 1440 px, at least 10 stock rows are visible.
- **Long content:** a 60-character product name and a "Kilograms" or "Milliliters" unit don't overflow or break the amount from its unit at 320 px.
- **Keyboard:** every action is reachable by Tab with a visible focus ring. Enter submits sheets and Esc closes them, returning focus to the row.
- **Session:** reload returns to Connect with the server prefilled. A 401 mid-session returns to Connect with a clear message and no lost draft text where feasible. Whether to offer an opt-in "Remember key on this device" for a kitchen tablet is the owner's decision.
- **Remote access:** the API is published on `127.0.0.1:8000` (`docker-compose.override.yml:6`), and the client defaults to `http://127.0.0.1:8000`. On a phone that address means the phone itself. Phone use over LAN is therefore an access problem, not a styling one. The Connect screen should explain this when a connection fails on a non-local origin, and should recommend the nginx origin (`:8080`, which proxies `/api`). Fixing the network configuration is outside this review.
