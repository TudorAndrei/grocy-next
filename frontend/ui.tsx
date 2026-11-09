import { Image, Scroll, Text, View, token, type JSX } from "nsh";
import { Button, Input, Select, Sheet, DatePicker, Checkbox } from "nsh/base";
import "./assets/fonts/Geist-400.woff2";
import "./assets/fonts/Geist-500.woff2";
import "./assets/fonts/Geist-600.woff2";
import iconPackage from "./assets/icons/package.svg";
import iconCart from "./assets/icons/shopping-cart.svg";
import iconUtensils from "./assets/icons/utensils.svg";
import iconCircleCheck from "./assets/icons/circle-check.svg";
import iconInbox from "./assets/icons/inbox.svg";
import iconSettings from "./assets/icons/settings.svg";
import iconSearch from "./assets/icons/search.svg";
import iconPlus from "./assets/icons/plus.svg";
import iconChevronDown from "./assets/icons/chevron-down.svg";
import iconChevronLeft from "./assets/icons/chevron-left.svg";
import iconChevronRight from "./assets/icons/chevron-right.svg";
import iconX from "./assets/icons/x.svg";
import iconCheck from "./assets/icons/check.svg";
import iconUndo from "./assets/icons/undo-2.svg";
import iconCalendar from "./assets/icons/calendar.svg";
import iconBattery from "./assets/icons/battery.svg";
import iconMinus from "./assets/icons/minus.svg";
import iconTrash from "./assets/icons/trash-2.svg";
import iconPencil from "./assets/icons/pencil.svg";
import iconLogOut from "./assets/icons/log-out.svg";
import iconAlert from "./assets/icons/circle-alert.svg";
import iconHouse from "./assets/icons/house.svg";
import iconScan from "./assets/icons/scan-barcode.svg";

/*
 * Quiet Precision. Colours are theme tokens (frontend/theme.json), used as
 * classes: bg-background, bg-card, text-foreground, text-muted-foreground,
 * border-border, border-input, bg-primary (saffron, used sparingly),
 * text-destructive (expired/overdue only), text-due (due soon), bg-selected.
 * `color` stays for inline styles; it resolves the same tokens.
 */
export const color = {
  get ink() {
    return token("foreground");
  },
  get muted() {
    return token("muted-foreground");
  },
  get accent() {
    return token("primary");
  },
  get paper() {
    return token("background");
  },
  get line() {
    return token("border");
  },
  get danger() {
    return token("destructive");
  },
  get due() {
    return token("due");
  },
};

const icons = {
  package: iconPackage,
  cart: iconCart,
  utensils: iconUtensils,
  "circle-check": iconCircleCheck,
  inbox: iconInbox,
  settings: iconSettings,
  search: iconSearch,
  plus: iconPlus,
  "chevron-down": iconChevronDown,
  "chevron-left": iconChevronLeft,
  "chevron-right": iconChevronRight,
  x: iconX,
  check: iconCheck,
  undo: iconUndo,
  calendar: iconCalendar,
  battery: iconBattery,
  minus: iconMinus,
  trash: iconTrash,
  pencil: iconPencil,
  "log-out": iconLogOut,
  alert: iconAlert,
  house: iconHouse,
  scan: iconScan,
};
export type IconName = keyof typeof icons;

/** A 1.5px line icon tinted from a theme token (default: muted text). */
export function Icon(p: {
  name: IconName;
  size?: number;
  tint?:
    | "foreground"
    | "muted-foreground"
    | "primary-foreground"
    | "background"
    | "destructive"
    | "due";
}) {
  const size = p.size ?? 16;
  return (
    <Image
      src={icons[p.name]}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: size,
        height: size,
        tintColor: token(p.tint ?? "muted-foreground"),
      }}
    />
  );
}

const focusRing = "focus:outline-2 focus:outline-offset-2 focus:outline-ring";

export function Action(p: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  quiet?: boolean;
  icon?: IconName;
  shortcut?: string;
  compact?: boolean;
  accessibilityLabel?: string;
}) {
  const shape = p.primary
    ? "bg-primary hover:bg-primary/90 active:bg-primary/80"
    : p.quiet
      ? "bg-transparent hover:bg-accent active:bg-accent"
      : "bg-card border border-input hover:bg-accent active:bg-accent";
  const text = p.primary
    ? "text-primary-foreground"
    : p.danger
      ? "text-destructive"
      : "text-foreground";
  return (
    <Button
      accessibilityLabel={p.accessibilityLabel ?? p.label}
      onPress={p.onPress}
      disabled={p.disabled}
      class={`${p.compact ? "min-h-9 px-2.5" : "min-h-11 md:min-h-9 px-3"} flex-row gap-1.5 rounded-lg justify-center items-center ${shape} ${focusRing} disabled:opacity-40`}
    >
      {p.icon ? (
        <Icon
          name={p.icon}
          size={15}
          tint={p.primary ? "primary-foreground" : p.danger ? "destructive" : "foreground"}
        />
      ) : null}
      <Text class={`text-sm font-medium ${text}`}>{p.label}</Text>
      {p.shortcut ? (
        <View
          class={`hidden md:flex ml-1 px-1.5 rounded border ${p.primary ? "border-primary-foreground/20" : "border-border"}`}
        >
          <Text
            class={`text-[11px] ${p.primary ? "text-primary-foreground" : "text-muted-foreground"}`}
          >
            {p.shortcut}
          </Text>
        </View>
      ) : null}
    </Button>
  );
}

/** A small count beside a nav item, tab or filter; tabular figures. */
export function Count(p: { value: number | string; strong?: boolean }) {
  return (
    <View
      class={`min-w-5 h-5 px-1.5 rounded-full items-center justify-center ${p.strong ? "bg-primary" : "bg-secondary"}`}
    >
      <Text
        class={`text-[11px] font-medium tabular-nums ${p.strong ? "text-primary-foreground" : "text-muted-foreground"}`}
      >
        {String(p.value)}
      </Text>
    </View>
  );
}

/**
 * A segmented filter: one rounded track, the chosen segment raised in card.
 * On phones it scrolls horizontally.
 */
export function Segments(p: {
  items: { value: string; label: string; count?: number }[];
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <Scroll horizontal scrollbar={false} class="max-w-full grow-0">
      <View
        accessibilityLabel={p.label}
        class="flex-row gap-0.5 p-0.5 rounded-lg bg-secondary self-start"
      >
        <Each of={p.items}>
          {(item) => (
            <Button
              selected={p.value === item().value}
              onPress={() => p.onChange(item().value)}
              class={`min-h-9 md:min-h-8 px-3 flex-row gap-1.5 items-center rounded-md ${p.value === item().value ? "bg-card shadow-xs" : "bg-transparent hover:bg-card/60"} ${focusRing}`}
            >
              <Text
                class={`text-sm ${p.value === item().value ? "text-foreground font-medium" : "text-muted-foreground"}`}
              >
                {item().label}
              </Text>
              {item().count != null ? (
                <Text class="text-xs tabular-nums text-muted-foreground">
                  {String(item().count)}
                </Text>
              ) : null}
            </Button>
          )}
        </Each>
      </View>
    </Scroll>
  );
}

export function Field(p: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  secret?: boolean;
  multiline?: boolean;
  placeholder?: string;
  numeric?: boolean;
  onSubmit?: () => void;
  autoFocus?: boolean;
}) {
  return (
    <View class="gap-1.5 min-w-0">
      <Text class="text-[13px] font-medium text-muted-foreground">{p.label}</Text>
      <Input
        accessibilityLabel={p.label}
        value={p.value}
        onChange={(e) => p.onChange(e.value)}
        masked={p.secret}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={p.numeric ? "decimal-pad" : "default"}
        autoFocus={p.autoFocus}
        multiline={p.multiline}
        placeholder={p.placeholder}
        onSubmit={p.onSubmit}
        class={`min-h-11 md:min-h-10 rounded-lg border border-input bg-card px-3 py-2 text-[15px] text-foreground placeholder:text-muted-foreground ${p.numeric ? "tabular-nums" : ""} focus:border-ring focus:outline-2 focus:outline-ring/30`}
      />
    </View>
  );
}

/** A search input with a leading icon and an optional keyboard hint. */
export function Search(p: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  hint?: string;
  onSubmit?: () => void;
}) {
  return (
    <View class="relative min-w-0 flex-1 md:flex-none md:w-72 justify-center">
      <View class="absolute left-3 z-10">
        <Icon name="search" size={15} />
      </View>
      <Input
        accessibilityLabel={p.label}
        value={p.value}
        onChange={(e) => p.onChange(e.value)}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={p.placeholder ?? p.label}
        onSubmit={p.onSubmit}
        class="min-h-11 md:min-h-9 rounded-lg border border-input bg-card pl-9 pr-12 py-1.5 text-[15px] md:text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-2 focus:outline-ring/30"
      />
      {p.hint ? (
        <View class="hidden md:flex absolute right-2 px-1.5 rounded border border-border bg-background">
          <Text class="text-[11px] text-muted-foreground">{p.hint}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Screen title with an optional quiet count or subtitle beside it. */
export function Heading(p: { title: string; detail?: string }) {
  return (
    <View class="flex-row items-baseline gap-3 min-w-0">
      <Text
        role="header"
        class="text-[22px] md:text-2xl font-semibold tracking-tight text-foreground"
      >
        {p.title}
      </Text>
      {p.detail ? <Text class="text-sm text-muted-foreground tabular-nums">{p.detail}</Text> : null}
    </View>
  );
}

/** A section label inside a screen: small, medium weight, never uppercase. */
export function Subheading(p: { title: string; detail?: string }) {
  return (
    <View class="flex-row items-baseline gap-2">
      <Text role="header" class="text-sm font-semibold text-foreground">
        {p.title}
      </Text>
      {p.detail ? (
        <Text class="text-[13px] text-muted-foreground tabular-nums">{p.detail}</Text>
      ) : null}
    </View>
  );
}

/** A hairline-separated row. Lists sit directly on the page, never in cards. */
export function Line(p: { children?: JSX.Element }) {
  return <View class="py-3 border-b border-border gap-2">{p.children}</View>;
}

/** A bordered surface for one grouped object (the ruler, a review diff). */
export function Surface(p: { children?: JSX.Element; class?: string }) {
  return (
    <View class={`rounded-xl border border-border bg-card ${p.class ?? "p-4"}`}>{p.children}</View>
  );
}

export function Note(p: { children?: JSX.Element; error?: boolean }) {
  return (
    <Text
      role={p.error ? "alert" : "text"}
      class={`text-sm leading-5 ${p.error ? "text-destructive" : "text-muted-foreground"}`}
    >
      {p.children}
    </Text>
  );
}

/** Empty state: what will appear here and how to add the first one. */
export function Empty(p: {
  title: string;
  detail?: string;
  children?: JSX.Element;
  /** Drop the closing hairline when the empty state is not ending a list. */
  plain?: boolean;
}) {
  return (
    <View
      class={
        p.plain ? "py-10 items-center gap-2" : "py-10 items-center gap-2 border-b border-border"
      }
    >
      <Text class="text-[15px] font-medium text-foreground">{p.title}</Text>
      {p.detail ? (
        <Text class="text-sm text-muted-foreground text-center max-w-sm">{p.detail}</Text>
      ) : null}
      {p.children}
    </View>
  );
}

export function Choice(p: {
  label: string;
  value: string;
  items: { value: string; title: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <View class="gap-1.5">
      <Text class="text-[13px] font-medium text-muted-foreground">{p.label}</Text>
      <Select
        accessibilityLabel={p.label}
        searchable
        searchAccessibilityLabel={`Search ${p.label}`}
        value={p.value || null}
        items={p.items}
        onChange={(e) => p.onChange(e.value ?? "")}
        trigger={
          <View class="min-h-11 md:min-h-10 flex-row items-center justify-between gap-2 border border-input bg-card rounded-lg px-3 py-2">
            <Text class="text-[15px] text-foreground flex-1 min-w-0">
              {p.items.find((i) => i.value === p.value)?.title ?? "Choose…"}
            </Text>
            <Icon name="chevron-down" size={14} />
          </View>
        }
        popupClass="bg-popover border border-border rounded-xl p-1.5 shadow-lg"
        itemClass="min-h-10 px-3 py-2 rounded-md focus:bg-accent selected:bg-selected"
        searchClass="m-1 px-3 py-2 rounded-lg border border-input text-foreground"
        empty={<Note>No matches.</Note>}
      />
    </View>
  );
}

export function Panel(p: {
  open: boolean;
  title: string;
  onClose: () => void;
  children?: JSX.Element;
  footer?: JSX.Element;
  busy?: boolean;
}) {
  return (
    <Sheet
      open={p.open}
      side="right"
      closeOnEscape={!p.busy}
      closeOnBackdropPress={!p.busy}
      onOpenChange={(e) => {
        if (!e.open && !p.busy) p.onClose();
      }}
      backdropClass="bg-black/20"
      popupClass="w-full md:w-[440px] h-full bg-card md:border-l md:border-border shadow-xl"
    >
      <View class="flex-1 min-h-0">
        <View class="flex-row items-center justify-between gap-3 pl-5 pr-3 py-3 border-b border-border">
          <View class="flex-1 min-w-0">
            <Text role="header" class="text-[17px] font-semibold text-foreground">
              {p.title}
            </Text>
          </View>
          <Button
            accessibilityLabel="Close"
            disabled={p.busy}
            onPress={p.onClose}
            class={`w-11 h-11 md:w-9 md:h-9 rounded-lg items-center justify-center hover:bg-accent ${focusRing} disabled:opacity-40`}
          >
            <Icon name="x" size={16} tint="foreground" />
          </Button>
        </View>
        <Scroll class="flex-1">
          <View class="p-5 gap-5">{p.children}</View>
        </Scroll>
        {p.footer ? (
          <View class="px-5 py-4 border-t border-border bg-card gap-2">
            {p.footer}
            <View class="pb-[env(safe-area-inset-bottom)]" />
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}

export function Toggle(p: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Checkbox
      accessibilityLabel={p.label}
      checked={p.checked}
      disabled={p.disabled}
      onChange={(e) => p.onChange(e.checked)}
      class={`flex-row items-center gap-3 min-h-11 rounded-md ${focusRing} disabled:opacity-40`}
      indicatorClass="w-[18px] h-[18px] items-center justify-center border border-input bg-card rounded-[5px] checked:bg-foreground checked:border-foreground"
      indicator={p.checked ? <Icon name="check" size={13} tint="background" /> : null}
    >
      <Text style={{ numberOfLines: 2 }} class="flex-1 min-w-0 text-[15px] text-foreground">
        {p.label}
      </Text>
    </Checkbox>
  );
}

export function DateField(p: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
  emptyLabel?: string;
}) {
  return (
    <View class="gap-1.5">
      <Text class="text-[13px] font-medium text-muted-foreground">{p.label}</Text>
      <DatePicker
        accessibilityLabel={p.label}
        value={p.value || null}
        onChange={(e) => p.onChange(typeof e.value === "string" ? e.value : "")}
        trigger={
          <View class="min-h-11 md:min-h-10 flex-row items-center gap-2 border border-input bg-card rounded-lg px-3 py-2">
            <Icon name="calendar" size={15} />
            <Text class="text-[15px] text-foreground tabular-nums">
              {p.value
                ? p.value.slice(0, 4) >= "2888"
                  ? "Never"
                  : shortDate(p.value)
                : p.optional
                  ? (p.emptyLabel ?? "No date")
                  : "Choose date"}
            </Text>
          </View>
        }
        popupClass="bg-popover border border-border p-3 rounded-xl shadow-lg"
        calendarClass="gap-2"
        headerClass="flex-row justify-between items-center p-1"
        bodyClass="gap-1"
        rowClass="flex-row justify-between"
        itemClass="group w-10 h-10 items-center justify-center rounded-md hover:bg-accent selected:bg-foreground focus:bg-accent"
        previousAccessibilityLabel="Previous month"
        nextAccessibilityLabel="Next month"
        renderItem={(item) => (
          <Text class="text-[13px] tabular-nums text-foreground group-selected:text-background group-data-outside:text-muted-foreground">
            {item.kind === "previous"
              ? "Prev"
              : item.kind === "next"
                ? "Next"
                : item.kind === "weekday"
                  ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][item.value]
                  : item.kind === "monthToggle" || item.kind === "month"
                    ? new Date(item.year, item.value - 1, 1).toLocaleDateString(undefined, {
                        month: "short",
                      })
                    : String(item.value)}
          </Text>
        )}
        monthClass="gap-2"
      />
    </View>
  );
}
export function dateISO(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function addDays(value: string, days: number): string {
  const date = new Date(value.slice(0, 10) + "T12:00:00");
  date.setDate(date.getDate() + days);
  return dateISO(date);
}
export function shortDate(value: string): string {
  return new Date(value.slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}
export function dueDays(value?: string | null): number | null {
  if (!value || value.slice(0, 4) >= "2888") return null;
  const d = Date.parse(value.slice(0, 10) + "T12:00:00");
  return Number.isFinite(d)
    ? Math.round((d - Date.parse(dateISO() + "T12:00:00")) / 86400000)
    : null;
}
export function dueLabel(value?: string | null): string {
  const days = dueDays(value);
  if (days == null) return "";
  return days < 0
    ? `${Math.abs(days)} ${days === -1 ? "day" : "days"} overdue`
    : days === 0
      ? "Due today"
      : days === 1
        ? "Due tomorrow"
        : days <= 5
          ? `Due in ${days} days`
          : shortDate(value!);
}
/** Due text: destructive when overdue, amber within five days, muted after. */
export function Due(p: { value?: string | null }) {
  const days = dueDays(p.value) ?? 99;
  return (
    <Text
      class={`text-[13px] tabular-nums ${days < 0 ? "text-destructive" : days <= 5 ? "text-due" : "text-muted-foreground"}`}
    >
      {dueLabel(p.value)}
    </Text>
  );
}
/** Underlined tabs for switching views inside a screen or sheet. */
export function Tabs(p: { items: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <Scroll horizontal scrollbar={false} class="grow-0">
      <View class="flex-row gap-5 border-b border-border">
        <Each of={p.items}>
          {(item) => (
            <Button
              selected={p.value === item()}
              onPress={() => p.onChange(item())}
              class={`min-h-11 md:min-h-10 justify-center ${focusRing}`}
              style={{
                borderBottomWidth: 2,
                borderBottomColor: p.value === item() ? token("foreground") : "transparent",
              }}
            >
              <Text
                class={`text-sm ${p.value === item() ? "font-medium text-foreground" : "text-muted-foreground"}`}
              >
                {item()}
              </Text>
            </Button>
          )}
        </Each>
      </View>
    </Scroll>
  );
}
