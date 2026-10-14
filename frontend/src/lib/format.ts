export function formatAmount(value: number | string | null | undefined): string {
  if (value === null || value === undefined) {
    return "0";
  }
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) {
    return String(value);
  }
  return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.?0+$/, "");
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
