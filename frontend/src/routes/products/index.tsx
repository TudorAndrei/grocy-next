import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, queryKeys } from "@/lib/api";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/products/")({
  component: ProductsPage,
});

function ProductsPage() {
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: queryKeys.products,
    queryFn: () => api.listProducts(),
  });

  const products = useMemo(() => {
    const items = query.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (product) =>
        product.name.toLowerCase().includes(q) ||
        (product.description ?? "").toLowerCase().includes(q) ||
        (product.barcode ?? "").toLowerCase().includes(q),
    );
  }, [query.data, search]);

  return (
    <>
      <PageHeader
        title="Products"
        lead="Master catalog for everything you track — open an item for stock moves and nutrition."
      />
      <div className="toolbar">
        <div className="search-field">
          <label className="sr-only" htmlFor="product-search">
            Search products
          </label>
          <input
            id="product-search"
            type="search"
            placeholder="Search by name or barcode"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
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
        products.length === 0 ? (
          <p className="empty-state">
            {search
              ? "No products match that search."
              : "No products yet. Seed your backend or check the API key under Settings."}
          </p>
        ) : (
          <ul className="product-list">
            {products.map((product) => (
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
                  <span className="meta">
                    {product.barcode ? product.barcode : `#${product.id}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </>
  );
}
