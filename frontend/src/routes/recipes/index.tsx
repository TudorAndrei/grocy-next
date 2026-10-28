import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RecipeOverview } from "@/components/RecipeOverview";
import { recipeOverviewSearchSchema, type RecipeOverviewSearch } from "@/lib/recipe-view";

export const Route = createFileRoute("/recipes/")({
  validateSearch: (search): RecipeOverviewSearch => recipeOverviewSearchSchema.parse(search),
  component: RecipesPage,
});

function RecipesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <RecipeOverview
      search={search}
      onSearchChange={(change) => {
        void navigate({ search: (previous) => ({ ...previous, ...change }), replace: true });
      }}
    />
  );
}
