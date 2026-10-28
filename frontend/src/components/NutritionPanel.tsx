import { useI18n } from "@/lib/i18n";
import type { NutritionRecord } from "@/lib/types";
import { NUTRIENTS, formatNutrient } from "@/lib/nutrients";

export function NutritionPanel({ data }: { data: NutritionRecord }) {
  const { t: tr } = useI18n();

  const nutrients = data.nutrients ?? {};
  const known = NUTRIENTS.filter((n) => n.key in nutrients);
  const extra = Object.entries(nutrients).filter(([key]) => !NUTRIENTS.some((n) => n.key === key));

  return (
    <section className="panel" aria-labelledby="nutrition-heading">
      <h2 className="panel-head" id="nutrition-heading">
        {tr("Nutrition")}
        <span>
          {tr("per")} {data.basis_quantity} {data.basis_unit} {tr("· revision")} {data.revision}
        </span>
      </h2>
      {known.length + extra.length === 0 ? (
        <p className="panel-empty">{tr("No nutrient values recorded yet.")}</p>
      ) : (
        <dl className="facts">
          {known.map((n) => (
            <div key={n.key} data-indent={n.indent ? "true" : undefined}>
              <dt>{tr(n.label)}</dt>
              <dd>{formatNutrient(nutrients[n.key], n.unit)}</dd>
            </div>
          ))}
          {extra.map(([key, value]) => (
            <div key={key}>
              <dt>{key.replace(/_/g, " ")}</dt>
              <dd>{formatNutrient(value, "")}</dd>
            </div>
          ))}
        </dl>
      )}
      {data.source?.type ? (
        <p className="panel-foot">
          {tr("Source:")} {data.source.type.replace(/_/g, " ")}
          {data.source.note ? ` · ${data.source.note}` : ""}
        </p>
      ) : null}
    </section>
  );
}
