import { createFileRoute, Link } from "@tanstack/react-router";
import { EntityManager } from "@/components/EntityManager";
export const Route = createFileRoute("/products/")({ component: ProductsPage });
function ProductsPage() {
  return (
    <>
      <h1 className="page-title">Pantry catalog</h1>
      <p className="page-lead">
        Create products and open an item to manage stock and nutrition.
      </p>
      <EntityManager
        entity="products"
        detail={(row) => (
          <Link
            to="/products/$productId"
            params={{ productId: String(row.id) }}
          >
            <h3>{row.name}</h3>
            {row.description && <p>{row.description}</p>}
            <span className="muted">View stock and nutrition</span>
          </Link>
        )}
      />
    </>
  );
}
