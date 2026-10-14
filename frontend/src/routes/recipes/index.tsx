import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";

export const Route = createFileRoute("/recipes/")({
  component: RecipesPage,
});

function RecipesPage() {
  const query = useQuery({
    queryKey: queryKeys.recipes,
    queryFn: () => api.listRecipes(),
  });

  return (
    <>
      <h1 className="page-title">Recipes</h1>
      <p className="page-lead">
        Check fulfillment against current stock, then cook and consume ingredients.
      </p>
      {query.isLoading ? <LoadingBlock label="Fetching recipes…" /> : null}
      {query.isError ? (
        <ErrorBlock
          message={
            query.error instanceof Error ? query.error.message : "Could not load recipes."
          }
        />
      ) : null}
      {query.isSuccess ? (
        query.data.length === 0 ? (
          <p className="empty-state">No recipes yet.</p>
        ) : (
          <ul className="product-list">
            {query.data.map((recipe) => (
              <li key={recipe.id}>
                <Link
                  to="/recipes/$recipeId"
                  params={{ recipeId: String(recipe.id) }}
                  className="product-row"
                >
                  <div>
                    <h2>{recipe.name}</h2>
                    {recipe.description ? <p>{recipe.description}</p> : null}
                  </div>
                  <span className="meta">{recipe.positions.length} items</span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </>
  );
}
