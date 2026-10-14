import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EntityManager } from "@/components/EntityManager";
import { ErrorBlock } from "@/components/ErrorBlock";
import { api } from "@/lib/api";
export const Route = createFileRoute("/meal-plan")({ component: MealPlanPage });
function MealPlanPage() {
  const client = useQueryClient();
  const action = useMutation({
    mutationFn: ({ id, kind }: { id: number; kind: string }) =>
      api.action(
        `/api/v2/meal-plan/${id}/${kind}`,
        kind === "shopping-list" ? {} : undefined,
      ),
    onSuccess: async () => {
      await client.invalidateQueries();
    },
  });
  return (
    <>
      <h1 className="page-title">Meal plan</h1>
      <p className="page-lead">
        Plan recipes, products, and notes by date. Add missing ingredients to
        your shopping list.
      </p>
      {action.error && <ErrorBlock message={action.error.message} />}
      <EntityManager
        entity="meal_plan"
        actions={(row) => (
          <>
            {!row.done && (
              <button
                className="btn btn-primary"
                disabled={action.isPending}
                onClick={() => action.mutate({ id: row.id, kind: "consume" })}
              >
                Complete meal
              </button>
            )}
            {row.type === "recipe" && (
              <button
                className="btn btn-ghost"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({ id: row.id, kind: "shopping-list" })
                }
              >
                Add missing ingredients
              </button>
            )}
          </>
        )}
      />
    </>
  );
}
