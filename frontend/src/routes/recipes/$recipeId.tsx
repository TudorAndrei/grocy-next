import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { useCatalog, useInvalidateStock } from "@/lib/catalog";
import { ErrorBlock } from "@/components/ErrorBlock";
import { Gauge } from "@/components/Gauge";
import { Icon } from "@/components/Icon";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";
import { useNotify } from "@/components/Toaster";

export const Route = createFileRoute("/recipes/$recipeId")({
  component: RecipeDetailPage,
});

function RecipeDetailPage() {
  const { recipeId } = Route.useParams();
  const id = Number(recipeId);
  const catalog = useCatalog();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const invalidateStock = useInvalidateStock();

  const recipes = useQuery({ queryKey: queryKeys.recipes, queryFn: api.listRecipes });
  const fulfillment = useQuery({
    queryKey: queryKeys.recipeFulfillment(id),
    queryFn: () => api.getRecipeFulfillment(id),
    enabled: Number.isFinite(id),
  });

  const cook = useMutation({
    mutationFn: () => api.consumeRecipe(id),
    onSuccess: async () => {
      await invalidateStock();
      notify({ message: "Ingredients consumed from stock" });
    },
    onError: (err: Error) => notify({ message: err.message, tone: "error" }),
  });

  const addMissing = useMutation({
    mutationFn: () => api.addRecipeMissingToShopping(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["shopping"] });
      notify({ message: "Missing ingredients added to the shopping list" });
    },
    onError: (err: Error) => notify({ message: err.message, tone: "error" }),
  });

  const recipe = recipes.data?.find((item) => item.id === id);
  const f = fulfillment.data;

  return (
    <>
      <PageHeader
        back={
          <Link to="/recipes" className="back-link">
            <Icon name="back" />
            Recipes
          </Link>
        }
        title={recipe?.name ?? `Recipe #${recipeId}`}
        lead={
          recipe
            ? `${recipe.description ? `${recipe.description} · ` : ""}${recipe.desired_servings} serving${recipe.desired_servings === 1 ? "" : "s"}`
            : undefined
        }
        actions={
          f ? (
            <>
              {!f.need_fulfilled ? (
                <button
                  type="button"
                  className="btn"
                  disabled={addMissing.isPending}
                  onClick={() => addMissing.mutate()}
                >
                  Add missing to list
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-primary"
                disabled={cook.isPending || !f.need_fulfilled}
                onClick={() => cook.mutate()}
              >
                {cook.isPending ? "Cooking…" : "Cook and consume"}
              </button>
            </>
          ) : null
        }
      />

      {fulfillment.isLoading ? <LoadingBlock label="Checking stock…" /> : null}
      {fulfillment.isError ? <ErrorBlock message={(fulfillment.error as Error).message} /> : null}

      {f ? (
        <div className="panel">
          <h2 className="panel-head">
            Ingredients
            <span>
              {f.need_fulfilled ? "everything is in stock" : `${f.missing_products_count} short`}
            </span>
          </h2>
          <table className="stock-table">
            <thead>
              <tr>
                <th scope="col">Ingredient</th>
                <th scope="col">Cover</th>
                <th scope="col" className="num">
                  Needed
                </th>
                <th scope="col" className="num">
                  On hand
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {f.positions.map((pos) => (
                <tr key={pos.product_id} data-low={pos.fulfilled ? undefined : "true"}>
                  <td className="stock-name">
                    <Link to="/products/$productId" params={{ productId: String(pos.product_id) }}>
                      {catalog.productName(pos.product_id)}
                    </Link>
                  </td>
                  <td className="level">
                    {/* Scale is the recipe's need: the tick marks "enough". */}
                    <Gauge
                      amount={pos.amount_available}
                      min={pos.amount_needed}
                      label={catalog.productName(pos.product_id)}
                    />
                  </td>
                  <td className="num amount">
                    {catalog.amountText(pos.product_id, pos.amount_needed)}
                  </td>
                  <td className="num">
                    {catalog.amountText(pos.product_id, pos.amount_available)}
                  </td>
                  <td>
                    <span className="badge" data-tone={pos.fulfilled ? "ok" : "warn"}>
                      {pos.fulfilled ? "In stock" : "Short"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
