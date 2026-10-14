import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, queryKeys } from "@/lib/api";
import { formatAmount } from "@/lib/format";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

type StockActionsProps = {
  productId: number;
};

export function StockActions({ productId }: StockActionsProps) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("1");
  const [feedback, setFeedback] = useState<string | null>(null);

  const stockQuery = useQuery({
    queryKey: queryKeys.stock(productId),
    queryFn: () => api.getStockProduct(productId),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.stock(productId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.stockOverview });
    await queryClient.invalidateQueries({ queryKey: queryKeys.stockVolatile });
    await queryClient.invalidateQueries({ queryKey: queryKeys.recipes });
  };

  const purchase = useMutation({
    mutationFn: () => api.purchaseStock(productId, Number(amount)),
    onSuccess: async () => {
      setFeedback("Purchased.");
      await invalidate();
    },
    onError: (err: Error) => setFeedback(err.message),
  });

  const consume = useMutation({
    mutationFn: () => api.consumeStock(productId, Number(amount)),
    onSuccess: async () => {
      setFeedback("Consumed.");
      await invalidate();
    },
    onError: (err: Error) => setFeedback(err.message),
  });

  const open = useMutation({
    mutationFn: () => api.openStock(productId, Number(amount)),
    onSuccess: async () => {
      setFeedback("Opened.");
      await invalidate();
    },
    onError: (err: Error) => setFeedback(err.message),
  });

  return (
    <section className="panel" aria-labelledby="stock-heading">
      <div className="panel-inner">
        <h2 id="stock-heading" className="panel-title">
          Stock
        </h2>
        {stockQuery.isLoading ? <LoadingBlock label="Loading stock…" /> : null}
        {stockQuery.isError ? (
          <ErrorBlock
            message={
              stockQuery.error instanceof Error
                ? stockQuery.error.message
                : "Could not load stock."
            }
          />
        ) : null}
        {stockQuery.isSuccess ? (
          <div className="stat-strip" style={{ marginBottom: "1rem" }}>
            <div className="stat-card" data-tone="accent">
              <span className="label">On hand</span>
              <span className="value">
                {formatAmount(stockQuery.data.stock_amount ?? 0)}
              </span>
            </div>
            <div className="stat-card">
              <span className="label">Opened</span>
              <span className="value">
                {formatAmount(stockQuery.data.stock_amount_opened ?? 0)}
              </span>
            </div>
          </div>
        ) : null}
        <div className="field-row">
          <label>
            Amount
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
            />
          </label>
        </div>
        <div className="field-row" style={{ marginBottom: 0 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={purchase.isPending}
            onClick={() => {
              setFeedback(null);
              purchase.mutate();
            }}
          >
            Purchase
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={consume.isPending}
            onClick={() => {
              setFeedback(null);
              consume.mutate();
            }}
          >
            Consume
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={open.isPending}
            onClick={() => {
              setFeedback(null);
              open.mutate();
            }}
          >
            Open
          </button>
        </div>
        {feedback ? (
          <p className="muted" style={{ margin: "0.75rem 0 0" }} role="status">
            {feedback}
          </p>
        ) : null}
      </div>
    </section>
  );
}
