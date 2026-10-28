import { useI18n } from "@/lib/i18n";
import { GrocycodeActions } from "@/components/GrocycodeActions";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, queryKeys } from "@/lib/api";
import { stockAmount, stockMinimumAmount, useCatalog } from "@/lib/catalog";
import { ProductEditor } from "@/components/ProductEditor";
import { ErrorBlock } from "@/components/ErrorBlock";
import { Gauge } from "@/components/Gauge";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";
import { useFeatures } from "@/lib/features";

export const Route = createFileRoute("/products/")({
  component: ProductsPage,
});

function ProductsPage() {
  const { t: tr } = useI18n();

  const features = useFeatures();
  const catalog = useCatalog();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const products = useQuery({ queryKey: queryKeys.products, queryFn: api.listProducts });
  const stock = useQuery({ queryKey: queryKeys.stockOverview, queryFn: api.listStock });

  const amounts = useMemo(
    () => new Map((stock.data ?? []).map((item) => [item.product_id, item])),
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
        title={tr("Products")}
        lead={tr(
          "The master catalog. Open a product for stock moves, nutrition and its revision history.",
        )}
        actions={
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-pressed={editing}
            onClick={() => setEditing((on) => !on)}
          >
            {editing ? tr("Close editor") : tr("Edit catalog")}
          </button>
        }
      />
      {editing ? <ProductEditor /> : null}
      <div className="toolbar">
        <label className="search-field">
          <span className="sr-only">{tr("Search products")}</span>
          <input
            type="search"
            placeholder={tr("Search by name, description or barcode")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span className="toolbar-note">
          {products.isSuccess
            ? tr("%1$s of %2$s", String(visible.length), String(products.data.length))
            : null}
        </span>
      </div>
      {products.isLoading ? <LoadingBlock label={tr("Loading products…")} /> : null}
      {products.isError ? <ErrorBlock message={products.error.message} /> : null}
      {products.isSuccess && visible.length === 0 ? (
        <p className="empty-state">
          {search
            ? tr("No product matches that search.")
            : tr("No products yet. Seed the backend, or check the API key under Settings.")}
        </p>
      ) : null}
      {visible.length > 0 ? (
        <div className="panel">
          <table className="stock-table products-table">
            <thead>
              <tr>
                <th scope="col">{tr("Product")}</th>
                <th scope="col">{tr("Level")}</th>
                <th scope="col" className="num">
                  {tr("On hand")}
                </th>
                <th scope="col" className="num">
                  {tr("Minimum")}
                </th>
                <th scope="col">{tr("Barcode")}</th>
                <th scope="col">
                  <span className="sr-only">{tr("Actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((product) => {
                const entry = amounts.get(product.id);
                const amount = entry ? stockAmount(entry) : 0;
                const min = product.min_stock_amount ?? 0;

                return (
                  <tr key={product.id}>
                    <td className="stock-name">
                      <Link to="/products/$productId" params={{ productId: String(product.id) }}>
                        {product.name}
                      </Link>
                      <small>
                        {[
                          features.enabled("STOCK_LOCATION_TRACKING")
                            ? (catalog.location(product.location_id)?.name ?? "No location")
                            : null,
                          product.description,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </td>
                    <td className="level">
                      <Gauge
                        amount={entry ? stockMinimumAmount(entry) : 0}
                        min={min}
                        label={product.name}
                      />
                    </td>
                    <td className="num amount">{catalog.amountText(product.id, amount)}</td>
                    <td className="num">{min > 0 ? catalog.amountText(product.id, min) : "—"}</td>
                    <td className="code">{product.barcode ?? "—"}</td>
                    <td className="row-actions">
                      <GrocycodeActions
                        kind="product"
                        id={product.id}
                        name={product.name}
                        compact
                      />
                    </td>
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
