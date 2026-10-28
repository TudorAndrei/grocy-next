import { useI18n } from "@/lib/i18n";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, queryKeys, request } from "@/lib/api";
import type { RecipeFulfillment } from "@/lib/types";
import { useCatalog, useInvalidateStock } from "@/lib/catalog";
import { EntityManager } from "@/components/EntityManager";
import { ErrorBlock } from "@/components/ErrorBlock";
import { Gauge } from "@/components/Gauge";
import { Icon } from "@/components/Icon";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";
import { useNotify } from "@/components/Toaster";
import { FullscreenCard, FullscreenToggle } from "@/components/FullscreenCard";
import { RichDescription } from "@/components/RichDescription";
import { EntityPicture } from "@/components/EntityPicture";

export const Route = createFileRoute("/recipes/$recipeId")({
  component: RecipeDetailPage,
});

function RecipeDetailPage() {
  const { t: tr } = useI18n();

  const { recipeId } = Route.useParams();
  const id = Number(recipeId);
  const catalog = useCatalog();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const invalidateStock = useInvalidateStock();
  const [servings, setServings] = useState("1");
  const servingsValid = Number(servings) > 0 && Number.isFinite(Number(servings));

  const recipes = useQuery({ queryKey: queryKeys.recipes, queryFn: api.listRecipes });

  const fulfillment = useQuery({
    queryKey: [...queryKeys.recipeFulfillment(id), servings],
    queryFn: () =>
      request<RecipeFulfillment>(`/api/v2/recipes/${id}/fulfillment?servings=${servings}`),
    enabled: Number.isFinite(id) && servingsValid,
  });

  const cook = useMutation({
    mutationFn: () => api.action(`/api/v2/recipes/${id}/consume?servings=${servings}`, {}),
    onSuccess: async () => {
      await invalidateStock();
      notify({ message: tr("Ingredients consumed from stock") });
    },
    onError: (err: Error) => notify({ message: err.message, tone: "error" }),
  });

  const addMissing = useMutation({
    mutationFn: () =>
      api.action(
        `/api/v2/recipes/${id}/add-not-fulfilled-products-to-shoppinglist?servings=${servings}`,
        {},
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["shopping"] });
      notify({ message: tr("Missing ingredients added to the shopping list") });
    },
    onError: (err: Error) => notify({ message: err.message, tone: "error" }),
  });

  const copy = useMutation({
    mutationFn: () => api.action(`/api/recipes/${id}/copy`, {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.recipes });
      notify({ message: tr("Recipe copied") });
    },
    onError: (err: Error) => notify({ message: err.message, tone: "error" }),
  });

  const recipe = recipes.data?.find((item) => item.id === id);
  const f = fulfillment.data;

  return (
    <>
      <FullscreenCard label={recipe?.name ?? tr("Recipe")} hash>
        <PageHeader
          back={
            <Link to="/recipes" className="back-link">
              <Icon name="back" />
              {tr("Recipes")}
            </Link>
          }
          title={recipe?.name ?? tr("Recipe #%s", String(recipeId))}
          lead={recipe ? `${tr("Servings")}: ${recipe.desired_servings}` : undefined}
          actions={
            <>
              <FullscreenToggle />
              <label className="field servings-field">
                <span>{tr("Servings")}</span>
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  value={servings}
                  onChange={(e) => setServings(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={copy.isPending}
                onClick={() => copy.mutate()}
              >
                {tr("Copy recipe")}
              </button>
              {f ? (
                <>
                  {!f.need_fulfilled ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={addMissing.isPending}
                      onClick={() => addMissing.mutate()}
                    >
                      {tr("Add missing to list")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={cook.isPending || !f.need_fulfilled}
                    onClick={() => cook.mutate()}
                  >
                    {cook.isPending ? tr("Cooking…") : tr("Cook and consume")}
                  </button>
                </>
              ) : null}
            </>
          }
        />

        {recipe?.picture_file_name ? (
          <EntityPicture
            group="recipepictures"
            source={recipe.picture_file_name}
            label={tr("%s picture", String(recipe.name))}
          />
        ) : null}

        {fulfillment.isLoading ? <LoadingBlock label={tr("Checking stock…")} /> : null}
        {fulfillment.isError ? <ErrorBlock message={fulfillment.error.message} /> : null}

        <div className="recipe-content">
          {f && f.positions.length > 0 ? (
            <div className="panel">
              <h2 className="panel-head">
                {tr("Ingredients")}
                <span>
                  {f.need_fulfilled
                    ? tr("everything is in stock")
                    : tr("%s short", String(f.missing_products_count))}
                </span>
              </h2>
              <table className="stock-table">
                <thead>
                  <tr>
                    <th scope="col">{tr("Ingredient")}</th>
                    <th scope="col">{tr("Cover")}</th>
                    <th scope="col" className="num">
                      {tr("Needed")}
                    </th>
                    <th scope="col" className="num">
                      {tr("On hand")}
                    </th>
                    <th scope="col">{tr("Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {f.positions.map((pos) => (
                    <tr key={pos.product_id} data-low={pos.fulfilled ? undefined : "true"}>
                      <td className="stock-name">
                        <Link
                          to="/products/$productId"
                          params={{ productId: String(pos.product_id) }}
                        >
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
                          {pos.fulfilled ? tr("In stock") : tr("Short")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {recipe?.description ? (
            <section className="panel panel-inner">
              <h2>{tr("Preparation")}</h2>
              <RichDescription entity="recipes" objectId={id} />
            </section>
          ) : null}
        </div>
      </FullscreenCard>

      <EntityManager
        entity="recipes_pos"
        fixed={{ recipe_id: id }}
        title={tr("Edit ingredients")}
      />
      <EntityManager
        entity="recipes_nestings"
        fixed={{ recipe_id: id }}
        title={tr("Included recipes")}
      />
    </>
  );
}
