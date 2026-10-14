import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, queryKeys } from "@/lib/api";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/recipes/")({
  component: RecipesPage,
});

function RecipesPage() {
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: queryKeys.recipes,
    queryFn: () => api.listRecipes(),
  });

  const recipes = useMemo(() => {
    const items = query.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (recipe) =>
        recipe.name.toLowerCase().includes(q) ||
        (recipe.description ?? "").toLowerCase().includes(q),
    );
  }, [query.data, search]);

  return (
    <>
      <PageHeader
        title="Recipes"
        lead="Check fulfillment against current stock, then cook and consume ingredients."
      />
      <div className="toolbar">
        <div className="search-field">
          <label className="sr-only" htmlFor="recipe-search">
            Search recipes
          </label>
          <input
            id="recipe-search"
            type="search"
            placeholder="Search recipes"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      {query.isLoading ? <LoadingBlock label="Fetching recipes…" /> : null}
      {query.isError ? (
        <ErrorBlock
          message={
            query.error instanceof Error ? query.error.message : "Could not load recipes."
          }
        />
      ) : null}
      {query.isSuccess ? (
        recipes.length === 0 ? (
          <p className="empty-state">
            {search ? "No recipes match that search." : "No recipes yet."}
          </p>
        ) : (
          <ul className="product-list">
            {recipes.map((recipe) => (
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
                  <span className="meta">{recipe.positions.length} ingredients</span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </>
  );
}
