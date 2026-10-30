import { useI18n } from "@/lib/i18n";
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EntityManager } from "@/components/EntityManager";
import { AccessManager } from "@/components/AccessManager";
import { entities } from "@/lib/entities";
import { useFeatures } from "@/lib/features";
import { ResolvedConversionsDialog } from "@/components/ResolvedConversions";

export const Route = createFileRoute("/manage")({ component: ManagePage });

function ManagePage() {
  const { t: tr } = useI18n();

  const [selection, setEntity] = useState("locations");
  const [resolved, setResolved] = useState(false);
  const features = useFeatures();

  const choices = [
    "locations",
    "shopping_locations",
    "userfields",
    "userentities",
    "userobjects",
    "quantity_units",
    "quantity_unit_conversions",
    "product_groups",
    "product_barcodes",
    "meal_plan_sections",
    "task_categories",
    "shopping_lists",
  ].filter((value) => {
    if (value === "locations") return features.routeEnabled("/locations");

    if (value === "shopping_locations")
      return features.enabled("STOCK") && features.enabled("STOCK_PRICE_TRACKING");

    if (value === "product_barcodes") return features.enabled("STOCK");

    if (value === "meal_plan_sections") return features.routeEnabled("/meal-plan");

    if (value === "task_categories") return features.enabled("TASKS");

    if (value === "shopping_lists")
      return features.enabled("SHOPPINGLIST") && features.enabled("SHOPPINGLIST_MULTIPLE_LISTS");

    return true;
  });

  const entity =
    selection === "access" || choices.includes(selection) ? selection : (choices[0] ?? "access");

  return (
    <>
      <h1 className="page-title">{tr("Manage household data")}</h1>
      <p className="page-lead">{tr("Set up locations, units, groups, and household access.")}</p>
      <div className="field">
        <label htmlFor="manage-entity">{tr("Data type")}</label>
        <select id="manage-entity" value={entity} onChange={(e) => setEntity(e.target.value)}>
          {choices.map((value) => (
            <option key={value} value={value}>
              {tr(entities.get(value)?.label ?? value)}
            </option>
          ))}
          <option value="access">{tr("Users and API keys")}</option>
        </select>
      </div>
      {entity === "quantity_units" || entity === "quantity_unit_conversions" ? (
        <button type="button" className="btn" onClick={() => setResolved(true)}>
          {tr("Show resolved conversions")}
        </button>
      ) : null}
      {entity === "access" ? <AccessManager /> : <EntityManager key={entity} entity={entity} />}
      {resolved ? <ResolvedConversionsDialog onClose={() => setResolved(false)} /> : null}
    </>
  );
}
