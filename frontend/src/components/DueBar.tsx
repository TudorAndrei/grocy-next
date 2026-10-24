import { daysLabel } from "@/lib/format";

export const DUE_WINDOW_DAYS = 14;

/** Bar length is the real number of days left on one 14-day scale. */
export function DueBar({ days }: { days: number }) {
  const tone = days < 0 ? "danger" : days <= 5 ? "warn" : "ok";
  const width = days < 0 ? 3 : Math.max(3, Math.min(100, (days / DUE_WINDOW_DAYS) * 100));
  return (
    <span className="due-bar" data-tone={tone}>
      <span className="due-track" aria-hidden="true">
        <span className="due-fill" style={{ width: `${width}%` }} />
      </span>
      <span className="due-days">{daysLabel(days)}</span>
    </span>
  );
}
