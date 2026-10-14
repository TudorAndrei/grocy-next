import type { NutritionRecord } from "@/lib/types";

type NutritionPanelProps = {
  data: NutritionRecord;
};

function formatNutrientValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) {
    return String(value);
  }
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
}

export function NutritionPanel({ data }: NutritionPanelProps) {
  const entries = Object.entries(data.nutrients ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <section className="panel" aria-labelledby="nutrition-heading">
      <div className="panel-inner">
        <h2 id="nutrition-heading" className="page-title" style={{ fontSize: "1.25rem" }}>
          Nutrition
        </h2>
        <p className="muted" style={{ marginTop: "-0.25rem", marginBottom: "1rem" }}>
          Per {data.basis_quantity} {data.basis_unit} · revision {data.revision}
        </p>
        {entries.length === 0 ? (
          <p className="empty-state">No nutrient fields recorded yet.</p>
        ) : (
          <dl className="nutrient-grid">
            {entries.map(([key, value]) => (
              <div key={key}>
                <dt>{key.replace(/_/g, " ")}</dt>
                <dd>{formatNutrientValue(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}
