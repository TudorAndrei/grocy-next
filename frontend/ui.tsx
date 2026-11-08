import { Scroll, Text, View, type JSX } from "nsh";
import { Button, Input, Select, Sheet, DatePicker, Checkbox } from "nsh/base";
export const color = {
  ink: "#1b1d1c",
  muted: "#5e625f",
  accent: "#22603f",
  paper: "#f7f7f5",
  line: "#e4e4e0",
  danger: "#b3261e",
};
export function Action(p: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  quiet?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Button
      accessibilityLabel={p.accessibilityLabel ?? p.label}
      onPress={p.onPress}
      disabled={p.disabled}
      class="min-h-11 rounded-lg px-3 py-2 justify-center items-center hover:bg-[#f0f0ec] focus:outline-2 focus:outline-offset-2 focus:outline-[#22603f] disabled:opacity-40"
      style={{
        backgroundColor: p.primary ? color.accent : p.quiet ? "transparent" : "#ffffff",
        borderWidth: p.primary || p.quiet ? 0 : 1,
        borderColor: "#c9c9c3",
      }}
    >
      <Text
        style={{
          color: p.primary ? "#ffffff" : p.danger ? color.danger : color.ink,
          fontSize: 14,
          fontWeight: "600",
        }}
      >
        {p.label}
      </Text>
    </Button>
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
    <View class="gap-2 min-w-0">
      <Text class="text-sm font-medium text-[#5e625f]">{p.label}</Text>
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
        class="min-h-11 rounded-lg border border-[#c9c9c3] bg-white px-3 py-2 text-base text-[#1b1d1c] focus:outline-2 focus:outline-[#22603f]"
      />
    </View>
  );
}
export function Heading(p: { title: string; detail?: string }) {
  return (
    <Text role="header" class="text-[22px] font-semibold text-[#1b1d1c]">
      {p.title}
    </Text>
  );
}
export function Line(p: { children?: JSX.Element }) {
  return <View class="py-3 border-b border-[#e4e4e0] gap-2">{p.children}</View>;
}
export function Note(p: { children?: JSX.Element; error?: boolean }) {
  return (
    <Text
      role={p.error ? "alert" : "text"}
      style={{
        color: p.error ? color.danger : color.muted,
        fontSize: 14,
        lineHeight: 20,
      }}
    >
      {p.children}
    </Text>
  );
}
export function Choice(p: {
  label: string;
  value: string;
  items: { value: string; title: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <View class="gap-2">
      <Text class="text-sm font-medium text-[#5e625f]">{p.label}</Text>
      <Select
        accessibilityLabel={p.label}
        searchable
        searchAccessibilityLabel={`Search ${p.label}`}
        value={p.value || null}
        items={p.items}
        onChange={(e) => p.onChange(e.value ?? "")}
        trigger={
          <View class="min-h-11 border border-[#c9c9c3] rounded-lg px-3 py-2 justify-center">
            <Text class="text-base text-[#1b1d1c]">
              {p.items.find((i) => i.value === p.value)?.title ?? "Choose…"}
            </Text>
          </View>
        }
        popupClass="bg-white rounded-xl p-2"
        itemClass="min-h-11 px-3 py-2 focus:bg-[#f0f0ec] selected:bg-[#edf2ee]"
        searchClass="p-3 border border-[#c9c9c3]"
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
      backdropClass="bg-black/25"
      popupClass="w-full md:w-[440px] h-full bg-white"
    >
      <View class="flex-1 min-h-0">
        <View class="flex-row items-center justify-between gap-3 px-5 py-4 border-b border-[#e4e4e0]">
          <View class="flex-1 min-w-0">
            <Heading title={p.title} />
          </View>
          <Action label="Close" quiet disabled={p.busy} onPress={p.onClose} />
        </View>
        <Scroll class="flex-1">
          <View class="p-5 gap-5">{p.children}</View>
        </Scroll>
        {p.footer ? (
          <View class="px-5 py-4 border-t border-[#e4e4e0] gap-2 pb-4">
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
      class="flex-row items-center gap-3 min-h-11"
      indicatorClass="w-5 h-5 items-center justify-center border border-[#c9c9c3] rounded checked:bg-[#22603f] checked:border-[#22603f]"
      indicator={
        p.checked ? <View class="w-2 h-3 border-r-2 border-b-2 border-white rotate-45" /> : null
      }
    >
      <Text style={{ numberOfLines: 2 }} class="flex-1 min-w-0 text-sm text-[#1b1d1c]">
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
    <View class="gap-2">
      <Text class="text-sm text-[#5e625f]">{p.label}</Text>
      <DatePicker
        accessibilityLabel={p.label}
        value={p.value || null}
        onChange={(e) => p.onChange(typeof e.value === "string" ? e.value : "")}
        trigger={
          <View class="min-h-11 border border-[#c9c9c3] rounded-lg p-3">
            <Text class="text-sm text-[#1b1d1c]">
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
        popupClass="bg-white p-4 rounded-xl"
        calendarClass="gap-2"
        headerClass="flex-row justify-between p-2"
        bodyClass="gap-1"
        rowClass="flex-row justify-between"
        itemClass="group w-10 h-11 items-center justify-center rounded selected:bg-[#22603f] selected:text-white focus:bg-[#edf2ee]"
        previousAccessibilityLabel="Previous month"
        nextAccessibilityLabel="Next month"
        renderItem={(item) => (
          <Text class="text-[13px] text-[#1b1d1c] group-selected:text-white group-data-outside:text-[#5e625f]">
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
    ? `${Math.abs(days)} days overdue`
    : days === 0
      ? "Due today"
      : days === 1
        ? "Due tomorrow"
        : days <= 5
          ? `Due in ${days} days`
          : shortDate(value!);
}
export function Due(p: { value?: string | null }) {
  return (
    <Text
      style={{
        fontSize: 13,
        color:
          (dueDays(p.value) ?? 99) < 0
            ? color.danger
            : (dueDays(p.value) ?? 99) <= 5
              ? "#8a5a00"
              : color.muted,
      }}
    >
      {dueLabel(p.value)}
    </Text>
  );
}
export function Tabs(p: { items: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <View class="flex-row gap-4 border-b border-[#e4e4e0]">
      <Each of={p.items}>
        {(item) => (
          <Button
            selected={p.value === item()}
            onPress={() => p.onChange(item())}
            class="min-h-11 justify-center focus:outline-2 focus:outline-[#22603f]"
            style={{
              borderBottomWidth: p.value === item() ? 2 : 0,
              borderBottomColor: color.accent,
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: p.value === item() ? "600" : "400",
                color: p.value === item() ? color.accent : color.muted,
              }}
            >
              {item()}
            </Text>
          </Button>
        )}
      </Each>
    </View>
  );
}
