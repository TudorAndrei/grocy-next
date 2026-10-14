import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EntityManager } from "@/components/EntityManager";
import { ErrorBlock } from "@/components/ErrorBlock";
import { api } from "@/lib/api";
export const Route = createFileRoute("/household")({
  component: HouseholdPage,
});
function HouseholdPage() {
  const client = useQueryClient();
  const [entity, setEntity] = useState("chores");
  const logsEntity =
    entity === "chores" ? "chores_log" : "battery_charge_cycles";
  const history = useQuery({
    queryKey: ["objects", logsEntity],
    queryFn: () => api.objects(logsEntity),
    enabled: entity !== "tasks",
  });
  const action = useMutation({
    mutationFn: (path: string) => api.action(path),
    onSuccess: async () => {
      await client.invalidateQueries();
    },
  });
  return (
    <>
      <h1 className="page-title">Household</h1>
      <p className="page-lead">Manage chores, tasks, and battery charges.</p>
      <div className="tabs" role="group" aria-label="Household type">
        {["chores", "tasks", "batteries"].map((value) => (
          <button
            key={value}
            className="btn btn-ghost"
            aria-pressed={entity === value}
            onClick={() => {
              setEntity(value);
              action.reset();
            }}
          >
            {value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>
      {action.error && <ErrorBlock message={action.error.message} />}
      <EntityManager
        key={entity}
        entity={entity}
        actions={(row) => (
          <button
            className="btn btn-primary"
            disabled={action.isPending}
            onClick={() =>
              action.mutate(
                entity === "tasks"
                  ? `/api/tasks/${row.id}/${row.done ? "undo" : "complete"}`
                  : entity === "chores"
                    ? `/api/chores/${row.id}/execute`
                    : `/api/batteries/${row.id}/charge`,
              )
            }
          >
            {entity === "tasks"
              ? row.done
                ? "Reopen"
                : "Complete"
              : entity === "chores"
                ? "Record execution"
                : "Record charge"}
          </button>
        )}
      />
      {entity === "chores" && (
        <button
          className="btn btn-ghost"
          disabled={action.isPending}
          onClick={() =>
            action.mutate("/api/chores/executions/calculate-next-assignments")
          }
        >
          Calculate next assignments
        </button>
      )}
      {entity !== "tasks" && (
        <section>
          <h2>History</h2>
          {history.error && <ErrorBlock message={history.error.message} />}
          <ul className="product-list">
            {history.data
              ?.slice()
              .reverse()
              .slice(0, 20)
              .map((row) => (
                <li key={row.id} className="product-row">
                  <span>
                    #{String(row.chore_id ?? row.battery_id)} recorded{" "}
                    {String(row.tracked_time).replace("T", " ")}
                    {row.undone ? " (undone)" : ""}
                  </span>
                  {!row.undone && (
                    <button
                      className="btn btn-ghost"
                      disabled={action.isPending}
                      onClick={() =>
                        action.mutate(
                          entity === "chores"
                            ? `/api/chores/executions/${row.id}/undo`
                            : `/api/batteries/charge-cycles/${row.id}/undo`,
                        )
                      }
                    >
                      Undo
                    </button>
                  )}
                </li>
              ))}
          </ul>
        </section>
      )}
    </>
  );
}
