import { createFileRoute, Link } from "@tanstack/react-router";
import { EntityManager } from "@/components/EntityManager";
export const Route = createFileRoute("/recipes/")({ component: RecipesPage });
function RecipesPage() {
  return (
    <>
      <h1 className="page-title">Recipes</h1>
      <p className="page-lead">
        Create a recipe, add ingredients, and check the stock before cooking.
      </p>
      <EntityManager
        entity="recipes"
        detail={(row) => (
          <Link to="/recipes/$recipeId" params={{ recipeId: String(row.id) }}>
            <h3>{row.name}</h3>
            {row.description && <p>{row.description}</p>}
            <p className="muted">View ingredients and stock</p>
          </Link>
        )}
      />
    </>
  );
}
