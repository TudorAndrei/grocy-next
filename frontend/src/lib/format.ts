export function formatAmount(value: number | string | null | undefined, decimalPlaces = 4): string {
  if (value === null || value === undefined) {
    return "0";
  }

  const num = Number(value);

  if (!Number.isFinite(num)) {
    return String(value);
  }

  const rounded = num.toFixed(decimalPlaces);

  return rounded.includes(".") ? rounded.replace(/\.?0+$/, "") : rounded;
}

export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export type DueTone = "ok" | "warn" | "danger" | null;

export function dueTone(bestBefore: string | null | undefined, soonDays = 5): DueTone {
  if (!bestBefore) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(bestBefore.includes("T") ? bestBefore : `${bestBefore}T00:00:00`);

  if (Number.isNaN(due.getTime())) return null;
  const diffDays = Math.floor((due.getTime() - today.getTime()) / 86_400_000);

  if (diffDays < 0) return "danger";

  if (diffDays <= soonDays) return "warn";

  return "ok";
}

export function dueLabel(bestBefore: string | null | undefined, soonDays = 5): string {
  const tone = dueTone(bestBefore, soonDays);
  const formatted = formatDate(bestBefore);

  if (!formatted || !tone) return "No date";

  if (tone === "danger") return `Expired ${formatted}`;

  if (tone === "warn") return `Due ${formatted}`;

  return formatted;
}

function parseDay(value: string): Date {
  return new Date(value.includes("T") ? value : `${value}T00:00:00`);
}

/** Whole days from today to the date; negative when it is in the past. */
export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;
  const date = parseDay(value);

  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);

  return Math.round((date.getTime() - today.getTime()) / 86_400_000);
}

export function daysLabel(days: number): string {
  if (days === 0) return "Today";

  if (days === 1) return "Tomorrow";

  if (days === -1) return "Yesterday";

  return days < 0 ? `${-days} d ago` : `${days} d`;
}

export function todayLine(date = new Date()): string {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function relativeTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);

  if (minutes < 1) return "just now";

  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);

  if (hours < 24) return `${hours} h ago`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const UNIT_SHORT = new Map<string, string>(
  Object.entries({
    gram: "g",
    kilogram: "kg",
    milliliter: "ml",
    millilitre: "ml",
    liter: "L",
    litre: "L",
  }),
);

export function unitLabel(
  unit:
    | { name: string; name_plural?: string | null; plural_forms?: string | null; active?: number }
    | undefined,
  amount: number,
  pluralIndex: (count: number) => number = (count) => (Math.abs(count) === 1 ? 0 : 1),
  abbreviate = true,
): string {
  if (!unit) return "";
  const index = pluralIndex(Math.abs(amount));

  if (unit.plural_forms && unit.active !== 0) {
    const forms = [unit.name, ...unit.plural_forms.split(/\r\n|\r|\n/)];

    return forms[index] || (index === 0 ? unit.name : unit.name_plural || unit.name);
  }

  if (!abbreviate) return index === 0 ? unit.name : unit.name_plural || unit.name;

  const short = UNIT_SHORT.get(unit.name.toLowerCase());

  if (short) return short;

  if (unit.name.toLowerCase() === "piece") return index === 0 ? "pc" : "pcs";

  return index === 0 ? unit.name : unit.name_plural || unit.name;
}

/** Today's date as yyyy-mm-dd plus an offset, for date inputs. */
export function isoDay(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
