import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { useChoreActions } from "@/lib/householdActions";
import { ErrorBlock } from "@/components/ErrorBlock";
import { HouseholdTable } from "@/components/HouseholdTable";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/chores")({
  component: ChoresPage,
});

function ChoresPage() {
  const chores = useQuery({ queryKey: queryKeys.chores, queryFn: api.listChores });
  const { execute } = useChoreActions();

  return (
    <>
      <PageHeader
        title="Chores"
        lead="Recurring work. Track a chore when it is done; the next date follows its period."
      />
      {chores.isLoading ? <LoadingBlock label="Loading chores…" /> : null}
      {chores.isError ? <ErrorBlock message={chores.error.message} /> : null}
      {chores.isSuccess && chores.data.length === 0 ? (
        <p className="empty-state">No chores set up yet.</p>
      ) : null}
      {chores.data?.length ? (
        <HouseholdTable
          dueLabel="Next"
          rows={chores.data.map((chore) => ({
            id: chore.id,
            name: chore.name,
            detail: [chore.period_type, chore.description].filter(Boolean).join(" · "),
            due: chore.next_estimated_execution_time,
            dueEmpty: "No schedule",
            action: (
              <button
                type="button"
                className="btn btn-sm"
                disabled={execute.isPending && execute.variables === chore.id}
                onClick={() => execute.mutate(chore.id)}
              >
                Done
              </button>
            ),
          }))}
        />
      ) : null}
    </>
  );
}
