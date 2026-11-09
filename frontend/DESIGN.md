---
name: Grocy Next
description: A precise, near-monochrome household tool for stock, shopping, meals and chores, built around a freshness ruler.
colors:
  background: "#fafaf9"
  foreground: "#0c0d0e"
  card: "#ffffff"
  popover: "#ffffff"
  rail: "#f6f6f4"
  secondary: "#f1f1ef"
  accent: "#f1f1ef"
  selected: "#f1f1ef"
  border: "#e6e6e3"
  input: "#d6d6d2"
  ink-soft: "#3b3e42"
  muted-foreground: "#62666a"
  faint: "#a3a6a9"
  primary: "#e8a100"
  primary-foreground: "#1a1300"
  ring: "#e8a100"
  saffron-soft: "#fdf3d6"
  due: "#9a5800"
  due-mark: "#e8a100"
  destructive: "#c8321f"
  danger-soft: "#fcebe8"
typography:
  figure:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: "36px"
    letterSpacing: "-0.025em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "32px"
    letterSpacing: "-0.025em"
  headline-phone:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
  row:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 500
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  meta:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    fontFeature: "tnum"
  ruler-label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
  micro:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    fontFeature: "tnum"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "9999px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  gutter-desktop: "40px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "#e8a100e6"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.accent}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "36px"
  button-quiet-hover:
    backgroundColor: "{colors.accent}"
  field:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
    height: "40px"
  segments-track:
    backgroundColor: "{colors.secondary}"
    rounded: "{rounded.lg}"
    padding: "2px"
  segment-selected:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  count:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.micro}"
    rounded: "{rounded.full}"
    height: "20px"
  count-strong:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.micro}"
    rounded: "{rounded.full}"
    height: "20px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "36px"
  nav-item-selected:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
  surface:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.xl}"
    padding: "16px"
  panel:
    backgroundColor: "{colors.card}"
    width: "440px"
    padding: "20px"
  feedback-success:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  feedback-error:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.destructive}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
---

# Design System: Grocy Next

## Overview

Creative north star: **"The Freshness Ruler"**.

Grocy Next is a precise, near-monochrome household tool. Its one picture is a hairline timeline: the next weeks of best-before dates on a single axis, today marked in ink, each product hanging on a thin stem from its day, the overdue ones gathered in a pale red zone to the left and the distant ones folded into a dashed margin on the right. Everything else in the app is held quiet so that line can carry the week's pressure at a glance.

The world is near-white ground, white surfaces, near-black ink and one fine neutral scale, separated by 1px hairlines rather than boxes. A single saffron accent marks what is selected, what is primary and where focus sits; it never decorates. Red appears only for expired, overdue or failed things, and amber text only for things due within five days. Type is Geist in sentence case with tabular figures, so amounts and dates line up and read as exact. Icons are Lucide line icons at a 1.5px stroke, tinted from the text tokens.

Density is that of a working list, not a dashboard. Lists sit directly on the page as hairline rows with right-aligned amounts and one quiet action; only a grouped object (the ruler, a review diff) earns a bordered surface. The system refuses both the Bootstrap admin table and the playful food app: no themed metaphors, no heavy condensed capitals, no retro print, no saturated colour spread across the screen.

**Key Characteristics:**

- Near-white ground (#fafaf9), white surfaces, ink type, 1px hairlines.
- One saffron accent, used for selection, the primary fill and the focus ring only.
- Red for expired, overdue and errors; amber text for due within five days.
- Geist 400/500/600, sentence case, tabular numerals for every amount, date and count.
- Lucide line icons at 1.5px stroke, 15-20px, tinted from text tokens.
- The freshness ruler as the signature element; lists as hairline rows, never cards.
- A 232px desktop rail; a phone top bar and four bottom tabs.

## Colors

A near-monochrome warm-neutral scale with one saffron accent and two meaning-only state colours, defined in `frontend/theme.json`. The app ships this light palette only: there is no dark or dynamic theme, so the system status bar keeps dark icons (`statusBar.foreground` in `nsh.json`).

### Primary

- **Saffron** (`primary`, #e8a100): the primary button fill, the strong count badge (pending Review), the selected-nav dot, the 2px phone-tab indicator, the corner of the mark, and the focus ring (`ring`). Always paired with **Saffron Ink** (`primary-foreground`, #1a1300) when it carries text.
- **Saffron Wash** (`saffron-soft`, #fdf3d6): the background of a caution notice that needs a confirmation (the cook-and-deduct warning in Meals). Ink text on top, never saffron text.

### Neutral

- **Paper Ground** (`background`, #fafaf9): the page behind everything, including the phone top bar and tab bar.
- **White Surface** (`card`, `popover`, #ffffff): bordered surfaces, fields, outlined buttons, the selected nav item and segment, sheets and popups.
- **Rail Grey** (`rail`, #f6f6f4): the desktop navigation rail only; one step darker than the ground so the rail recedes.
- **Track Grey** (`secondary`, `accent`, `selected`, #f1f1ef): the segmented-control track, neutral count badges, the success feedback strip, skeleton bars (`secondary`); hover and press fills (`accent`); chosen list and date items (`selected`). Three roles share one light value and separate in dark mode.
- **Hairline** (`border`, #e6e6e3): row separators, surface borders, the rail edge, section dividers.
- **Control Line** (`input`, #d6d6d2): borders of fields and outlined buttons, column-header underlines, the ruler axis and minor ticks.
- **Ink** (`foreground`, #0c0d0e): primary text, data, selected labels, the today line on the ruler, filled checks.
- **Soft Ink** (`ink-soft`, #3b3e42): unselected rail labels, ruler captions, secondary data that is still data (best-before dates).
- **Muted** (`muted-foreground`, #62666a): metadata, field labels, column headers, placeholder text, default icon tint.
- **Faint** (`faint`, #a3a6a9): weekly ticks on the ruler and decorations of finished or out-of-month items. Not a text colour for anything a person must read.

### State

- **Overdue Red** (`destructive`, #c8321f): expired and overdue dates and markers, error notes, danger actions. Nothing else.
- **Red Wash** (`danger-soft`, #fcebe8): the overdue zone on the ruler, error feedback strips and failure panels.
- **Due Amber** (`due`, #9a5800): text for items due within five days. **Due Mark** (`due-mark`, #e8a100) is its graphic form: the ruler dot and stem for the same items.

### Named Rules

**The One Saffron Rule.** Saffron marks selection, the single primary action and focus. It never fills a panel, tints a row or colours body text; on light ground it is a fill, never a text colour.

**The Meaning-Only Rule.** Red means expired, overdue or failed; amber means due within five days. A colour that does not carry one of those meanings stays neutral.

**The Hairline Rule.** Structure is drawn with 1px lines in `border` or `input`, not with fills or shadows. A row ends in a hairline; a group starts with one.

## Typography

**Display Font:** Geist (with ui-sans-serif, system-ui, sans-serif)
**Body Font:** Geist
**Label/Mono Font:** Geist with tabular figures; no mono face.

**Character:** One neo-grotesque at three weights (400, 500, 600) bundled locally. Hierarchy comes from size and weight steps between 11px and 28px, not from case, colour or a second family.

### Hierarchy

- **Figure** (600, 28px, 36px line, -0.025em, tabular): the in-stock amount at the top of a product sheet.
- **Headline** (600, 24px desktop / 22px phone, -0.025em): one screen title, with a quiet 14px muted count beside it on the baseline ("11 products").
- **Title** (600, 17px): sheet titles; 15px 600 for review cards and the "Grocy Next" wordmark (-0.025em).
- **Row** (500, 15px): product, item and chore names in rows; field values and empty-state titles at 15px 400/500.
- **Body** (400, 14px, 20px line): notes, control labels (500), segment labels, feedback text.
- **Label** (500, 13px, muted): field labels, column headers, group subheads (ink, with a muted count).
- **Meta** (400, 13px, tabular): location, due text, dates, relative days.
- **Ruler label** (500, 12.5px): product names on the ruler; axis dates at 12px.
- **Micro** (500, 11px, tabular): count badges and phone tab labels.

### Named Rules

**The Sentence Case Rule.** Every label, heading and button is sentence case. No uppercase, no letter-spaced small caps, no labels stacked above titles.

**The Exact Figures Rule.** Every amount, date, count and percentage uses tabular numerals, and a quantity always carries its unit ("200 Grams", "min 6 Pieces"). In stock rows the figure is medium ink and the unit word follows in regular muted, so the numbers lead the column.

## Layout

- **Desktop shell:** a 232px rail (`rail` ground, 1px right hairline, 12px side padding, 20px top) holds the mark and wordmark, the four primary destinations (Stock, Shopping, Meals, Chores), a flexible gap, then Review and Settings at the foot. The work area centres a 1120px column inside 40px gutters with 32px top and 48px bottom padding. Overview (house icon) sits above Stock; Batch (scan icon) sits below the four destinations behind a hairline, with one muted line explaining it; the connected server address is a muted line above Review and Settings.
- **Phone shell:** a 56px top bar on the ground with the mark, wordmark, Review (with pending count) and Settings as 44px icon buttons; four equal bottom tabs (56px, 20px icon over an 11px label) with a 2px by 32px saffron indicator on the active tab. Shopping and Chores carry a 16px ink badge with paper text on the icon's corner, placed after the label in reading order ("Shopping 2"). Content uses 16px gutters, 20px top and 32px bottom padding. Both bars respect safe-area insets. The mark and wordmark form the Overview button; Batch joins Review and Settings as a 44px icon button. The root view respects the top and side safe-area insets.
- **Screen order:** heading row (title + count on the left, search and the primary action on the right; on phones search drops to its own full-width row), then the screen's grouped object (the ruler on Stock), then a segmented filter with counts, then the list.
- **Rows:** 52px minimum on desktop, 60-64px on phones, with a hairline bottom. Desktop Stock is a column table: name (flex 2), location (flex 1), amount (132px, right-aligned), best-before date (112px), relative days (112px), action (68px), under a 34px header row of 13px muted labels with a `input` underline. Phones fold location and due text into a second meta line.
- **Sheets:** product details and editors open in a right-hand sheet, 440px on desktop and full-width on phones, with a hairline-separated header, 20px padded scrolling body and a pinned footer for the submit action.
- **Rhythm:** 4px base; 2px inside tracks, 6-8px within a control, 12px between related lines, 20-24px between sections, 32px between list groups. Narrow reading columns cap at 720px (Review) and 400px (Connect).
- **Overview and Batch:** shortcuts around the four primary tasks, with workflows drawn from [Grocy Android](https://github.com/patzly/grocy-android). Overview is hairline sections with factual counts and direct booking shortcuts; Purchase is its only saffron action, and it has no decorative charts. Batch is one booking form with explicit Purchase, Consume, Open and Inventory modes as a segmented control, followed by a session list that exposes transaction undo.
- **In-store mode:** rows are at least 96px tall and the whole row is the check target, with a 28px box, larger labels and a single textual collected count ("1 of 3 collected"). List management stays outside in-store mode.
- **Breakpoint:** one switch at `md`; below it the rail is hidden, targets grow to 44px and the ruler shows 14 days instead of 30.

Barcode entry accepts typed input or a keyboard-style scanner, and always shows the product for review before a stock booking. Shopping checks sync online and revert on failure; nothing implies offline support.

## Elevation & Depth

Flat by default. Depth comes from the step between the ground (#fafaf9), the rail (#f6f6f4) and white surfaces, with 1px hairlines doing the separating. Shadows appear only on the two things that sit on the page's own plane but are raised by state (the selected segment and the selected nav item, both with an extra-small shadow) and on things that float above the page (popovers and the sheet).

### Shadow Vocabulary

- **Raised selection** (`shadow-xs`): the chosen segment in a segmented control and the selected rail item, with a white fill and hairline border.
- **Popover** (`shadow-lg`): select and date-picker popups, on a white surface with a hairline border and 12px corners.
- **Sheet** (`shadow-xl`): the right-hand panel, over a 20% black backdrop.

### Named Rules

**The Flat Page Rule.** Nothing resting on the page carries a shadow except a selected segment or nav item. Cards, rows and the ruler are bordered, not lifted.

## Shapes

Gently rounded and consistent: 8px corners (`radius`) on every control, field and feedback strip; 6px on items inside a track or list (segments, menu items, date cells); 12px on surfaces and popups; full circles for counts, status dots and the chore check. The mark is a 22px ink tile with 6px corners and a 7px saffron dot in the lower-right corner. Ruler markers are 7px dots ringed in white, stems are 1px, and the zone for later items is fenced by a dashed `input` line.

## Components

### Buttons

Calm and exact; the label does the work.

- **Shape:** 8px corners, 36px tall on desktop and 44px on phones; the compact form is 36px everywhere with 10px side padding.
- **Primary:** saffron fill with Saffron Ink 14px medium text and an optional 15px leading icon; at most one per view ("Add purchase", the sheet submit). Hover and press drop the fill to 90% and 80% opacity.
- **Secondary:** white fill, 1px `input` border, ink text; hover and press fill with `accent`.
- **Quiet:** no fill or border; hover fills with `accent`. Used for low-stakes actions in rows and footers.
- **Danger:** secondary or quiet shape with `destructive` text and icon.
- **Focus:** 2px saffron outline with a 2px offset on every button, tab, nav item and pressable row.
- **Disabled:** 40% opacity.
- **Keyboard hint:** an optional 11px muted key label in a 4px-cornered hairline box, desktop only.

### Chips

- **Segmented filter:** a `secondary` track with 2px padding and 8px corners; the chosen segment is white with an extra-small shadow, 14px medium ink, followed by a 12px muted tabular count; others are muted and gain a 60% white hover. Scrolls horizontally on phones.
- **Count badge:** a 20px pill with 11px medium tabular text; neutral on `secondary` for waiting work (Shopping: items left on the default list; Chores: overdue plus due today), strong on saffron only for pending Review. Rail counts refetch on navigation and after any successful save.
- **Date shortcuts:** 6px-cornered outlined chips with 13px tabular text; the chosen one takes an ink border and `selected` fill.

### Cards / Containers

- **Corner Style:** 12px.
- **Background:** white `card`.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px `border`.
- **Internal Padding:** 16px by default; the ruler uses 16px (20px desktop) sides with 12px top.
- **Use:** only for one grouped object: the freshness ruler, a review diff, a receipt. Lists never sit in a card.

### Inputs / Fields

- **Style:** 13px medium muted label 6px above a white field with a 1px `input` border, 8px corners, 15px ink text and muted placeholder; 40px tall desktop, 44px phone. Numeric fields use tabular figures.
- **Search:** the same field with a 15px search icon inset 12px from the left, 288px wide on desktop and full-width on phones.
- **Select and date:** the same trigger shape with a trailing chevron or leading calendar icon; popups are white, 12px corners, hairline border, large shadow; the chosen date cell fills with ink and paper text.
- **Focus:** the border turns saffron and a 2px saffron outline at 30% opacity surrounds it.
- **Error:** a 14px `destructive` note below, announced as an alert; drafts are kept.

### Navigation

- **Rail item:** 36px tall, 8px corners, 16px icon and 14px label. Unselected: Soft Ink label, muted icon, `accent` hover. Selected: white fill, hairline border, extra-small shadow, ink medium label and icon, and a 6px saffron dot at the right (replaced by the strong count badge when there is a pending count).
- **Phone tabs:** four destinations; the active one has an ink icon, ink medium label and the saffron top indicator; inactive ones are muted.
- **Underlined tabs:** inside screens and sheets, 14px labels 20px apart over a hairline; the active tab is ink medium with a 2px ink underline.

### Rows and checks

- **Row:** a pressable hairline row with a white hover on desktop; name in Row type, meta in Meta type, amount right-aligned in 15px tabular (medium ink when in stock, muted when empty), then one small outlined action ("Use 1": 32px tall on desktop, 44px on phones, 13px medium tabular label, ink border on hover).
- **Below-minimum bar:** a 44px by 3px `border` track with a `ink-soft` fill beside the "min" amount, desktop only.
- **Chore check:** an 18px circle with an `input` border inside a 44px (36px desktop) target; it fills with ink and a paper check when complete.
- **Checkbox:** an 18px square with 5px corners and an `input` border that fills with ink when checked, the check drawn in the paper colour (`background`).
- **Feedback strip:** 8px-cornered strip with a 15px icon: `secondary` with an ink check for success, `danger-soft` with a red alert for errors.
- **Empty state:** centred 15px medium title over a 14px muted line (max 384px), 40px vertical padding, closing hairline when it ends a list.
- **Loading:** two 12px `secondary` skeleton bars and a "Loading…" note.

### Freshness Ruler

The signature element, on a white surface at the top of Stock.

- **Header:** "Best before" in 13px medium Soft Ink, then "· next 30 days" muted (14 days on phones).
- **Axis:** a 1px `input` line; day ticks 5px in `input`, week ticks 9px in `faint`, week dates in 12px muted tabular below; "Today" in 12px semibold ink under a full-height 1px ink line.
- **Markers:** each dated product is a 7px dot on the axis (ink, or `due-mark` within five days) with a 1px stem rising to a 12.5px medium label preceded by a 10px tick. Labels take the colour of their state (ink, amber or red), stack into 22px lanes so no label or stem overlaps, and flip to the left near the right edge. Each label is a button that opens the product.
- **Overdue zone:** a `danger-soft` block left of today with red dots and labels; beyond two (phone) or three (desktop) it shows "+N more".
- **Later margin:** items past the window collapse behind a dashed `input` divider into "N later" and a muted list of names (phones: "+N later").

## Do's and Don'ts

### Do

- **Do** take every colour from the theme tokens (`bg-card`, `text-due`, `token("x")`) so every colour stays tied to the palette.
- **Do** keep saffron to selection, the one primary action per view and the focus ring.
- **Do** colour a date by its meaning: `destructive` when overdue, `due` within five days, muted or Soft Ink after.
- **Do** use tabular numerals for every amount, date and count, and keep the unit beside the quantity.
- **Do** keep 44px minimum targets on phones and a visible 2px saffron focus outline on every pressable element.
- **Do** put lists directly on the page as hairline rows; reserve the 12px-cornered surface for a single grouped object.
- **Do** use Lucide line icons at 1.5px stroke, tinted from a text token and hidden from assistive technology when a label is present.
- **Do** show "Never" or "No date" instead of sentinel dates, and use date pickers and shortcuts instead of typed ISO dates.

### Don't

- **Don't** use saffron as a text colour, a panel fill or a row tint.
- **Don't** use red or amber for anything but expired, overdue, failed or due-soon meaning.
- **Don't** use uppercase labels, letter-spaced small caps or a second typeface.
- **Don't** wrap lists in cards or add shadows to things resting on the page.
- **Don't** use `faint` for text a person needs to read.
- **Don't** add themed metaphors, decorative illustration, gauges or charts beyond the ruler.
- **Don't** add decorative animation; state changes are colour and opacity transitions only.
