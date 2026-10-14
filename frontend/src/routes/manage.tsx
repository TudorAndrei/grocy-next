import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EntityManager } from "@/components/EntityManager";
import { AccessManager } from "@/components/AccessManager";
import { entities } from "@/lib/entities";
export const Route = createFileRoute("/manage")({ component: ManagePage });
function ManagePage() {
  const [entity, setEntity] = useState("locations");
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
  ];
  return (
    <>
      <h1 className="page-title">Manage household data</h1>
      <p className="page-lead">
        Set up locations, units, groups, and household access.
      </p>
      <div className="field">
        <label htmlFor="manage-entity">Data type</label>
        <select
          id="manage-entity"
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
        >
          {choices.map((value) => (
            <option key={value} value={value}>
              {entities[value].label}
            </option>
          ))}
          <option value="access">Users and API keys</option>
        </select>
      </div>
      {entity === "access" ? (
        <AccessManager />
      ) : (
        <EntityManager key={entity} entity={entity} />
      )}
    </>
  );
}
