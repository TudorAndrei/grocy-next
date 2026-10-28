import { useI18n } from "@/lib/i18n";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, queryKeys } from "@/lib/api";
import { useCatalog, useInvalidateStock } from "@/lib/catalog";
import { formatDate, relativeTime } from "@/lib/format";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";
import { ActorTag, bookingVerb } from "@/components/ActorTag";
import { useNotify } from "@/components/Toaster";

export const Route = createFileRoute("/activity")({
  component: ActivityPage,
});

function ActivityPage() {
  const { t: tr } = useI18n();

  const catalog = useCatalog();
  const notify = useNotify();
  const invalidate = useInvalidateStock();
  const [showUndone, setShowUndone] = useState(false);
  const log = useQuery({ queryKey: queryKeys.stockLog, queryFn: api.listStockLog });
  const me = useQuery({ queryKey: queryKeys.currentUser, queryFn: api.getCurrentUser });

  const undo = useMutation({
    mutationFn: (transactionId: string) => api.undoTransaction(transactionId),
    onSuccess: async () => {
      await invalidate();
      notify({ message: tr("Booking undone") });
    },
    onError: (err: Error) => notify({ message: err.message, tone: "error" }),
  });

  const entries = useMemo(
    () =>
      [...(log.data ?? [])]
        .sort((a, b) => b.id - a.id)
        .filter((entry) => showUndone || !entry.undone),
    [log.data, showUndone],
  );

  return (
    <>
      <PageHeader
        title={tr("Activity")}
        lead={tr(
          "Every stock booking, from you or your agent. Undo reverses the whole transaction.",
        )}
      />
      <div className="toolbar">
        <label className="check-field">
          <input
            type="checkbox"
            checked={showUndone}
            onChange={(e) => setShowUndone(e.target.checked)}
          />
          <span>{tr("Show undone bookings")}</span>
        </label>
      </div>
      {log.isLoading ? <LoadingBlock label={tr("Loading activity…")} /> : null}
      {log.isError ? <ErrorBlock message={log.error.message} /> : null}
      {log.isSuccess && entries.length === 0 ? (
        <p className="empty-state">
          {tr("No bookings yet. Purchases, consumes and moves appear here.")}
        </p>
      ) : null}
      {entries.length > 0 ? (
        <div className="panel">
          <table className="stock-table activity-table">
            <thead>
              <tr>
                <th scope="col">{tr("When")}</th>
                <th scope="col">{tr("By")}</th>
                <th scope="col">{tr("Booking")}</th>
                <th scope="col">{tr("Product")}</th>
                <th scope="col" className="num">
                  {tr("Amount")}
                </th>
                <th scope="col">{tr("Best before")}</th>
                <th scope="col">
                  <span className="sr-only">{tr("Undo")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} data-undone={entry.undone ? "true" : undefined}>
                  <td className="date">{relativeTime(entry.row_created_timestamp)}</td>
                  <td>
                    <ActorTag userId={entry.user_id} currentUserId={me.data?.id} />
                  </td>
                  <td>
                    <span className="booking">{bookingVerb(entry.transaction_type)}</span>
                    {entry.spoiled ? (
                      <span className="tag" data-tone="danger">
                        {tr("spoiled")}
                      </span>
                    ) : null}
                  </td>
                  <td className="stock-name">
                    <Link
                      to="/products/$productId"
                      params={{ productId: String(entry.product_id) }}
                    >
                      {catalog.productName(entry.product_id)}
                    </Link>
                    {entry.location_id ? (
                      <small>{catalog.location(entry.location_id)?.name}</small>
                    ) : null}
                  </td>
                  <td className="num amount">
                    {catalog.amountText(entry.product_id, Math.abs(entry.amount))}
                  </td>
                  <td className="date">{formatDate(entry.best_before_date) ?? "—"}</td>
                  <td className="row-actions">
                    {entry.undone ? (
                      <span className="faint">{tr("Undone")}</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={undo.isPending}
                        onClick={() => undo.mutate(entry.transaction_id)}
                      >
                        {tr("Undo")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
