---
version: 1
slug: "frontend-app-tsx"
primary_target: "frontend/App.tsx"
related_targets: ["frontend/screens/Stock.tsx","frontend/screens/Shopping.tsx","frontend/screens/Cooking.tsx","frontend/screens/Household.tsx","frontend/screens/Catalog.tsx","frontend/screens/Nutrition.tsx","frontend/ui.tsx"]
---

Scope: the whole Native Shell web client (shell, Stock, Shopping, Meals, Chores, Settings, Review). Mode: Operate.

Audience and job: the household owner. Phone for quick lookups in the kitchen and shopping-list mode in the shop; desktop for planning. Routine edits increasingly arrive from assistants over MCP, so pending review must stay visible.

Constraints: NSH 0.4.0 TSX elements only; keep every workflow, label and test behavior; keep business logic in the API.

Rejected in direction rounds: themed metaphors (seed packets, shelf tickets, departure boards), heavy condensed caps, retro print, saturated colour everywhere, AI-image comps.

## Direction contract

THESIS: A precise, near-monochrome household tool whose freshness ruler shows the week's pressure on one line; it refuses both the Bootstrap admin table and the playful food app.

OWN-WORLD: Near-white #fafaf9 ground, white surfaces, near-black ink #0c0d0e, one fine neutral scale, 1px hairlines. One saffron accent #e8a100 used sparingly: selection marker, primary fill with dark text, focus ring. Red only for expired or overdue, amber text for due soon. Geist at 400/500/600, sentence case, tabular numerals. Line icons at 1.5px stroke.

STORY: The owner sees what to use first, acts in one tap, and trusts amounts and dates to be exact. Assistant changes wait in Review until approved.

FIRST VIEWPORT: Desktop has a 232px rail with the mark, Stock, Shopping, Meals and Chores with counts, and Review and Settings at the foot. The work area opens with a 24px title and count, search with a ⌘K hint, and a saffron Purchase button. Below that sits the freshness ruler panel (30 days, today marked, product markers hanging on stems, expired zone to the left, later items to the right), then a segmented filter, then hairline rows with a quiet Use action. Phone has a top bar with the title, Purchase and Review, a 14-day ruler, scrolling chips, 64px rows and four bottom tabs.

FORM: Quiet Precision, fused from the monochrome product challenger and chosen by the user over three grounded directions in re-roll round 1. seed: da5b84aa5a8c6598

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Reference: .impeccable/mocks/round2/precision-desktop.html and precision-phone.html (approved sketch).

## Cited adaptations (finish review, 2026-11-09)

- No ⌘K or "P" key hints: NSH 0.4.0 has no window-level key handling (only `onKeyPress` on a focused Input), and the contract forbids a hint that isn't wired. Search and Purchase stay unhinted.
- Rail and tab counts are on Shopping (items left on the default list) and Chores (overdue plus due today), matching the approved sketch. Stock's pressure lives in the freshness ruler, and Meals has no backlog to count. Review keeps the one saffron count.
- The phone keeps a slim brand bar holding Review (with its pending count) and Settings. Settings has no other phone entry because the four bottom tabs are full. Each screen's title row carries its own primary action, so the bar can't also host a title at 390px.
- Amounts are shown as a tabular figure followed by a muted unit word. The API's quantity units have no abbreviation field, and inventing `g`/`ml` client-side would mislabel user-defined units.
- Settings on phone uses a "Record type" picker row because an existing test presses "Record type". Meals' view tab is labelled "Week".
