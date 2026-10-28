import { useI18n } from "@/lib/i18n";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { api } from "@/lib/api";
import { usePreferences } from "@/lib/preferences";
import { productsQuery, stockJournalQuery } from "@/hooks/queries";

export const Route = createFileRoute("/journal")({
  component: JournalPage,
});

function JournalPage() {
  const { t: tr } = useI18n();

  const { formatAmount } = usePreferences();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(150);
  const journal = useQuery(stockJournalQuery(limit));
  const products = useQuery(productsQuery());

  const productName = useMemo(() => {
    const map = new Map((products.data ?? []).map((p) => [p.id, p.name] as const));

    return (id: number) => map.get(id) ?? `Product #${id}`;
  }, [products.data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = journal.data ?? [];

    if (!q) return list;

    return list.filter((row) => productName(row.product_id).toLowerCase().includes(q));
  }, [journal.data, search, productName]);

  const undo = useMutation({
    mutationFn: (bookingId: number) => api.action(`/api/stock/bookings/${bookingId}/undo`),
    onSuccess: async () => {
      await client.invalidateQueries();
    },
  });

  const error = journal.error || products.error || undo.error;

  return (
    <>
      <PageHeader
        title={tr("Stock journal")}
        lead={tr("Recent stock bookings across all products. Undo mistaken moves here.")}
      />
      <div className="toolbar">
        <div className="search-field">
          <label className="sr-only" htmlFor="journal-search">
            {tr("Search journal")}
          </label>
          <input
            id="journal-search"
            type="search"
            placeholder={tr("Filter by product name")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="field" style={{ maxWidth: "8rem" }}>
          <label className="sr-only" htmlFor="journal-limit">
            {tr("Row limit")}
          </label>
          <select
            id="journal-limit"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            {[50, 150, 300].map((n) => (
              <option key={n} value={n}>
                {n} {tr("rows")}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error ? (
        <ErrorBlock
          message={error instanceof Error ? error.message : tr("Could not load journal.")}
        />
      ) : null}
      {journal.isLoading ? <LoadingBlock label={tr("Loading journal…")} /> : null}
      {journal.isSuccess && rows.length === 0 ? (
        <p className="empty-state">{tr("No stock bookings match this filter.")}</p>
      ) : null}
      {journal.isSuccess && rows.length > 0 ? (
        <section className="panel">
          <div className="panel-inner" style={{ padding: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{tr("When")}</th>
                  <th>{tr("Product")}</th>
                  <th>{tr("Type")}</th>
                  <th>{tr("Amount")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="muted">{row.row_created_timestamp ?? "—"}</td>
                    <td>
                      <Link
                        to="/products/$productId"
                        params={{ productId: String(row.product_id) }}
                        className="row-link"
                      >
                        {productName(row.product_id)}
                      </Link>
                    </td>
                    <td>{row.transaction_type}</td>
                    <td className="amount-cell">
                      {formatAmount(row.amount)}
                      {row.undone ? tr(" (undone)") : ""}
                    </td>
                    <td>
                      {!row.undone ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={undo.isPending}
                          onClick={() => undo.mutate(row.id)}
                        >
                          {tr("Undo")}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
