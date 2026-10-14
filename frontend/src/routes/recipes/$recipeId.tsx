import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";

export const Route = createFileRoute("/recipes/$recipeId")({
  component: RecipeDetailPage,
});

function RecipeDetailPage() {
  const { recipeId } = Route.useParams();
  const id = Number(recipeId);
  const queryClient = useQueryClient();

  const recipesQuery = useQuery({
    queryKey: queryKeys.recipes,
    queryFn: () => api.listRecipes(),
  });
  const fulfillmentQuery = useQuery({
    queryKey: queryKeys.recipeFulfillment(id),
    queryFn: () => api.getRecipeFulfillment(id),
    enabled: Number.isFinite(id),
  });

  const consume = useMutation({
    mutationFn: () => api.consumeRecipe(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.recipeFulfillment(id) });
      await queryClient.invalidateQueries({ queryKey: ["stock"] });
    },
  });

  const recipe = recipesQuery.data?.find((item) => item.id === id);

  return (
    <>
      <p className="muted" style={{ marginBottom: "0.5rem" }}>
        <Link to="/recipes">← Back to recipes</Link>
      </p>
      <h1 className="page-title">{recipe?.name ?? `Recipe #${recipeId}`}</h1>
      <p className="page-lead">{recipe?.description ?? "Fulfillment against live stock."}</p>

      <div className="stack" style={{ marginTop: "1.5rem" }}>
        {fulfillmentQuery.isLoading ? <LoadingBlock label="Checking stock…" /> : null}
        {fulfillmentQuery.isError ? (
          <ErrorBlock
            message={
              fulfillmentQuery.error instanceof Error
                ? fulfillmentQuery.error.message
                : "Could not load fulfillment."
            }
          />
        ) : null}
        {fulfillmentQuery.isSuccess ? (
          <section className="panel">
            <div className="panel-inner">
              <p>
                {fulfillmentQuery.data.need_fulfilled
                  ? "All ingredients available."
                  : `Missing ${fulfillmentQuery.data.missing_products_count} ingredient(s).`}
              </p>
              <ul className="revision-list">
                {fulfillmentQuery.data.positions.map((pos) => (
                  <li key={pos.product_id} className="revision-item">
                    Product #{pos.product_id}: need {pos.amount_needed}, have{" "}
                    {pos.amount_available}{" "}
                    <span className="status-pill">
                      {pos.fulfilled ? "ok" : "short"}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="btn btn-primary"
                disabled={consume.isPending || !fulfillmentQuery.data.need_fulfilled}
                onClick={() => consume.mutate()}
              >
                {consume.isPending ? "Cooking…" : "Consume recipe"}
              </button>
              {consume.isError ? (
                <p className="muted">
                  {consume.error instanceof Error ? consume.error.message : "Failed"}
                </p>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
