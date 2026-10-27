import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, queryKeys } from "@/lib/api";
import { useCatalog } from "@/lib/catalog";
import { formatAmount, isoDay } from "@/lib/format";
import { useStockMove } from "@/lib/stockActions";
import { ErrorBlock } from "./ErrorBlock";
import { Gauge } from "./Gauge";
import { LoadingBlock } from "./LoadingBlock";

type Move = "purchase" | "consume" | "open";

type StockActionsProps = {
  productId: number;
  initialMove?: Move;
};

export function StockActions({ productId, initialMove = "purchase" }: StockActionsProps) {
  const catalog = useCatalog();
  const product = catalog.product(productId);

  const stock = useQuery({
    queryKey: queryKeys.stock(productId),
    queryFn: () => api.getStockProduct(productId),
  });

  const [move, setMove] = useState<Move>(initialMove);
  // Weighed products have no sensible default amount; counted ones start at 1.
  const [amount, setAmount] = useState<string | null>(null);
  const [bestBefore, setBestBefore] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [spoiled, setSpoiled] = useState(false);

  const purchase = useStockMove("purchase");
  const consume = useStockMove("consume");
  const open = useStockMove("open");
  const pending = purchase.isPending || consume.isPending || open.isPending;

  const defaultDays = product?.default_best_before_days ?? 0;
  const bestBeforeValue = bestBefore ?? (defaultDays > 0 ? isoDay(defaultDays) : "");
  const locationValue = locationId ?? String(product?.location_id ?? "");
  const onHand = stock.data?.stock_amount ?? 0;
  const opened = stock.data?.stock_amount_opened ?? 0;
  const min = product?.min_stock_amount ?? 0;
  const amountValue = amount ?? (catalog.countsItems(productId) ? "1" : "");
  const value = Number(amountValue);

  function onSubmit(e: FormEvent) {
    e.preventDefault();

    if (!(value > 0)) return;
    const location = locationValue ? Number(locationValue) : null;

    if (move === "purchase") {
      purchase.mutate({
        productId,
        amount: value,
        purchase: { best_before_date: bestBeforeValue || null, location_id: location },
      });
    } else if (move === "consume") {
      consume.mutate({ productId, amount: value, consume: { spoiled } });
    } else {
      open.mutate({ productId, amount: value });
    }
  }

  const unit = catalog.stockUnitText(productId, value || 1);
  const verb = { purchase: "Purchase", consume: "Consume", open: "Mark opened" }[move];

  return (
    <section className="panel stock-panel" aria-labelledby="stock-heading">
      <h2 className="panel-head" id="stock-heading">
        Stock
        <span>{min > 0 ? `minimum ${catalog.amountText(productId, min)}` : "no minimum set"}</span>
      </h2>
      {stock.isLoading ? <LoadingBlock label="Loading stock…" /> : null}
      {stock.isError ? <ErrorBlock message={stock.error.message} /> : null}
      <div className="stock-level">
        <div className="stock-figure">
          <span className="stock-amount">{formatAmount(onHand)}</span>
          <span className="stock-unit">{catalog.stockUnitText(productId, onHand)} on hand</span>
          {opened > 0 ? <span className="stock-opened">{formatAmount(opened)} opened</span> : null}
        </div>
        <Gauge amount={onHand} min={min} label={product?.name ?? "Product"} />
      </div>

      <form className="move-form" onSubmit={onSubmit}>
        <div className="seg-group" role="group" aria-label="Stock move">
          {(["purchase", "consume", "open"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className="seg"
              aria-pressed={move === id}
              onClick={() => setMove(id)}
            >
              {{ purchase: "Purchase", consume: "Consume", open: "Open" }[id]}
            </button>
          ))}
        </div>
        <div className="field-row">
          <label className="field">
            <span>Amount</span>
            <span className="amount-field">
              <input
                value={amountValue}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                autoFocus={initialMove !== "purchase"}
                required
              />
              <span className="unit">{unit}</span>
            </span>
          </label>
          {move === "purchase" ? (
            <>
              <label className="field">
                <span>Best before</span>
                <input
                  type="date"
                  value={bestBeforeValue}
                  data-empty={bestBeforeValue ? undefined : "true"}
                  onChange={(e) => setBestBefore(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Location</span>
                <select value={locationValue} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">Product default</option>
                  {catalog.locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          {move === "consume" ? (
            <label className="check-field">
              <input
                type="checkbox"
                checked={spoiled}
                onChange={(e) => setSpoiled(e.target.checked)}
              />
              <span>Spoiled — thrown away, not eaten</span>
            </label>
          ) : null}
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending || !(value > 0) || (move !== "purchase" && value > onHand)}
        >
          {verb} {value > 0 ? `${formatAmount(value)} ${unit}` : ""}
        </button>
        {move !== "purchase" && value > onHand ? (
          <p className="field-hint" role="status">
            Only {catalog.amountText(productId, onHand)} on hand.
          </p>
        ) : null}
      </form>
    </section>
  );
}
