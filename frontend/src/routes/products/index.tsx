import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, queryKeys } from "@/lib/api";
import { useCatalog } from "@/lib/catalog";
import { ErrorBlock } from "@/components/ErrorBlock";
import { Gauge } from "@/components/Gauge";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/products/")({
  component: ProductsPage,
});

function ProductsPage() {
  const catalog = useCatalog();
  const [search, setSearch] = useState("");
  const products = useQuery({ queryKey: queryKeys.products, queryFn: api.listProducts });
  const stock = useQuery({ queryKey: queryKeys.stockOverview, queryFn: api.listStock });

  const amounts = useMemo(
    () => new Map((stock.data ?? []).map((item) => [item.product_id, item.amount])),
    [stock.data],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (products.data ?? [])
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          (p.description ?? "").toLowerCase().includes(q) ||
          (p.barcodes ?? [p.barcode ?? ""]).some((code) => code?.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products.data, search]);

  return (
    <>
      <PageHeader
        title="Products"
        lead="The master catalog. Open a product for stock moves, nutrition and its revision history."
      />
      <div className="toolbar">
        <label className="search-field">
          <span className="sr-only">Search products</span>
          <input
            type="search"
            placeholder="Search by name, description or barcode"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span className="toolbar-note">
          {products.isSuccess ? `${visible.length} of ${products.data.length}` : null}
        </span>
      </div>
      {products.isLoading ? <LoadingBlock label="Loading products…" /> : null}
      {products.isError ? <ErrorBlock message={(products.error as Error).message} /> : null}
      {products.isSuccess && visible.length === 0 ? (
        <p className="empty-state">
          {search
            ? "No product matches that search."
            : "No products yet. Seed the backend, or check the API key under Settings."}
        </p>
      ) : null}
      {visible.length > 0 ? (
        <div className="panel">
          <table className="stock-table products-table">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Level</th>
                <th scope="col" className="num">
                  On hand
                </th>
                <th scope="col" className="num">
                  Minimum
                </th>
                <th scope="col">Barcode</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((product) => {
                const amount = amounts.get(product.id) ?? 0;
                const min = product.min_stock_amount ?? 0;
                return (
                  <tr key={product.id}>
                    <td className="stock-name">
                      <Link to="/products/$productId" params={{ productId: String(product.id) }}>
                        {product.name}
                      </Link>
                      <small>
                        {catalog.location(product.location_id)?.name ?? "No location"}
                        {product.description ? ` · ${product.description}` : ""}
                      </small>
                    </td>
                    <td className="level">
                      <Gauge amount={amount} min={min} label={product.name} />
                    </td>
                    <td className="num amount">{catalog.amountText(product.id, amount)}</td>
                    <td className="num">{min > 0 ? catalog.amountText(product.id, min) : "—"}</td>
                    <td className="code">{product.barcode ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
