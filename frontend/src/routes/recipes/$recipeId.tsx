import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { EntityManager } from "@/components/EntityManager";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { RecipeReader } from "@/components/RecipeReader";
import { RecipeMealPlanProvider } from "@/components/RecipeMealPlan";

export const Route = createFileRoute("/recipes/$recipeId")({ component: RecipeDetailPage });

function RecipeDetailPage() {
  const { t } = useI18n();
  const { recipeId } = Route.useParams();
  const id = Number(recipeId);

  const view = useQuery({
    queryKey: queryKeys.recipeView(id),
    queryFn: () => api.getRecipeView(id),
  });

  if (view.isPending) return <LoadingBlock label={t("Loading…")} />;

  if (view.isError) return <ErrorBlock message={view.error.message} />;

  return (
    <RecipeMealPlanProvider key={id}>
      <RecipeReader key={id} view={view.data} />
      <EntityManager entity="recipes_pos" fixed={{ recipe_id: id }} title={t("Edit ingredients")} />
      <EntityManager
        entity="recipes_nestings"
        fixed={{ recipe_id: id }}
        title={t("Included recipes")}
      />
    </RecipeMealPlanProvider>
  );
}
