import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, queryKeys } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/household")({
  component: HouseholdPage,
});

type Tab = "chores" | "tasks" | "batteries";

function HouseholdPage() {
  const [tab, setTab] = useState<Tab>("chores");
  const queryClient = useQueryClient();

  const choresQuery = useQuery({
    queryKey: queryKeys.chores,
    queryFn: () => api.listChores(),
  });
  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks,
    queryFn: () => api.listTasks(false),
  });
  const batteriesQuery = useQuery({
    queryKey: queryKeys.batteries,
    queryFn: () => api.listBatteries(),
  });

  const executeChore = useMutation({
    mutationFn: (id: number) => api.executeChore(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.chores });
    },
  });
  const completeTask = useMutation({
    mutationFn: (id: number) => api.completeTask(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
    },
  });
  const chargeBattery = useMutation({
    mutationFn: (id: number) => api.chargeBattery(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.batteries });
    },
  });

  return (
    <>
      <PageHeader
        title="Household"
        lead="Chores, tasks, and batteries — the recurring work that keeps the home running."
      />

      <div className="tabs" role="tablist" aria-label="Household sections">
        {(
          [
            ["chores", "Chores", choresQuery.data?.length],
            ["tasks", "Tasks", tasksQuery.data?.length],
            ["batteries", "Batteries", batteriesQuery.data?.length],
          ] as const
        ).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === id}
            data-active={tab === id ? "true" : "false"}
            onClick={() => setTab(id)}
          >
            {label}
            {typeof count === "number" ? ` (${count})` : ""}
          </button>
        ))}
      </div>

      {tab === "chores" ? (
        <>
          {choresQuery.isLoading ? <LoadingBlock label="Loading chores…" /> : null}
          {choresQuery.isError ? (
            <ErrorBlock
              message={
                choresQuery.error instanceof Error
                  ? choresQuery.error.message
                  : "Could not load chores."
              }
            />
          ) : null}
          {choresQuery.isSuccess ? (
            choresQuery.data.length === 0 ? (
              <p className="empty-state">No chores configured.</p>
            ) : (
              <section className="panel">
                <div className="panel-inner" style={{ padding: 0 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Chore</th>
                        <th>Period</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {choresQuery.data.map((chore) => (
                        <tr key={chore.id}>
                          <td>
                            <strong>{chore.name}</strong>
                          </td>
                          <td className="muted">{chore.period_type}</td>
                          <td>
                            <div className="actions">
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={executeChore.isPending}
                                onClick={() => executeChore.mutate(chore.id)}
                              >
                                Execute
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          ) : null}
        </>
      ) : null}

      {tab === "tasks" ? (
        <>
          {tasksQuery.isLoading ? <LoadingBlock label="Loading tasks…" /> : null}
          {tasksQuery.isError ? (
            <ErrorBlock
              message={
                tasksQuery.error instanceof Error
                  ? tasksQuery.error.message
                  : "Could not load tasks."
              }
            />
          ) : null}
          {tasksQuery.isSuccess ? (
            tasksQuery.data.length === 0 ? (
              <p className="empty-state">No open tasks.</p>
            ) : (
              <section className="panel">
                <div className="panel-inner" style={{ padding: 0 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Task</th>
                        <th>Due</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {tasksQuery.data.map((task) => (
                        <tr key={task.id}>
                          <td>
                            <strong>{task.name}</strong>
                            {task.description ? (
                              <p className="muted" style={{ margin: "0.2rem 0 0" }}>
                                {task.description}
                              </p>
                            ) : null}
                          </td>
                          <td className="muted">{formatDate(task.due_date) ?? "—"}</td>
                          <td>
                            <div className="actions">
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={completeTask.isPending}
                                onClick={() => completeTask.mutate(task.id)}
                              >
                                Complete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          ) : null}
        </>
      ) : null}

      {tab === "batteries" ? (
        <>
          {batteriesQuery.isLoading ? <LoadingBlock label="Loading batteries…" /> : null}
          {batteriesQuery.isError ? (
            <ErrorBlock
              message={
                batteriesQuery.error instanceof Error
                  ? batteriesQuery.error.message
                  : "Could not load batteries."
              }
            />
          ) : null}
          {batteriesQuery.isSuccess ? (
            batteriesQuery.data.length === 0 ? (
              <p className="empty-state">No batteries tracked.</p>
            ) : (
              <section className="panel">
                <div className="panel-inner" style={{ padding: 0 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Battery</th>
                        <th>Next charge</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {batteriesQuery.data.map((battery) => (
                        <tr key={battery.id}>
                          <td>
                            <strong>{battery.name}</strong>
                            {battery.description ? (
                              <p className="muted" style={{ margin: "0.2rem 0 0" }}>
                                {battery.description}
                              </p>
                            ) : null}
                          </td>
                          <td className="muted">
                            {formatDate(battery.next_estimated_charge_time) ?? "—"}
                          </td>
                          <td>
                            <div className="actions">
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={chargeBattery.isPending}
                                onClick={() => chargeBattery.mutate(battery.id)}
                              >
                                Charge
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          ) : null}
        </>
      ) : null}
    </>
  );
}
