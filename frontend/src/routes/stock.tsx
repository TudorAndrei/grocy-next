import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { stockOverviewQuery, stockVolatileQuery } from "@/hooks/queries";
import { dueLabel, dueTone, formatAmount } from "@/lib/format";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/stock")({
  component: StockPage,
});

type StockFilter = "all" | "due" | "overdue" | "missing";

function StockPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");
  const [busyId, setBusyId] = useState<number | null>(null);

  const stockQuery = useQuery(stockOverviewQuery());
  const volatileQuery = useQuery(stockVolatileQuery());

  const invalidateStock = async () => {
    await queryClient.invalidateQueries({ queryKey: ["stock"] });
  };

  const consume = useMutation({
    mutationFn: (productId: number) => api.consumeStock(productId, 1),
    onMutate: (productId) => setBusyId(productId),
    onSettled: async () => {
      setBusyId(null);
      await invalidateStock();
    },
  });

  const purchase = useMutation({
    mutationFn: (productId: number) => api.purchaseStock(productId, 1),
    onMutate: (productId) => setBusyId(productId),
    onSettled: async () => {
      setBusyId(null);
      await invalidateStock();
    },
  });

  const dueIds = useMemo(
    () =>
      new Set(
        (volatileQuery.data?.due_products ?? []).map((i) => i.product_id),
      ),
    [volatileQuery.data],
  );
  const overdueIds = useMemo(
    () =>
      new Set(
        (volatileQuery.data?.overdue_products ?? []).map((i) => i.product_id),
      ),
    [volatileQuery.data],
  );
  const missing = volatileQuery.data?.missing_products ?? [];

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let items = stockQuery.data ?? [];
    if (filter === "due") {
      items = items.filter((item) => dueIds.has(item.product_id));
    } else if (filter === "overdue") {
      items = items.filter((item) => overdueIds.has(item.product_id));
    } else if (filter === "missing") {
      return [];
    }
    if (!q) return items;
    return items.filter((item) => item.product.name.toLowerCase().includes(q));
  }, [stockQuery.data, search, filter, dueIds, overdueIds]);

  const filteredMissing = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return missing;
    return missing.filter((item) => item.name.toLowerCase().includes(q));
  }, [missing, search]);

  return (
    <>
      <PageHeader
        title="Stock overview"
        lead="What is on hand right now — purchase, consume, and catch items before they expire."
        actions={
          <>
            <Link to="/journal" className="btn btn-ghost btn-sm">Journal</Link>
            <Link to="/barcode" className="btn btn-ghost btn-sm">Barcode</Link>
          </>
        }
      />

      <div className="stat-strip">
        <div className="stat-card" data-tone="accent">
          <span className="label">In stock</span>
          <span className="value">{stockQuery.data?.length ?? "—"}</span>
        </div>
        <div className="stat-card" data-tone="warn">
          <span className="label">Due soon</span>
          <span className="value">
            {volatileQuery.data?.due_products.length ?? "—"}
          </span>
        </div>
        <div className="stat-card" data-tone="danger">
          <span className="label">Overdue</span>
          <span className="value">
            {volatileQuery.data?.overdue_products.length ?? "—"}
          </span>
        </div>
        <div className="stat-card" data-tone="ok">
          <span className="label">Below minimum</span>
          <span className="value">{missing.length || "0"}</span>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-field">
          <label className="sr-only" htmlFor="stock-search">
            Search stock
          </label>
          <input
            id="stock-search"
            type="search"
            placeholder="Search products"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="filter-chips" role="group" aria-label="Stock filters">
          {(
            [
              ["all", "All"],
              ["due", "Due soon"],
              ["overdue", "Overdue"],
              ["missing", "Below min"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="chip"
              data-active={filter === id ? "true" : "false"}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {stockQuery.isLoading || volatileQuery.isLoading ? (
        <LoadingBlock label="Loading stock…" />
      ) : null}
      {stockQuery.isError ? (
        <ErrorBlock
          message={
            stockQuery.error instanceof Error
              ? stockQuery.error.message
              : "Could not load stock."
          }
        />
      ) : null}

      {filter === "missing" ? (
        filteredMissing.length === 0 ? (
          <p className="empty-state">
            Nothing is below its minimum stock level.
          </p>
        ) : (
          <section className="panel">
            <div className="panel-inner" style={{ padding: 0 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Missing</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredMissing.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Link
                          to="/products/$productId"
                          params={{ productId: String(item.id) }}
                          className="row-link"
                        >
                          {item.name}
                        </Link>
                      </td>
                      <td className="amount-cell">
                        {formatAmount(item.amount_missing)}
                      </td>
                      <td>
                        <div className="actions">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busyId === item.id}
                            onClick={() => purchase.mutate(item.id)}
                          >
                            Purchase
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      ) : stockQuery.isSuccess && rows.length === 0 ? (
        <p className="empty-state">
          {search || filter !== "all"
            ? "No stock matches this filter."
            : "Stock is empty. Open a product and purchase to get started."}
        </p>
      ) : stockQuery.isSuccess ? (
        <section className="panel">
          <div className="panel-inner" style={{ padding: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Amount</th>
                  <th>Opened</th>
                  <th>Best before</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const tone = dueTone(item.best_before_date);
                  return (
                    <tr key={item.product_id}>
                      <td>
                        <Link
                          to="/products/$productId"
                          params={{ productId: String(item.product_id) }}
                          className="row-link"
                        >
                          {item.product.name}
                        </Link>
                      </td>
                      <td className="amount-cell">
                        {formatAmount(item.amount)}
                      </td>
                      <td className="muted">
                        {formatAmount(item.amount_opened)}
                      </td>
                      <td>
                        {tone ? (
                          <span className={`badge badge-${tone}`}>
                            {dueLabel(item.best_before_date)}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <div className="actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busyId === item.product_id}
                            onClick={() => purchase.mutate(item.product_id)}
                          >
                            +1
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={
                              busyId === item.product_id || item.amount <= 0
                            }
                            onClick={() => consume.mutate(item.product_id)}
                          >
                            Consume
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
