---
name: Grocy Next
description: Household pantry and home control surface, built as a shelf of labelled enamel canisters.
colors:
  cobalt: "#1d3a8a"
  cobalt-deep: "#142b6b"
  cobalt-soft: "#e7ebf7"
  cobalt-line: "#c4cde9"
  enamel: "#f3f4ef"
  surface: "#ffffff"
  surface-sunk: "#f7f8f4"
  ink: "#101318"
  ink-2: "#4a5061"
  ink-3: "#676d7d"
  line: "#dadee7"
  line-soft: "#eceef3"
  tomato: "#b8321b"
  tomato-fill: "#c8371e"
  tomato-soft: "#fbe8e3"
  mustard: "#865b00"
  mustard-fill: "#d9961a"
  mustard-soft: "#fbf0d8"
  green: "#276b44"
  green-fill: "#2e7d4f"
  green-soft: "#e2f0e7"
  violet: "#5a32a3"
  violet-soft: "#efe8fb"
  mark-stock: "#9db8ff"
  mark-shopping: "#f2b844"
  mark-home: "#86d6a6"
  mark-agent: "#cbb0ff"
  mark-system: "#b9c4e6"
typography:
  display:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "clamp(24px, 2.4vw, 32px)"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "0.03em"
    fontVariation: "'wdth' 125"
  numeral:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 800
    lineHeight: 1
    fontVariation: "'wdth' 125"
    fontFeature: "'tnum' 1"
  headline:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 800
    lineHeight: 1.45
    letterSpacing: "0.16em"
    fontVariation: "'wdth' 125"
  title:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.45
    fontFeature: "'tnum' 1"
  body:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "'tnum' 1"
  meta:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.45
  control:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.1
  label:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "0.14em"
    fontVariation: "'wdth' 125"
  tag:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "0.06em"
rounded:
  bar: "3px"
  tag: "5px"
  gauge: "7px"
  field: "8px"
  toast: "12px"
  plate: "14px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  row: "14px"
  inset: "18px"
  gutter: "20px"
  page: "28px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.surface}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "7px 16px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.cobalt-deep}"
    textColor: "{colors.surface}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.cobalt}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "7px 16px"
    height: "38px"
  button-outline-hover:
    backgroundColor: "{colors.cobalt-soft}"
    textColor: "{colors.cobalt}"
  button-sm:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.cobalt}"
    rounded: "{rounded.pill}"
    padding: "4px 11px"
    height: "30px"
  button-danger-quiet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.tomato}"
    rounded: "{rounded.pill}"
    padding: "7px 16px"
  button-danger-quiet-hover:
    backgroundColor: "{colors.tomato-soft}"
    textColor: "{colors.tomato}"
  button-disabled:
    backgroundColor: "{colors.surface-sunk}"
    textColor: "{colors.ink-3}"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "5px 8px 5px 14px"
    height: "34px"
  chip-selected:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.surface}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "8px 12px"
    height: "40px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.plate}"
  panel-head:
    textColor: "{colors.cobalt}"
    typography: "{typography.headline}"
    padding: "14px 18px 12px"
  tag:
    backgroundColor: "{colors.line-soft}"
    textColor: "{colors.ink-2}"
    typography: "{typography.tag}"
    rounded: "{rounded.tag}"
    padding: "2px 7px"
  tag-agent:
    backgroundColor: "{colors.violet-soft}"
    textColor: "{colors.violet}"
  badge-ok:
    backgroundColor: "{colors.green-soft}"
    textColor: "{colors.green}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
  badge-warn:
    backgroundColor: "{colors.mustard-soft}"
    textColor: "{colors.mustard}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
  badge-danger:
    backgroundColor: "{colors.tomato-soft}"
    textColor: "{colors.tomato}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
  gauge:
    backgroundColor: "{colors.enamel}"
    rounded: "{rounded.gauge}"
    height: "14px"
  gauge-low:
    backgroundColor: "{colors.tomato-fill}"
  nav-item:
    backgroundColor: "{colors.cobalt}"
    rounded: "{rounded.field}"
    padding: "8px 10px"
  nav-item-active:
    backgroundColor: "{colors.enamel}"
    textColor: "{colors.cobalt}"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.toast}"
    padding: "8px 8px 8px 16px"
  toast-error:
    backgroundColor: "{colors.tomato}"
    textColor: "{colors.surface}"
---

# Design System: Grocy Next

## Overview

### Creative North Star: "The Enamel Canister Shelf"

The app is a kitchen shelf of white enamel canisters with cobalt rims and black stencilled labels. Each product shows how full it is against its minimum, and each due item shows how many real days it has left. The cobalt rim is the shell of the whole app: the rail, the rule under each page title, the outline of every pill button, and the fill of every gauge. Inside that rim the ground is a warm off-white enamel and the data is black at full contrast.

Density is that of a working ledger, not a dashboard. Rows hold fixed furniture (name with meta, gauge or due bar, right-aligned amount, actions) so the eye can run down a column. Labels are stencilled: expanded, heavy, uppercase Archivo, used only to name things. Working text stays at normal width. State is carried by four fixed inks (tomato, mustard, green, violet) and never by decoration.

The build refuses the grey admin template: there are no stat tiles, no teal accent, and no card grids of repeated numbers. Depth is flat; only things that float above the page carry a shadow.

**Key Characteristics:**

- Cobalt rail and cobalt rules on an enamel ground; black lettering for data.
- Expanded 800-weight caps for labels only; normal-width Archivo for UI.
- Pill controls with a 1.5px cobalt outline; 14px plates for containers.
- Canister gauge and 14-day due bar as the two signature measures.
- Tabular numerals everywhere; amounts right-aligned with the unit beside.
- One fixed marker colour per domain on the rail and on row dots.

## Colors

A two-voice palette: one saturated cobalt for the shell against a warm enamel ground, plus four state inks that each come as ink, fill, and soft ground.

### Primary

- **Cobalt Rim** (`cobalt`): the shell. Rail and mobile tab bar ground, page-title colour, the 3px rule under page titles and in the command bar, pill outlines, primary button fill, selected chip and segment fill, gauge rim and fill, checkbox accent, focus outline, selection colour.
- **Deep Cobalt** (`cobalt-deep`): primary button hover, the ⌘K trigger well on the rail.
- **Cobalt Wash** (`cobalt-soft`): hover ground for outline buttons, segments, recipe rows, "more" links, the selected command result, and the 3px input focus halo.
- **Cobalt Hairline** (`cobalt-line`): outline of small buttons, hover border for inputs and chips, dashed border of empty states and of a gauge with no minimum, scrollbar thumb.

### Secondary (state inks)

Each state has three tokens: an ink for text (passes on white and soft grounds), a fill for bars and gauges, and a soft ground for badges, tags, and notices.

- **Tomato** (`tomato`, `tomato-fill`, `tomato-soft`): expired, below minimum, empty, errors, destructive actions, error toasts.
- **Mustard** (`mustard`, `mustard-fill`, `mustard-soft`): due soon (5 days or less), proposal conflicts, shopping list preview pills.
- **Green** (`green`, `green-fill`, `green-soft`): fresh (more than 5 days), OK badges, home-domain row dots.
- **Violet** (`violet`, `violet-soft`): the agent. Agent tags, another user's API-key tag, changed values in a proposal diff.

### Tertiary (domain markers on cobalt)

Light tints that read on the cobalt rail only: `mark-stock` (kitchen and stock), `mark-shopping`, `mark-home` (chores, tasks, batteries), `mark-agent` (review, activity), `mark-system` (settings). They colour nav icons; shopping and agent counts fill with their marker and carry `ink` text.

### Neutral

- **White Enamel** (`enamel`): page ground; active nav item ground; gauge track; the "lid" fill of buttons inside the cobalt basket bar.
- **Plate White** (`surface`): panels, inputs, outline buttons, chips, the command dialog.
- **Sunk Enamel** (`surface-sunk`): table header row, command-bar footer, disabled controls.
- **Black Lettering** (`ink`): all data: names, amounts, dates, field values. Also the toast ground and the minimum tick on a gauge.
- **Label Grey** (`ink-2`): field labels, meta lines under names, panel-head counts, leads.
- **Faint Grey** (`ink-3`): placeholders, disabled text, undone bookings, unselected command hints.
- **Plate Line** (`line`): 1.5px panel, input, and chip borders; table header underline.
- **Soft Line** (`line-soft`): row dividers, due-bar track, neutral tag ground.

### Named Rules

**The Cobalt Rim Rule.** Cobalt is structure, not decoration: rail, rules, outlines, primary fill, gauge. It never fills a panel or a large area on the enamel ground.

**The State Ink Rule.** Tomato, mustard, green, and violet only carry meaning (expired or low, due, fresh, agent). Text uses the ink token; bars use the fill token; grounds use the soft token. Never use a state colour as a brand accent.

**The Transit Marker Rule.** Each domain has one fixed marker: stock cobalt, shopping mustard, home green, agent violet. The same domain keeps the same colour on the rail, in tab-bar counts, and in row dots.

**The Datamatics Rule.** Data is `ink` at full contrast. Grey (`ink-2`, `ink-3`) is for labels, meta, and inactive states only.

## Typography

**Display Font:** Archivo Variable (self-hosted, wght 100–900, wdth 62–125%), with Archivo and system-ui fallback
**Body Font:** Archivo Variable at normal width (100%)

**Character:** One variable family in two widths. Expanded heavy caps act as stencilled canister labels; the normal width is a plain, dense working grotesque. Tabular numerals are on for the whole body.

### Hierarchy

- **Display** (800, wdth 125, clamp 24–32px, 1.05, +0.03em, uppercase, cobalt): page titles only, over a 3px cobalt rule. Balanced wrap.
- **Numeral** (800, wdth 125, 44px, 1; 36px under 720px; cobalt): the on-hand amount on a product page, beside the large gauge.
- **Headline** (800, wdth 125, 12px, +0.16em, uppercase, cobalt): panel heads. A trailing count or note in the head drops to 13px/500 normal width in `ink-2`.
- **Title** (700, 15px): row names (products, due items, shopping items). Recipes use 16px, proposal heads 17px/800. Shopping mode raises names and amounts to 17px.
- **Body** (400, 15px, 1.45, tabular): working text and inputs. Leads cap at 68ch.
- **Meta** (400, 12.5px, `ink-2`): the second line under a row name (location, minimum, unit, kind).
- **Control** (700, 14px, 1.1): button text; 13px on small buttons, segments, chips.
- **Label** (700, wdth 125, 10.5px, +0.14em, uppercase, `ink-2`): table column heads, panel sub-sections, diff-table heads. Rail group labels use 10px at +0.2em.
- **Tag** (700, 11px, +0.06em, uppercase, normal width): actor tags (YOU, AGENT, User #n) and status tags.

### Named Rules

**The Canister Label Rule.** Expanded (wdth 125) 800-weight type is only for names of things: the wordmark, page titles, panel heads, column heads, the stock numeral. Never set sentences, buttons, or values in the expanded cut.

**The Ledger Rule.** Every number is tabular. Amounts are right-aligned and bold, with the unit in the same line beside the number (for example "400 g", "4 pcs"). Never round or invent a value to fill a column.

**The Say-It-Once Rule.** A thing is labelled once. A panel head names the panel; rows do not repeat it, and a count goes in the head, not in a separate tile.

## Layout

- **Shell:** a fixed cobalt rail (236px) on the left holds the wordmark, the ⌘K trigger, and grouped nav (Today; Kitchen; Home; Agent; Settings). Main content sits to the right with 28px top padding, side padding clamp(20px, 3vw, 44px), and a 1440px content cap.
- **Page head:** title, optional lead, and actions right-aligned on the baseline row; a 3px cobalt rule closes the head with 22px below it.
- **Today:** two columns at 1.35fr / 1fr with a 20px gutter. Left: Running low, then Use first. Right: Shopping list, then Review and undo. Product detail and split views use 1.2fr / 1fr.
- **Rows:** fixed furniture per row. A stock row is name+meta / gauge (96–150px) / amount (84px) / actions (200px). A due row is name+meta / due bar / action. Row padding is 10–14px vertical, 18px horizontal (the panel inset), with `line-soft` dividers.
- **Rhythm:** 6px between pills and chips, 8px between buttons, 12–14px inside rows and fields, 18px panel inset, 20px between panels.
- **Breakpoints:** at 1180px every two-column view stacks. At 900px the rail becomes an off-canvas drawer (max 300px, cobalt scrim) and a 64px cobalt tab bar appears at the bottom with a round enamel ⌘K button in the centre. At 720px rows restack: name and amount on line one, gauge or due bar full width on line two, actions as equal-width buttons on line three; tables become stacked rows with the same furniture and hide secondary columns.
- **Shopping mode:** larger check targets (68px rows, 30px boxes) and a sticky cobalt basket bar at the bottom.

## Elevation & Depth

The system is flat. Panels sit on the enamel ground with a 1.5px `line` border and no shadow; hierarchy comes from the cobalt rail, the 3px rules, and tone (enamel, plate white, sunk enamel). Shadows appear only on surfaces that float above the page, and they are tinted cobalt or ink, never neutral grey.

### Shadow Vocabulary

- **Command lift** (`box-shadow: 0 24px 60px rgb(16 37 94 / 0.32), 0 2px 6px rgb(16 37 94 / 0.12)`): the ⌘K dialog, over a cobalt backdrop at 42% with a 2px blur.
- **Basket lift** (`box-shadow: 0 10px 28px rgb(16 37 94 / 0.28)`): the sticky shopping basket bar.
- **Toast lift** (`box-shadow: 0 12px 30px rgb(16 19 24 / 0.28)`): toasts.
- **Drawer edge** (`box-shadow: 12px 0 40px rgb(16 37 94 / 0.3)`): the open mobile rail.

### Named Rules

**The Flat Enamel Rule.** Anything that lives in the page flow is flat. A shadow means "this floats and will go away": a dialog, a toast, a sticky bar, a drawer.

## Shapes

Two shapes do almost all the work: the pill and the plate. Controls (buttons, segments, chips, counts, badges, the basket bar) are full pills. Containers (panels, empty states, the command dialog) are plates with gently rounded corners. Fields and nav items use a smaller field radius; toasts sit between. Borders are 1.5px throughout (2px on the shopping check box and the large gauge). Measures have their own forms: the gauge is a pill-ended canister with a rim, the due bar is a near-square bar on a flat track. Empty states and a gauge without a minimum use a dashed `cobalt-line` border to say "nothing here yet" without inventing content.

## Components

### Buttons

Confident pills with a cobalt rim.

- **Shape:** full pill (`rounded.pill`), 1.5px cobalt border, 38px minimum height.
- **Primary:** cobalt fill, white text; hover deep cobalt.
- **Outline (default):** plate white with cobalt text and rim; hover cobalt wash.
- **Small:** 30px high, `cobalt-line` rim, used for row actions (+1, Consume, Undo, Review). Small primary keeps the cobalt rim.
- **Ghost:** no border, no fill.
- **Danger quiet:** `line` rim with tomato text; hover tomato rim and tomato-soft ground.
- **Press / Disabled:** press nudges down 1px. Disabled uses sunk enamel, `line` rim, faint text, not-allowed cursor.
- **Inside the basket bar:** the primary inverts to an enamel lid with cobalt text.

### Segmented control

A pill track with a 1.5px cobalt rim and 3px inner padding; segments are 13px/700 cobalt text, pressed segment fills cobalt with white text. Used for Purchase / Consume / Open and List / Shop modes.

### Chips

- **Style:** plate white pill, 1.5px `line` border, 13px/600, with a count pill on `line-soft`.
- **State:** hover `cobalt-line` border; pressed fills cobalt with white text and a translucent white count.

### Tags and badges

- **Tag:** small 5px-radius label in tag type. Neutral on `line-soft`/`ink-2`; agent on `violet-soft`/`violet`; danger on `tomato-soft`/`tomato`. Actor tags read YOU or User #n only from the API key; the UI never guesses who booked.
- **Badge:** pill with ok / warn / danger soft ground and ink text.

### Cards / Containers (panels)

- **Corner Style:** plate (`rounded.plate`).
- **Background:** plate white on enamel.
- **Shadow Strategy:** none (see The Flat Enamel Rule).
- **Border:** 1.5px `line`; internal dividers 1px `line-soft`.
- **Internal Padding:** head 14px 18px 12px, body 16px 18px 18px. The head is a cobalt headline label with an optional right-aligned count; a sub-section uses a label-type line with a soft top rule; a "more" link closes the panel in cobalt.

### Inputs / Fields

- **Style:** plate white, 1.5px `line` border, field radius, 40px high; labels above in 13px/600 `ink-2`.
- **Focus:** border turns cobalt with a 3px cobalt-wash halo; hover (unfocused) shows `cobalt-line`.
- **Amount field:** value right-aligned and bold, unit printed inside the right edge in `ink-2`.
- **Select:** custom cobalt chevron. **Search:** inline magnifier on the left. **Date:** cobalt-tinted picker icon.
- **Global focus ring:** 2.5px cobalt outline at 2px offset for every other focusable element.

### Navigation

- **Rail:** cobalt ground, wordmark in expanded 800 caps (white, with a spaced HOUSEHOLD sub-line in `#b4c1e8`), a deep-cobalt ⌘K trigger with a kbd hint, group labels in 10px expanded caps (`#a9b7e2`). Items are 15px/500 at `#dfe5f6` with a domain-coloured stroke icon; hover is a 8% white wash; the active item becomes an enamel plate with cobalt bold text and a cobalt icon. Counts sit at the right as small pills (shopping and agent in their marker colour).
- **Mobile:** a 64px cobalt tab bar (Today, Stock, ⌘K, List, More); the active tab gets a 3px enamel notch at its top edge; counts float at the icon's corner. The full rail opens as a drawer from More.

### Canister Gauge (signature)

A 14px pill canister with a 1.5px cobalt rim and enamel inside. The fill is the amount on a scale of twice the minimum, so the black minimum tick always sits at the centre. At or above minimum the fill is cobalt and the tick turns white; below minimum or empty the rim and fill turn tomato and the tick is black. A product without a minimum shows an empty dashed `cobalt-line` rim with "NO MIN" and no fill. On the product page the same gauge grows to 40px high with a 2px rim beside the 44px stock numeral. Fill width animates over 600ms.

### Due Bar (signature)

A 10px bar on a `line-soft` track with a 72px right-aligned day count. Bar length is the real number of days left on one 14-day scale (minimum visible stub 3%). Tone: green above 5 days, mustard at 5 days or less, tomato when expired (the count also turns tomato and reads "Yesterday" or similar). Each due row has a 7px domain dot before the name.

### Command bar (⌘K)

A 640px plate dialog 12vh from the top, with the command lift and a blurred cobalt backdrop. The input row is 18px text over a 3px cobalt rule; verb chips sit below; results are 8px-radius rows with a cobalt icon, bold name, and a hint that turns cobalt when selected (cobalt-wash ground). A sunk-enamel footer lists keys. Opens with a 220ms rise-and-scale.

### Toast with undo

An ink pill-ish plate (12px radius) at the bottom right (full width above the tab bar on mobile) with white text, an outlined white Undo pill, and a close button. Errors switch the ground to tomato. Rises in over 280ms.

### Shopping check row

A 56px row (68px in shop mode) with a 24px (30px) cobalt-rimmed check box that fills cobalt and scales to 0.94 when checked; the name and amount go faint with a 1.5px strike-through.

### Motion

One easing for everything: `cubic-bezier(0.16, 1, 0.3, 1)`. State transitions run 160ms; check and drawer 180–280ms; gauge fill 600ms. Reduced-motion collapses all durations to 1ms.

## Do's and Don'ts

### Do

- **Do** put a 3px cobalt rule under every page title and keep the title in expanded 800 caps.
- **Do** show every stocked product with the canister gauge on the 2× minimum scale, tick at the minimum; show "no min" with a dashed rim when there is no minimum.
- **Do** draw every best-before or due item on the same 14-day due bar, with the day count beside it.
- **Do** keep fixed row furniture: name with meta line, measure, right-aligned bold amount with unit, then actions.
- **Do** mark agent work with the violet tag and give every booking an Undo path.
- **Do** use pills (1.5px cobalt rim) for controls and 14px plates with 1.5px `line` borders for containers.
- **Do** keep data in `ink`; use `ink-2` and `ink-3` only for labels, meta, and inactive states.

### Don't

- **Don't** build stat tiles or rows of repeated big-number cards; put a count in the panel head instead.
- **Don't** introduce a teal or second brand accent; cobalt is the only shell colour.
- **Don't** use a state ink (tomato, mustard, green, violet) for decoration or emphasis without a state behind it.
- **Don't** set sentences, buttons, or values in the expanded width.
- **Don't** add shadows to panels or rows; shadows belong only to dialogs, toasts, the basket bar, and the mobile drawer.
- **Don't** guess an actor, an amount, or a date; show "—" or nothing rather than a made-up value.
