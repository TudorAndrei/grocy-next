import { useI18n } from "@/lib/i18n";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, queryKeys } from "@/lib/api";
import { EntityManager } from "@/components/EntityManager";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/recipes/")({
  component: RecipesPage,
});

type ReadyFilter = "all" | "ready" | "missing";

function RecipesPage() {
  const { t: tr } = useI18n();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ReadyFilter>("all");
  const [editing, setEditing] = useState(false);
  const recipes = useQuery({ queryKey: queryKeys.recipes, queryFn: api.listRecipes });

  const fulfillment = useQuery({
    queryKey: queryKeys.recipesFulfillment,
    queryFn: api.listRecipeFulfillment,
  });

  const status = useMemo(
    () => new Map((fulfillment.data ?? []).map((f) => [f.recipe_id, f])),
    [fulfillment.data],
  );

  const visible = (recipes.data ?? []).filter((recipe) => {
    const f = status.get(recipe.id);

    if (filter === "ready" && !f?.need_fulfilled) return false;

    if (filter === "missing" && (f?.need_fulfilled ?? true)) return false;
    const q = search.trim().toLowerCase();

    return (
      !q ||
      recipe.name.toLowerCase().includes(q) ||
      (recipe.description ?? "").toLowerCase().includes(q)
    );
  });

  const counts = {
    all: recipes.data?.length ?? 0,
    ready: (recipes.data ?? []).filter((r) => status.get(r.id)?.need_fulfilled).length,
    missing: (recipes.data ?? []).filter((r) => status.get(r.id)?.need_fulfilled === false).length,
  };

  return (
    <>
      <PageHeader
        title={tr("Recipes")}
        lead={tr("Checked against live stock. Cook a ready recipe to consume its ingredients.")}
        actions={
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-pressed={editing}
            onClick={() => setEditing((on) => !on)}
          >
            {editing ? tr("Close editor") : tr("Edit recipes")}
          </button>
        }
      />
      {editing ? <EntityManager entity="recipes" /> : null}
      <div className="toolbar">
        <label className="search-field">
          <span className="sr-only">{tr("Search recipes")}</span>
          <input
            type="search"
            placeholder={tr("Search recipes")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="chips" role="group" aria-label={tr("Recipe filter")}>
          {(
            [
              ["all", "All"],
              ["ready", "Ready to cook"],
              ["missing", "Missing items"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="chip"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
              <span className="chip-count">{counts[id]}</span>
            </button>
          ))}
        </div>
      </div>
      {recipes.isLoading ? <LoadingBlock label={tr("Loading recipes…")} /> : null}
      {recipes.isError ? <ErrorBlock message={recipes.error.message} /> : null}
      {recipes.isSuccess && visible.length === 0 ? (
        <p className="empty-state">
          {recipes.data.length === 0 ? tr("No recipes yet.") : tr("No recipe matches this filter.")}
        </p>
      ) : null}
      {visible.length > 0 ? (
        <ul className="panel recipe-list">
          {visible.map((recipe) => {
            const f = status.get(recipe.id);

            return (
              <li key={recipe.id}>
                <Link
                  to="/recipes/$recipeId"
                  params={{ recipeId: String(recipe.id) }}
                  className="recipe-row"
                >
                  <span className="recipe-name">
                    {recipe.name}
                    {recipe.description ? <small>{recipe.description}</small> : null}
                  </span>
                  <span className="recipe-meta">
                    {f ? tr("%s ingredients · ", String(f.positions.length)) : null}
                    {recipe.desired_servings} {tr("serving")}
                    {recipe.desired_servings === 1 ? "" : tr("s")}
                  </span>
                  {f ? (
                    <span className="badge" data-tone={f.need_fulfilled ? "ok" : "warn"}>
                      {f.need_fulfilled
                        ? tr("Ready to cook")
                        : tr("%s missing", String(f.missing_products_count))}
                    </span>
                  ) : (
                    <span className="faint">—</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}
