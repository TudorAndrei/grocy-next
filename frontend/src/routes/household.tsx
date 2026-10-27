import type { JsonObject } from "@/lib/json";
import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EntityManager } from "@/components/EntityManager";
import { ErrorBlock } from "@/components/ErrorBlock";
import { api, request } from "@/lib/api";
import type { EntityRow } from "@/lib/entities";

export const Route = createFileRoute("/household")({
  component: HouseholdPage,
});

function localTime() {
  const now = new Date();

  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function displayTime(value: string | null | undefined) {
  if (!value || String(value).startsWith("2999-")) return "No scheduled date";
  const date = new Date(String(value).replace(" ", "T"));

  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function HouseholdPage() {
  const client = useQueryClient();
  const [entity, setEntity] = useState("chores");
  const [recording, setRecording] = useState<EntityRow | null>(null);
  const [merging, setMerging] = useState<EntityRow | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [trackedTime, setTrackedTime] = useState(localTime);
  const [doneBy, setDoneBy] = useState("");
  const [skipped, setSkipped] = useState(false);

  const records = useQuery({
    queryKey: ["objects", entity],
    queryFn: () => api.objects(entity),
  });

  const current = useQuery({
    queryKey: ["household-current", entity],
    queryFn: () => request<EntityRow[]>(`/api/${entity}`),
  });

  const users = useQuery({
    queryKey: ["objects", "users"],
    queryFn: () => request<EntityRow[]>("/api/users"),
    enabled: Boolean(recording) && entity === "chores",
  });

  const logsEntity = entity === "chores" ? "chores_log" : "battery_charge_cycles";

  const history = useQuery({
    queryKey: ["objects", logsEntity],
    queryFn: () => api.objects(logsEntity),
    enabled: entity !== "tasks",
  });

  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: JsonObject }) =>
      api.action(path, body ?? {}),
    onSuccess: async () => {
      setRecording(null);
      setMerging(null);
      await client.invalidateQueries();
    },
  });

  const record = (row: EntityRow, skip = false) => {
    action.reset();
    setRecording(row);
    setMerging(null);
    setTrackedTime(localTime());
    setDoneBy("");
    setSkipped(skip);
  };

  const submitRecord = (event: FormEvent) => {
    event.preventDefault();

    if (!recording) return;

    const body: JsonObject = {};
    body[entity === "tasks" ? "done_time" : "tracked_time"] =
      trackedTime.replace("T", " ") + (trackedTime.length === 16 ? ":00" : "");

    if (entity === "chores") {
      body.skipped = skipped;

      if (doneBy) body.done_by = Number(doneBy);
    }

    action.mutate({
      path:
        entity === "tasks"
          ? `/api/tasks/${recording.id}/complete`
          : `/api/${entity}/${recording.id}/${entity === "chores" ? "execute" : "charge"}`,
      body,
    });
  };

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
              setRecording(null);
              setMerging(null);
              action.reset();
            }}
          >
            {value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>
      {action.error && <ErrorBlock message={action.error.message} />}
      {current.error && <ErrorBlock message={current.error.message} />}
      {recording && (
        <form
          className="panel panel-inner"
          onSubmit={submitRecord}
          aria-label={`Record ${recording.name}`}
        >
          <h2>
            {skipped ? "Skip" : entity === "tasks" ? "Complete" : "Record"} {recording.name}
          </h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="household-time">
                {entity === "tasks" ? "Completion time" : "Recorded time"}
              </label>
              <input
                id="household-time"
                type="datetime-local"
                required
                value={trackedTime}
                onChange={(e) => setTrackedTime(e.target.value)}
              />
            </div>
            {entity === "chores" && (
              <div className="field">
                <label htmlFor="household-user">Done by</label>
                <select
                  id="household-user"
                  value={doneBy}
                  onChange={(e) => setDoneBy(e.target.value)}
                >
                  <option value="">Current user</option>
                  {users.data?.map((user) => (
                    <option key={user.id} value={user.id}>
                      {String(user.display_name ?? user.username)}
                    </option>
                  ))}
                </select>
                {users.error && <ErrorBlock message={users.error.message} />}
              </div>
            )}
          </div>
          {skipped && Boolean(recording.consume_product_on_execution) && (
            <p>This chore will also consume its configured stock amount.</p>
          )}
          <div className="actions">
            <button className="btn btn-primary" disabled={action.isPending}>
              {skipped ? "Save skipped execution" : "Save record"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={action.isPending}
              onClick={() => setRecording(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {merging && (
        <form
          className="panel panel-inner"
          aria-label="Merge chores"
          onSubmit={(event) => {
            event.preventDefault();
            action.mutate({
              path: `/api/chores/${mergeTarget}/merge/${merging.id}`,
            });
          }}
        >
          <h2>Merge {merging.name}</h2>
          <p>Move this chore's history to another chore, then delete this chore.</p>
          <div className="field">
            <label htmlFor="merge-target">Chore to keep</label>
            <select
              id="merge-target"
              required
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
            >
              <option value="">Select a chore</option>
              {records.data
                ?.filter((row) => row.id !== merging.id)
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="actions">
            <button className="btn btn-primary" disabled={action.isPending}>
              Merge chores
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={action.isPending}
              onClick={() => setMerging(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <EntityManager
        key={entity}
        entity={entity}
        detail={(row) => {
          const state = current.data?.find((item) => item.id === row.id);

          const assigned = state?.next_execution_assigned_user ?? state?.assigned_to_user;

          return (
            <>
              <h3>{row.name}</h3>
              {row.description && <p>{row.description}</p>}
              <p className="muted">
                {entity === "tasks"
                  ? row.done
                    ? `Completed ${displayTime(row.done_timestamp)}`
                    : `Due ${displayTime(row.due_date)}`
                  : row.active === 0
                    ? "Inactive"
                    : `Next ${displayTime(state?.[entity === "chores" ? "next_estimated_execution_time" : "next_estimated_charge_time"])}`}
              </p>
              {assigned && <p>Assigned to {String(assigned.display_name ?? assigned.username)}</p>}
            </>
          );
        }}
        actions={(row) => (
          <>
            <button
              className="btn btn-primary"
              disabled={action.isPending || row.active === 0}
              onClick={() =>
                entity === "tasks" && row.done
                  ? action.mutate({ path: `/api/tasks/${row.id}/undo` })
                  : record(row)
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
            {entity === "chores" && row.period_type !== "manually" && (
              <button
                className="btn btn-ghost"
                disabled={action.isPending || row.active === 0}
                onClick={() => record(row, true)}
              >
                Skip
              </button>
            )}
            {entity === "chores" && (
              <button
                className="btn btn-ghost"
                disabled={action.isPending}
                onClick={() => {
                  action.reset();
                  setMerging(row);
                  setMergeTarget("");
                  setRecording(null);
                }}
              >
                Merge
              </button>
            )}
          </>
        )}
      />
      {entity === "chores" && (
        <button
          className="btn btn-ghost"
          disabled={action.isPending}
          onClick={() =>
            action.mutate({
              path: "/api/chores/executions/calculate-next-assignments",
            })
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
                    {records.data?.find((record) => record.id === (row.chore_id ?? row.battery_id))
                      ?.name ?? `#${String(row.chore_id ?? row.battery_id)}`}{" "}
                    {row.skipped ? "skipped" : "recorded"} {displayTime(row.tracked_time)}
                    {row.undone ? " (undone)" : ""}
                  </span>
                  {!row.undone && (
                    <button
                      className="btn btn-ghost"
                      disabled={action.isPending}
                      onClick={() =>
                        action.mutate({
                          path:
                            entity === "chores"
                              ? `/api/chores/executions/${row.id}/undo`
                              : `/api/batteries/charge-cycles/${row.id}/undo`,
                        })
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
