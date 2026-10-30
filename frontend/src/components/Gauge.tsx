import { useI18n } from "@/lib/i18n";

type GaugeProps = {
  amount: number;
  min: number;
  label: string;
};

/**
 * The canister: fill is the amount on a scale of twice the minimum, with a
 * tick at the minimum. Products without a minimum get an empty rim, not a
 * made-up fill.
 */
export function Gauge({ amount, min, label }: GaugeProps) {
  const { t: tr } = useI18n();

  if (!(min > 0)) {
    return (
      <span
        className="gauge"
        data-state="none"
        role="img"
        aria-label={tr("%s, no minimum set", String(label))}
      >
        <span className="gauge-none">{tr("no min")}</span>
      </span>
    );
  }

  const ratio = Math.max(0, Math.min(1, amount / (min * 2)));
  const state = amount <= 0 ? "empty" : amount < min ? "low" : "ok";

  return (
    <span
      className="gauge"
      data-state={state}
      role="img"
      aria-label={tr(
        "%1$s, %2$s%% of minimum",
        String(label),
        String(Math.round((amount / min) * 100)),
      )}
    >
      <span className="gauge-fill" style={{ width: `${ratio * 100}%` }} />
      <span className="gauge-min" />
    </span>
  );
}
