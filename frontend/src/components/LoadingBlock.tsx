export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return <p className="muted">{label}</p>;
}
