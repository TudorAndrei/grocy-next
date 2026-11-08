import { createFileRoute, useLocation, useRouter } from "@tanstack/react-router";
import { RecipeIngredientEditor } from "@/components/RecipeIngredientEditor";
import { recipeIngredientSearch } from "@/lib/recipe-ingredient-form";

export const Route = createFileRoute("/recipe/$recipeId/pos/$positionId")({
  validateSearch: recipeIngredientSearch,
  component: IngredientRoute,
});

function IngredientRoute() {
  const { recipeId, positionId } = Route.useParams();
  const router = useRouter();
  const search = useLocation({ select: () => router.history.location.search });

  return (
    <RecipeIngredientEditor
      key={`${recipeId}:${positionId}:${search}`}
      recipeId={Number(recipeId)}
      positionId={positionId === "new" ? null : Number(positionId)}
      search={search}
    />
  );
}
