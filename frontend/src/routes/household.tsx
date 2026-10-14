import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";

export const Route = createFileRoute("/household")({
  component: HouseholdPage,
});

function HouseholdPage() {
  const queryClient = useQueryClient();
  const choresQuery = useQuery({
    queryKey: queryKeys.chores,
    queryFn: () => api.listChores(),
  });
  const execute = useMutation({
    mutationFn: (id: number) => api.executeChore(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.chores });
    },
  });

  return (
    <>
      <h1 className="page-title">Household</h1>
      <p className="page-lead">Track recurring chores from the seeded demo data.</p>
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
        <ul className="product-list">
          {choresQuery.data.map((chore) => (
            <li
              key={chore.id}
              className="product-row"
              style={{ gridTemplateColumns: "1fr auto auto" }}
            >
              <div>
                <h2>{chore.name}</h2>
                <p className="muted">{chore.period_type}</p>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={execute.isPending}
                onClick={() => execute.mutate(chore.id)}
              >
                Execute
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
