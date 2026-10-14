import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";

export const Route = createFileRoute("/products/")({
  component: ProductsPage,
});

function ProductsPage() {
  const query = useQuery({
    queryKey: queryKeys.products,
    queryFn: () => api.listProducts(),
  });

  return (
    <>
      <h1 className="page-title">Pantry catalog</h1>
      <p className="page-lead">
        Browse products from your Grocy instance. Open any item to inspect nutrition,
        propose edits, and trace revision history.
      </p>
      {query.isLoading ? <LoadingBlock label="Fetching products…" /> : null}
      {query.isError ? (
        <ErrorBlock
          message={
            query.error instanceof Error
              ? query.error.message
              : "Could not load products."
          }
        />
      ) : null}
      {query.isSuccess ? (
        query.data.length === 0 ? (
          <p className="empty-state">
            No products returned yet. Seed your backend or check the API key under
            Connection.
          </p>
        ) : (
          <ul className="product-list">
            {query.data.map((product) => (
              <li key={product.id}>
                <Link
                  to="/products/$productId"
                  params={{ productId: String(product.id) }}
                  className="product-row"
                >
                  <div>
                    <h2>{product.name}</h2>
                    {product.description ? <p>{product.description}</p> : null}
                  </div>
                  <span className="meta">#{product.id}</span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </>
  );
}
