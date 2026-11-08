# Grocy Next client

The approved redesign is task-first. Stock, Shopping, Meals and Chores are the four
primary destinations. Setup and the long tail of record editing belong in Settings.
Nutrition review appears only when proposals are pending; nutrition history belongs
to the product. The implementation follows [Claude’s review](../docs/claude-client-design-review.md).

## Layout and hierarchy

- Desktop: 200px left navigation rail, 960px work area inside 32px gutters.
- Phone: 16px gutters, four visible bottom destinations and Settings in the header.
- Stock: 52px desktop rows, 64px minimum phone rows, title/location, due text, quantity,
  and one quiet Use action. Search includes products with no stock.
- Product details and editors: full-height 440px side sheet on desktop, full-width
  sheet on phones. The main submit action remains in the footer while content scrolls.
- Shopping: list first, one checkbox per row, checked items last; one batch put-away
  action. Partial failures remain on the list. Undo explicitly affects stock only.
- Meals: a navigable week and recipe search. Cooking requires a final confirmation.
- Chores: tasks, recurring chores and batteries grouped by urgency. Completion has undo.

## Tokens

| Role | Value |
| --- | --- |
| Page | `#f7f7f5` |
| Surface | `#ffffff` |
| Text | `#1b1d1c` |
| Secondary text | `#5e625f` |
| Accent | `#22603f` |
| Separator | `#e4e4e0` |
| Input/secondary control boundary | `#c9c9c3` |
| Error/overdue | `#b3261e` |
| Due soon | `#8a5a00` |

Platform sans serif: screen headings 22px semibold, row names 16px medium,
metadata 13–14px, controls 14px semibold. Keep units attached to quantities.
Use 4px spacing increments, 24px between sections and 8–12px inside related groups.
Controls have 8px corners, at least 44px targets and a 2px accent focus outline.

Use one filled primary action per view, white outlined secondary actions, and quiet
text actions in rows. Navigation and filters have their own selected treatment.
Use colour for selection and due/error meaning, without tinting every surface.
No decorative cards, gauges, charts or animation. Preserve NSH’s reduced-motion behavior.

## Behaviour

Never expose sentinel dates or numeric boolean flags as user-facing values. Date
pickers and shortcuts replace typed ISO dates. Hidden secondary controls must remain
reachable through the product sheet or Settings. Preserve drafts after errors and
refresh server state after mutations. API keys remain session-only; unauthorized
responses return to Connect. Network address guidance distinguishes localhost from
another device’s server. Keep household facts and domain validation in Python.
