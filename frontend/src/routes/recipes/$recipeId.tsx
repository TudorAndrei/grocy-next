import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, queryKeys } from "@/lib/api";
import { formatAmount } from "@/lib/format";
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
  const productsQuery = useQuery({
    queryKey: queryKeys.products,
    queryFn: () => api.listProducts(),
  });
  const fulfillmentQuery = useQuery({
    queryKey: queryKeys.recipeFulfillment(id),
    queryFn: () => api.getRecipeFulfillment(id),
    enabled: Number.isFinite(id),
  });

  const productNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const product of productsQuery.data ?? []) {
      map.set(product.id, product.name);
    }
    return map;
  }, [productsQuery.data]);

  const consume = useMutation({
    mutationFn: () => api.consumeRecipe(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.recipeFulfillment(id) });
      await queryClient.invalidateQueries({ queryKey: ["stock"] });
    },
  });

  const addMissing = useMutation({
    mutationFn: () => api.addRecipeMissingToShopping(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.shopping(1) });
    },
  });

  const recipe = recipesQuery.data?.find((item) => item.id === id);
  const fulfillment = fulfillmentQuery.data;

  return (
    <>
      <Link to="/recipes" className="back-link">
        ← Recipes
      </Link>
      <header className="page-header">
        <div className="page-header-copy">
          <h1 className="page-title">{recipe?.name ?? `Recipe #${recipeId}`}</h1>
          <p className="page-lead">
            {recipe?.description ?? "Fulfillment against live stock."}
          </p>
        </div>
        {fulfillment ? (
          <div className="page-actions">
            <span
              className={`badge ${fulfillment.need_fulfilled ? "badge-ok" : "badge-warn"}`}
            >
              {fulfillment.need_fulfilled
                ? "Ready to cook"
                : `${fulfillment.missing_products_count} missing`}
            </span>
          </div>
        ) : null}
      </header>

      <div className="stack">
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
        {fulfillment ? (
          <section className="panel">
            <div className="panel-inner" style={{ padding: 0 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ingredient</th>
                    <th>Needed</th>
                    <th>Available</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {fulfillment.positions.map((pos) => (
                    <tr key={pos.product_id}>
                      <td>
                        <Link
                          to="/products/$productId"
                          params={{ productId: String(pos.product_id) }}
                          className="row-link"
                        >
                          {productNames.get(pos.product_id) ??
                            `Product #${pos.product_id}`}
                        </Link>
                      </td>
                      <td className="amount-cell">{formatAmount(pos.amount_needed)}</td>
                      <td className="amount-cell">{formatAmount(pos.amount_available)}</td>
                      <td>
                        <span
                          className={`badge ${pos.fulfilled ? "badge-ok" : "badge-warn"}`}
                        >
                          {pos.fulfilled ? "OK" : "Short"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div
                className="page-actions"
                style={{ padding: "1rem 1.15rem", borderTop: "1px solid var(--line)" }}
              >
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={consume.isPending || !fulfillment.need_fulfilled}
                  onClick={() => consume.mutate()}
                >
                  {consume.isPending ? "Cooking…" : "Consume recipe"}
                </button>
                {!fulfillment.need_fulfilled ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={addMissing.isPending}
                    onClick={() => addMissing.mutate()}
                  >
                    {addMissing.isPending ? "Adding…" : "Add missing to shopping"}
                  </button>
                ) : null}
                {consume.isError ? (
                  <p className="muted" style={{ margin: 0, width: "100%" }}>
                    {consume.error instanceof Error ? consume.error.message : "Failed"}
                  </p>
                ) : null}
                {addMissing.isSuccess ? (
                  <p className="muted" style={{ margin: 0, width: "100%" }} role="status">
                    Missing ingredients added to the shopping list.
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
