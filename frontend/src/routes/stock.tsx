import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, queryKeys } from "@/lib/api";
import { useCatalog } from "@/lib/catalog";
import { daysUntil, dueLabel, dueTone, formatAmount } from "@/lib/format";
import { useCommandBar } from "@/components/CommandBar";
import { ErrorBlock } from "@/components/ErrorBlock";
import { Gauge } from "@/components/Gauge";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";
import { QuickMoves } from "@/components/QuickMoves";

export const Route = createFileRoute("/stock")({
  component: StockPage,
});

type StockFilter = "all" | "due" | "expired" | "low";

type Row = {
  productId: number;
  name: string;
  amount: number;
  opened: number;
  min: number;
  bestBefore: string | null;
  locationId: number | null;
};

function StockPage() {
  const catalog = useCatalog();
  const command = useCommandBar();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");
  const [locationId, setLocationId] = useState("");

  const stock = useQuery({ queryKey: queryKeys.stockOverview, queryFn: api.listStock });

  const volatile = useQuery({
    queryKey: queryKeys.stockVolatile,
    queryFn: () => api.getStockVolatile(),
  });

  // Products below minimum and out of stock are not in /api/stock; add them as empty rows.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = (stock.data ?? []).map((item) => ({
      productId: item.product_id,
      name: item.product.name,
      amount: item.amount,
      opened: item.amount_opened,
      min: item.product.min_stock_amount ?? 0,
      bestBefore: item.best_before_date ?? null,
      locationId: item.product.location_id ?? null,
    }));

    const present = new Set(out.map((row) => row.productId));

    for (const missing of volatile.data?.missing_products ?? []) {
      if (present.has(missing.id)) continue;
      const product = catalog.product(missing.id);
      out.push({
        productId: missing.id,
        name: missing.name,
        amount: 0,
        opened: 0,
        min: product?.min_stock_amount ?? missing.amount_missing,
        bestBefore: null,
        locationId: product?.location_id ?? null,
      });
    }

    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [stock.data, volatile.data, catalog]);

  const isDue = (row: Row) => {
    const days = daysUntil(row.bestBefore);

    return days !== null && days >= 0 && days <= 5;
  };

  const isExpired = (row: Row) => {
    const days = daysUntil(row.bestBefore);

    return days !== null && days < 0;
  };

  const isLow = (row: Row) => row.min > 0 && row.amount < row.min;

  const anyOpened = rows.some((row) => row.opened > 0);

  const counts = {
    all: rows.length,
    due: rows.filter(isDue).length,
    expired: rows.filter(isExpired).length,
    low: rows.filter(isLow).length,
  };

  const visible = rows.filter((row) => {
    if (filter === "due" && !isDue(row)) return false;

    if (filter === "expired" && !isExpired(row)) return false;

    if (filter === "low" && !isLow(row)) return false;

    if (locationId && String(row.locationId) !== locationId) return false;
    const q = search.trim().toLowerCase();

    return !q || row.name.toLowerCase().includes(q);
  });

  const filters: Array<[StockFilter, string]> = [
    ["all", "All"],
    ["due", "Due soon"],
    ["expired", "Expired"],
    ["low", "Below min"],
  ];

  return (
    <>
      <PageHeader
        title="Stock"
        lead="What is on hand, how full each product is against its minimum, and what to use first."
        actions={
          <>
            <Link to="/journal" className="btn btn-ghost">
              Journal
            </Link>
            <Link to="/barcode" className="btn btn-ghost">
              Barcode
            </Link>
            <button type="button" className="btn" onClick={() => command.open("consume")}>
              Consume
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => command.open("purchase")}
            >
              Purchase
            </button>
          </>
        }
      />

      <div className="toolbar">
        <label className="search-field">
          <span className="sr-only">Search stock</span>
          <input
            type="search"
            placeholder="Search products"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="chips" role="group" aria-label="Stock filter">
          {filters.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="chip"
              data-tone={id}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
              <span className="chip-count">{counts[id]}</span>
            </button>
          ))}
        </div>
        <label className="select-field">
          <span className="sr-only">Location</span>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">All locations</option>
            {catalog.locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {stock.isLoading ? <LoadingBlock label="Loading stock…" /> : null}
      {stock.isError ? <ErrorBlock message={stock.error.message} /> : null}

      {stock.isSuccess && visible.length === 0 ? (
        <p className="empty-state">
          {rows.length === 0
            ? "Stock is empty. Press Purchase or ⌘K to book what you bought."
            : "No product matches this filter."}
        </p>
      ) : null}

      {visible.length > 0 ? (
        <div className="panel">
          <table className="stock-table">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Level</th>
                <th scope="col" className="num">
                  Amount
                </th>
                {anyOpened ? (
                  <th scope="col" className="num">
                    Opened
                  </th>
                ) : null}
                <th scope="col">Best before</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const tone = dueTone(row.bestBefore);

                return (
                  <tr key={row.productId} data-low={isLow(row) ? "true" : undefined}>
                    <td className="stock-name">
                      <Link to="/products/$productId" params={{ productId: String(row.productId) }}>
                        {row.name}
                      </Link>
                      <small>
                        {catalog.location(row.locationId)?.name ?? "No location"}
                        {row.min > 0 ? ` · min ${catalog.amountText(row.productId, row.min)}` : ""}
                      </small>
                    </td>
                    <td className="level">
                      <Gauge amount={row.amount} min={row.min} label={row.name} />
                    </td>
                    <td className="num amount">{catalog.amountText(row.productId, row.amount)}</td>
                    {anyOpened ? (
                      <td className="num opened">
                        {row.opened > 0 ? (
                          formatAmount(row.opened)
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                    ) : null}
                    <td className="date">
                      {tone ? (
                        <span className="badge" data-tone={tone}>
                          {dueLabel(row.bestBefore)}
                        </span>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td className="row-actions">
                      <QuickMoves productId={row.productId} name={row.name} amount={row.amount} />
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
