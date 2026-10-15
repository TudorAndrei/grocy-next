import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, request } from "@/lib/api";
import type { RecipeFulfillment } from "@/lib/types";
import { EntityManager } from "@/components/EntityManager";
import { ErrorBlock } from "@/components/ErrorBlock";
export const Route = createFileRoute("/recipes/$recipeId")({
  component: RecipeDetailPage,
});
function RecipeDetailPage() {
  const { recipeId } = Route.useParams();
  const id = Number(recipeId);
  const [servings, setServings] = useState("1");
  const client = useQueryClient();
  const recipes = useQuery({ queryKey: ["recipes"], queryFn: api.listRecipes });
  const products = useQuery({
    queryKey: ["products"],
    queryFn: api.listProducts,
  });
  const valid = Number(servings) > 0 && Number.isFinite(Number(servings));
  const fulfillment = useQuery({
    queryKey: ["recipe-fulfillment", id, servings],
    queryFn: () =>
      request<RecipeFulfillment>(
        `/api/v2/recipes/${id}/fulfillment?servings=${servings}`,
      ),
    enabled: valid,
  });
  const action = useMutation({
    mutationFn: (kind: string) =>
      api.action(
        kind === "copy"
          ? `/api/recipes/${id}/copy`
          : `/api/v2/recipes/${id}/${kind}?servings=${servings}`,
        {},
      ),
    onSuccess: async () => {
      await client.invalidateQueries();
    },
  });
  const recipe = recipes.data?.find((r) => r.id === id);
  return (
    <>
      <p className="muted">
        <Link to="/recipes">Back to recipes</Link>
      </p>
      <h1 className="page-title">{recipe?.name ?? `Recipe #${id}`}</h1>
      <p className="page-lead">{recipe?.description}</p>
      <div className="field">
        <label htmlFor="recipe-servings">Servings</label>
        <input
          id="recipe-servings"
          type="number"
          min="0.000001"
          step="any"
          value={servings}
          onChange={(e) => setServings(e.target.value)}
        />
      </div>
      {(fulfillment.error || action.error) && (
        <ErrorBlock message={(fulfillment.error || action.error)!.message} />
      )}
      {fulfillment.data && (
        <section className="panel panel-inner">
          <h2>Stock check</h2>
          <p>
            {fulfillment.data.need_fulfilled
              ? "All ingredients are available."
              : `${fulfillment.data.missing_products_count} ingredients are short.`}
          </p>
          <ul className="product-list">
            {fulfillment.data.positions.map((pos) => (
              <li key={pos.product_id} className="product-row">
                <span>
                  {products.data?.find((p) => p.id === pos.product_id)?.name ??
                    `Product #${pos.product_id}`}
                </span>
                <span>
                  Need {pos.amount_needed}, have {pos.amount_available}
                </span>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button
              className="btn btn-primary"
              disabled={action.isPending || !valid}
              onClick={() => action.mutate("consume")}
            >
              Consume available ingredients
            </button>
            <button
              className="btn btn-ghost"
              disabled={action.isPending || !valid}
              onClick={() =>
                action.mutate("add-not-fulfilled-products-to-shoppinglist")
              }
            >
              Add missing ingredients to shopping
            </button>
            <button
              className="btn btn-ghost"
              disabled={action.isPending}
              onClick={() => action.mutate("copy")}
            >
              Copy recipe
            </button>
          </div>
          {action.isSuccess && <p role="status">Recipe action saved.</p>}
        </section>
      )}
      <EntityManager
        entity="recipes_pos"
        fixed={{ recipe_id: id }}
        title="Ingredients"
      />
      <EntityManager
        entity="recipes_nestings"
        fixed={{ recipe_id: id }}
        title="Included recipes"
      />
    </>
  );
}
