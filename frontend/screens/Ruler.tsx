import { signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import { type Row } from "../api";
import { addDays, dateISO, shortDate } from "../ui";

/** A dated, in-stock product placed on the freshness ruler. */
export type RulerItem = { id: string; name: string; days: number; row: Row };

/** "in 2 days", "3 days ago", "today", "in 2 months". */
export function relativeDays(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  const a = Math.abs(days);
  const span =
    a < 45
      ? `${a} days`
      : a < 730
        ? `${Math.round(a / 30.4)} months`
        : `${Math.round(a / 365)} years`;
  return days < 0 ? `${span} ago` : `in ${span}`;
}

const LANE = 22; // height of one label row
const AXIS = 22; // room under the axis for the date labels
const GAP = 8; // minimum air between two labels on one row

/** Rough label width in points (12.5px Geist medium) plus the leading tick. */
const labelWidth = (name: string) => Math.min(168, name.length * 7.2 + 12);

type Placed = RulerItem & { pct: number; lane: number; flip: boolean };

/**
 * Greedy lane assignment: walk markers in date order and put each on the
 * highest row where its label does not touch another label, its stem does not
 * cut through a label further down, and no stem from above cuts its label.
 */
function place(items: RulerItem[], span: number, width: number): Placed[] {
  const lanes: { s: number; e: number; x: number }[][] = [];
  const placed: Placed[] = [];
  for (const item of items) {
    const x = (item.days / span) * width;
    const w = labelWidth(item.name);
    const flip = x + w > width;
    const s = flip ? x - w : x,
      e = flip ? x : x + w;
    const free = (lane: number, strict: boolean) => {
      if ((lanes[lane] ?? []).some((l) => s < l.e + GAP && e > l.s - GAP)) return false;
      for (let below = lane + 1; below < lanes.length; below++)
        if (lanes[below].some((l) => x > l.s - 2 && x < l.e + 2)) return false;
      if (strict)
        for (let above = 0; above < lane; above++)
          if (lanes[above].some((l) => l.x > s + 2 && l.x < e - 2)) return false;
      return true;
    };
    let lane = -1;
    for (let i = 0; i <= lanes.length && lane < 0; i++) if (free(i, true)) lane = i;
    if (lane < 0) for (let i = 0; i <= lanes.length && lane < 0; i++) if (free(i, false)) lane = i;
    if (lane < 0) lane = lanes.length;
    (lanes[lane] ??= []).push({ s, e, x });
    placed.push({ ...item, pct: (item.days / span) * 100, lane, flip });
  }
  return placed;
}

/**
 * The freshness ruler: the next `span` days as a hairline axis. Each dated
 * product hangs from its best-before day; overdue ones sit in a pale red zone
 * left of today, later ones collapse into a dashed zone at the right edge.
 */
const tone = (days: number) => (days < 0 ? "destructive" : days <= 5 ? "due" : "foreground");
export function Ruler(p: {
  items: RulerItem[];
  span: number;
  compact?: boolean;
  onSelect: (row: Row) => void;
}) {
  const measured = signal(0);
  const width = () => measured() || (p.compact ? 230 : 640);
  const overdue = () =>
    p.items
      .filter((i) => i.days < 0)
      .toSorted((a, b) => a.days - b.days || a.name.localeCompare(b.name));
  const inside = () =>
    p.items
      .filter((i) => i.days >= 0 && i.days <= p.span)
      .toSorted((a, b) => a.days - b.days || a.name.localeCompare(b.name));
  const later = () =>
    p.items
      .filter((i) => i.days > p.span)
      .toSorted((a, b) => a.days - b.days || a.name.localeCompare(b.name));
  const markers = () => place(inside(), p.span, width());
  const maxOverdue = () => (p.compact ? 2 : 3);
  const shownOverdue = () =>
    overdue().length > maxOverdue() ? overdue().slice(0, maxOverdue() - 1) : overdue();
  const pastWidth = () => (overdue().length ? (p.compact ? 72 : 96) : 24);
  const pastX = () => (p.compact ? 8 : 14);
  const lanes = () =>
    Math.max(
      1,
      markers().reduce((n, m) => Math.max(n, m.lane + 1), 0),
      Math.min(overdue().length, maxOverdue()),
    );
  const area = () => Math.max(lanes() * LANE + 16, later().length ? (p.compact ? 52 : 92) : 44);
  const weeks = () => Array.from({ length: Math.floor(p.span / 7) }, (_, i) => (i + 1) * 7);
  const ticks = () => Array.from({ length: p.span + 1 }, (_, i) => i);
  const label = (item: RulerItem) => `${item.name}, best before ${relativeDays(item.days)}`;
  return (
    <View
      accessibilityLabel={`Best-before dates over the next ${p.span} days`}
      class="rounded-xl border border-border bg-card px-4 md:px-5 pt-3 pb-2.5 gap-2"
    >
      <View class="flex-row items-baseline justify-between gap-3">
        <View class="flex-row items-baseline">
          <Text class="text-[13px] font-medium text-ink-soft">Best before</Text>
          <Text class="text-[13px] text-muted-foreground tabular-nums">
            {` · next ${p.span} days`}
          </Text>
        </View>
        {p.compact ? null : (
          <Text class="text-[13px] text-muted-foreground">Select a product to open it</Text>
        )}
      </View>
      <View class="relative flex-row" style={{ height: area() + AXIS }}>
        {/* the axis spans the whole track */}
        <View class="absolute left-0 right-0 h-px bg-input" style={{ bottom: AXIS }} />
        {/* overdue zone, left of today */}
        <View class="relative" style={{ width: pastWidth() }}>
          {overdue().length ? (
            <View
              class="absolute left-0 right-0 top-0 rounded-l-md bg-danger-soft"
              style={{ bottom: AXIS }}
            />
          ) : null}
          <Each of={shownOverdue()} key={(i: RulerItem) => i.id}>
            {(item, index) => (
              <View
                class="absolute w-px bg-destructive/40"
                style={{
                  left: pastX(),
                  top: index() * LANE + 18,
                  bottom: AXIS,
                }}
              />
            )}
          </Each>
          <Each of={shownOverdue()} key={(i: RulerItem) => i.id}>
            {(item, index) => (
              <Marker
                label={label(item())}
                name={item().name}
                tone="destructive"
                style={{
                  left: pastX(),
                  top: index() * LANE,
                  maxWidth: pastWidth() - pastX() - 2,
                }}
                onPress={() => p.onSelect(item().row)}
              />
            )}
          </Each>
          {overdue().length > shownOverdue().length ? (
            <Text
              class="absolute text-[12px] font-medium text-destructive tabular-nums"
              style={{ left: pastX() + 7, top: shownOverdue().length * LANE }}
            >
              {`+${overdue().length - shownOverdue().length} more`}
            </Text>
          ) : null}
          <Each of={overdue().length ? [pastX()] : []}>
            {(x) => (
              <View
                class="absolute w-[7px] h-[7px] -translate-x-1/2 rounded-full bg-destructive ring-2 ring-card"
                style={{ left: x() + 0.5, bottom: AXIS - 3 }}
              />
            )}
          </Each>
        </View>
        {/* the window: today to today + span */}
        <View
          class={`relative flex-1 min-w-0 ${later().length ? "" : "mr-5"}`}
          onLayout={({ bounds }) => measured.set(bounds.size.width)}
        >
          <Each of={ticks()}>
            {(day) => (
              <View
                class={`absolute w-px ${day() % 7 === 0 ? "h-[9px] bg-faint" : "h-[5px] bg-input"}`}
                style={{ left: `${(day() / p.span) * 100}%`, bottom: AXIS }}
              />
            )}
          </Each>
          <View class="absolute left-0 top-0 w-px bg-foreground" style={{ bottom: AXIS }} />
          <View class="absolute bottom-0 left-0 w-16 -translate-x-1/2 items-center">
            <Text style={{ numberOfLines: 1 }} class="text-xs font-semibold text-foreground">
              Today
            </Text>
          </View>
          <Each of={weeks()}>
            {(day) => (
              <View
                class="absolute bottom-0 w-16 -translate-x-1/2 items-center"
                style={{ left: `${(day() / p.span) * 100}%` }}
              >
                <Text
                  style={{ numberOfLines: 1 }}
                  class="text-xs text-muted-foreground tabular-nums"
                >
                  {shortDate(addDays(dateISO(), day()))}
                </Text>
              </View>
            )}
          </Each>
          <Each of={markers()} key={(m: Placed) => m.id}>
            {(m) => (
              <View
                class={`absolute w-px ${m().days <= 5 ? "bg-due-mark/50" : "bg-input"}`}
                style={{
                  left: `${m().pct}%`,
                  top: m().lane * LANE + 18,
                  bottom: AXIS,
                }}
              />
            )}
          </Each>
          <Each of={markers()} key={(m: Placed) => m.id}>
            {(m) => (
              <View
                class={`absolute w-[7px] h-[7px] -translate-x-1/2 rounded-full ring-2 ring-card ${m().days <= 5 ? "bg-due-mark" : "bg-foreground"}`}
                style={{ left: `${m().pct}%`, bottom: AXIS - 3 }}
              />
            )}
          </Each>
          <Each of={markers()} key={(m: Placed) => m.id}>
            {(m) => (
              <Marker
                label={label(m())}
                name={m().name}
                tone={tone(m().days)}
                flip={m().flip}
                style={
                  m().flip
                    ? { right: `${100 - m().pct}%`, top: m().lane * LANE }
                    : { left: `${m().pct}%`, top: m().lane * LANE }
                }
                onPress={() => p.onSelect(m().row)}
              />
            )}
          </Each>
        </View>
        {/* everything dated beyond the window */}
        {later().length ? (
          <View
            class={`ml-3 border-l border-dashed border-input justify-end gap-0.5 pb-1.5 ${p.compact ? "w-12 pl-2 items-end" : "w-36 pl-3.5"}`}
            style={{ height: area() }}
          >
            {p.compact ? (
              <View class="items-end">
                <Text class="text-[13px] font-medium text-ink-soft tabular-nums">
                  {`+${later().length}`}
                </Text>
                <Text class="text-xs text-muted-foreground">later</Text>
              </View>
            ) : (
              <View class="gap-0.5">
                <Text class="text-[12.5px] font-medium text-ink-soft tabular-nums">
                  {`${later().length} later`}
                </Text>
                <Text
                  style={{ numberOfLines: 4 }}
                  class="text-[12.5px] leading-4 text-muted-foreground"
                >
                  {later()
                    .map((i) => i.name)
                    .join(", ")}
                </Text>
              </View>
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** A product name hanging from the ruler; pressing it opens the product. */
function Marker(p: {
  label: string;
  name: string;
  tone: "destructive" | "due" | "foreground";
  flip?: boolean;
  style: Record<string, string | number>;
  onPress: () => void;
}) {
  const tick = {
    destructive: "bg-destructive/50",
    due: "bg-due/50",
    foreground: "bg-foreground/30",
  }[p.tone];
  const text = {
    destructive: "text-destructive",
    due: "text-due",
    foreground: "text-foreground",
  }[p.tone];
  return (
    <Button
      accessibilityLabel={p.label}
      onPress={p.onPress}
      class={`absolute h-[18px] items-center gap-1.5 rounded-[3px] hover:bg-accent focus:outline-2 focus:outline-ring ${p.flip ? "flex-row-reverse" : "flex-row"}`}
      style={p.style}
    >
      <View class={`w-px h-2.5 ${tick}`} />
      <Text style={{ numberOfLines: 1 }} class={`shrink min-w-0 text-[12.5px] font-medium ${text}`}>
        {p.name}
      </Text>
    </Button>
  );
}
