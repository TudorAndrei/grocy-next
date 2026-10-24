import type { NutritionRecord } from "@/lib/types";
import { NUTRIENTS, formatNutrient } from "@/lib/nutrients";

export function NutritionPanel({ data }: { data: NutritionRecord }) {
  const nutrients = data.nutrients ?? {};
  const known = NUTRIENTS.filter((n) => n.key in nutrients);
  const extra = Object.keys(nutrients).filter((key) => !NUTRIENTS.some((n) => n.key === key));

  return (
    <section className="panel" aria-labelledby="nutrition-heading">
      <h2 className="panel-head" id="nutrition-heading">
        Nutrition
        <span>
          per {data.basis_quantity} {data.basis_unit} · revision {data.revision}
        </span>
      </h2>
      {known.length + extra.length === 0 ? (
        <p className="panel-empty">No nutrient values recorded yet.</p>
      ) : (
        <dl className="facts">
          {known.map((n) => (
            <div key={n.key} data-indent={n.indent ? "true" : undefined}>
              <dt>{n.label}</dt>
              <dd>{formatNutrient(nutrients[n.key], n.unit)}</dd>
            </div>
          ))}
          {extra.map((key) => (
            <div key={key}>
              <dt>{key.replace(/_/g, " ")}</dt>
              <dd>{formatNutrient((nutrients as Record<string, number | null>)[key], "")}</dd>
            </div>
          ))}
        </dl>
      )}
      {data.source?.type ? (
        <p className="panel-foot">
          Source: {data.source.type.replace(/_/g, " ")}
          {data.source.note ? ` · ${data.source.note}` : ""}
        </p>
      ) : null}
    </section>
  );
}
