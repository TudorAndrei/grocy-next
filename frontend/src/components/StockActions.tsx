import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, queryKeys, type ConsumeOptions, type PurchaseOptions } from "@/lib/api";
import { useCatalog } from "@/lib/catalog";
import { isoDay } from "@/lib/format";
import { preferenceEnabled, usePreferences } from "@/lib/preferences";
import { objectsQuery } from "@/hooks/queries";
import { useStockMove } from "@/lib/stockActions";
import { useFeatures } from "@/lib/features";
import { ErrorBlock } from "./ErrorBlock";
import { Gauge } from "./Gauge";
import { LoadingBlock } from "./LoadingBlock";

type Move = "purchase" | "consume" | "open";

type StockActionsProps = {
  productId: number;
  initialMove?: Move;
};

export function StockActions({ productId, initialMove = "purchase" }: StockActionsProps) {
  const features = useFeatures();
  const priceEnabled = features.enabled("STOCK_PRICE_TRACKING");
  const locationsEnabled = features.enabled("STOCK_LOCATION_TRACKING");
  const datesEnabled = features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING");
  const openingEnabled = features.enabled("STOCK_PRODUCT_OPENED_TRACKING");
  const catalog = useCatalog();
  const product = catalog.product(productId);
  const preferences = usePreferences();
  const { formatAmount } = preferences;
  const stores = useQuery({ ...objectsQuery("shopping_locations"), enabled: priceEnabled });

  const stock = useQuery({
    queryKey: queryKeys.stock(productId),
    queryFn: () => api.getStockProduct(productId),
  });

  const [selection, setMove] = useState<Move>(initialMove);

  const move =
    selection === "open" && (!openingEnabled || product?.disable_open) ? "consume" : selection;

  const [amount, setAmount] = useState<string | null>(null);
  const [bestBefore, setBestBefore] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [spoiled, setSpoiled] = useState(false);
  const [price, setPrice] = useState("");
  const [storeId, setStoreId] = useState<string | null>(null);
  const [purchasedDate, setPurchasedDate] = useState(isoDay);
  const [note, setNote] = useState("");

  const purchase = useStockMove("purchase");
  const consume = useStockMove("consume");
  const open = useStockMove("open");
  const pending = purchase.isPending || consume.isPending || open.isPending;

  const locationValue =
    locationId ??
    String(
      (move === "purchase" ? product?.location_id : product?.default_consume_location_id) ?? "",
    );

  const location = catalog.location(Number(locationValue));
  const freezerDays = product?.default_best_before_days_after_freezing;

  const defaultDays =
    features.enabled("STOCK_PRODUCT_FREEZING") &&
    location?.is_freezer &&
    freezerDays != null &&
    freezerDays >= -1
      ? freezerDays
      : (product?.default_best_before_days ?? 0);

  const bestBeforeValue = bestBefore ?? (defaultDays === -1 ? "2999-12-31" : isoDay(defaultDays));
  const onHand = stock.data?.stock_amount_aggregated ?? stock.data?.stock_amount ?? 0;
  const opened = stock.data?.stock_amount_opened_aggregated ?? stock.data?.stock_amount_opened ?? 0;
  const min = product?.min_stock_amount ?? 0;

  const minimumAmount =
    onHand - (preferenceEnabled(product?.treat_opened_as_out_of_stock) ? opened : 0);

  const defaultAmount =
    move === "purchase"
      ? preferences.purchaseAmount
      : preferences.useQuickConsumeAmount
        ? (product?.quick_consume_amount ?? 1)
        : preferences.consumeAmount;

  const amountValue = amount ?? (defaultAmount > 0 ? String(defaultAmount) : "");
  const value = Number(amountValue);

  function onSubmit(e: FormEvent) {
    e.preventDefault();

    if (!(value > 0)) return;
    const location = locationValue ? Number(locationValue) : null;

    if (move === "purchase") {
      const purchaseOptions: PurchaseOptions = {
        best_before_date: datesEnabled ? bestBefore || null : null,
        price: priceEnabled ? (price === "" ? null : Number(price)) : 0,
        purchased_date: purchasedDate || null,
        note: note || null,
      };

      if (locationsEnabled) purchaseOptions.location_id = location;

      if (priceEnabled)
        purchaseOptions.shopping_location_id =
          Number(storeId ?? product?.shopping_location_id) || null;
      purchase.mutate({
        productId,
        amount: value,
        purchase: purchaseOptions,
      });
    } else if (move === "consume") {
      const consumeOptions: ConsumeOptions = { spoiled };

      if (locationsEnabled) consumeOptions.location_id = location;
      consume.mutate({
        productId,
        amount: value,
        consume: consumeOptions,
      });
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
          {openingEnabled && opened > 0 ? (
            <span className="stock-opened">{formatAmount(opened)} opened</span>
          ) : null}
        </div>
        <Gauge amount={minimumAmount} min={min} label={product?.name ?? "Product"} />
      </div>

      <form className="move-form" onSubmit={onSubmit}>
        <div className="seg-group" role="group" aria-label="Stock move">
          {(["purchase", "consume", "open"] as const).flatMap((id) =>
            id === "open" && (!openingEnabled || product?.disable_open)
              ? []
              : [
                  <button
                    key={id}
                    type="button"
                    className="seg"
                    aria-pressed={move === id}
                    onClick={() => {
                      setMove(id);
                      setAmount(null);
                      setLocationId(null);
                    }}
                  >
                    {{ purchase: "Purchase", consume: "Consume", open: "Open" }[id]}
                  </button>,
                ],
          )}
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
              {datesEnabled ? (
                <label className="field">
                  <span>Best before</span>
                  <input
                    type="date"
                    value={bestBeforeValue}
                    data-empty={bestBeforeValue ? undefined : "true"}
                    onChange={(e) => setBestBefore(e.target.value)}
                  />
                </label>
              ) : null}
              {locationsEnabled ? (
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
              ) : null}
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
        {move === "purchase" ? (
          <details>
            <summary>Purchase details</summary>
            <div className="form-grid">
              {priceEnabled ? (
                <label className="field">
                  <span>Price per stock unit</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </label>
              ) : null}
              {priceEnabled ? (
                <label className="field">
                  <span>Store</span>
                  <select
                    value={storeId ?? String(product?.shopping_location_id ?? "")}
                    onChange={(e) => setStoreId(e.target.value)}
                  >
                    <option value="">No store</option>
                    {(stores.data ?? []).map((store) => (
                      <option key={store.id} value={store.id}>
                        {store.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="field">
                <span>Purchase date</span>
                <input
                  type="date"
                  value={purchasedDate}
                  onChange={(e) => setPurchasedDate(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Note</span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
          </details>
        ) : null}
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
