import { useI18n } from "@/lib/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { useChoreActions } from "@/lib/householdActions";
import { ErrorBlock } from "@/components/ErrorBlock";
import { HouseholdTable } from "@/components/HouseholdTable";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/tasks")({
  component: TasksPage,
});

function TasksPage() {
  const { t: tr } = useI18n();

  const tasks = useQuery({ queryKey: queryKeys.tasks, queryFn: () => api.listTasks(false) });
  const { complete } = useChoreActions();

  return (
    <>
      <PageHeader title={tr("Tasks")} lead={tr("One-off jobs with an optional due date.")} />
      {tasks.isLoading ? <LoadingBlock label={tr("Loading tasks…")} /> : null}
      {tasks.isError ? <ErrorBlock message={tasks.error.message} /> : null}
      {tasks.isSuccess && tasks.data.length === 0 ? (
        <p className="empty-state">{tr("No open tasks.")}</p>
      ) : null}
      {tasks.data?.length ? (
        <HouseholdTable
          dueLabel={tr("Due")}
          rows={tasks.data.map((task) => ({
            id: task.id,
            name: task.name,
            detail: task.description,
            due: task.due_date,
            dueEmpty: tr("No due date"),
            action: (
              <button
                type="button"
                className="btn btn-sm"
                disabled={complete.isPending && complete.variables === task.id}
                onClick={() => complete.mutate(task.id)}
              >
                {tr("Complete")}
              </button>
            ),
          }))}
        />
      ) : null}
    </>
  );
}
