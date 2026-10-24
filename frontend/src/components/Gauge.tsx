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
  if (!(min > 0)) {
    return (
      <span className="gauge" data-state="none" role="img" aria-label={`${label}, no minimum set`}>
        <span className="gauge-none">no min</span>
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
      aria-label={`${label}, ${Math.round((amount / min) * 100)}% of minimum`}
    >
      <span className="gauge-fill" style={{ width: `${ratio * 100}%` }} />
      <span className="gauge-min" />
    </span>
  );
}
