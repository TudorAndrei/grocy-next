import { useI18n } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, queryKeys, type ConsumeOptions, type PurchaseOptions } from "@/lib/api";
import { useCatalog } from "@/lib/catalog";
import { isoDay, unitLabel } from "@/lib/format";
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
  const { t: tr, pluralIndex } = useI18n();

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
  const conversions = useQuery(objectsQuery("quantity_unit_conversions_resolved"));

  const stock = useQuery({
    queryKey: queryKeys.stock(productId),
    queryFn: () => api.getStockProduct(productId),
  });

  const [selection, setMove] = useState<Move>(initialMove);
  const tareEnabled = preferenceEnabled(product?.enable_tare_weight_handling);

  const move =
    selection === "open" && (!openingEnabled || product?.disable_open || tareEnabled)
      ? "consume"
      : selection;

  const [amount, setAmount] = useState<string | null>(null);
  const [bestBefore, setBestBefore] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [spoiled, setSpoiled] = useState(false);
  const [price, setPrice] = useState<string | null>(null);
  const [priceType, setPriceType] = useState<string | null>(null);
  const [quantityUnitId, setQuantityUnitId] = useState<string | null>(null);
  const [exactAmount, setExactAmount] = useState(false);
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

  const stockUnitId = product?.qu_id_stock ?? 0;
  const unitFactors = new Map<number, number>([[stockUnitId, 1]]);

  for (const conversion of conversions.data ?? []) {
    const from = Number(conversion.from_qu_id);
    const to = Number(conversion.to_qu_id);

    if (
      Number(conversion.product_id) === productId &&
      (from === stockUnitId || to === stockUnitId) &&
      !unitFactors.has(to)
    )
      unitFactors.set(to, Number(conversion.factor));
  }

  const defaultUnitId =
    move === "purchase"
      ? tareEnabled
        ? stockUnitId
        : (product?.qu_id_purchase ?? stockUnitId)
      : (product?.qu_id_consume ?? stockUnitId);

  const selectedUnitId = Number(quantityUnitId ?? defaultUnitId);
  const unitId = unitFactors.has(selectedUnitId) ? selectedUnitId : stockUnitId;
  const unitFactor = unitFactors.get(unitId) ?? 1;
  const defaultUnitFactor = unitFactors.get(defaultUnitId) ?? 1;
  const selectedUnit = catalog.unit(unitId);
  const unitSelectionEnabled = unitFactors.size > 1 && !(move === "purchase" && tareEnabled);

  const defaultAmount =
    move === "purchase"
      ? preferences.purchaseAmount
      : preferences.useQuickConsumeAmount
        ? (product?.quick_consume_amount ?? 1) * unitFactor
        : preferences.consumeAmount;

  const amountValue = amount ?? (defaultAmount > 0 ? String(defaultAmount) : "");
  const value = Number(amountValue);
  // The legacy amount picker rounds in stock units, with at least one decimal place.
  const stockValue = Number((value / unitFactor).toFixed(preferences.amountPrecision || 1));
  const grossWeight = tareEnabled && (move === "purchase" || (move === "consume" && !exactAmount));
  const tareWeight = product?.tare_weight ?? 0;
  const ownStock = stock.data?.stock_amount ?? 0;
  const minimumValue = grossWeight ? tareWeight + (move === "purchase" ? ownStock : 0) : 0;
  const maximumValue = move === "purchase" ? Infinity : onHand + (grossWeight ? tareWeight : 0);
  const amountValid = stockValue > 0 && stockValue >= minimumValue && stockValue <= maximumValue;

  const priceTypeValue =
    priceType ?? (product?.default_purchase_price_type === 3 ? "total" : "unit");

  const priceValue =
    price ??
    (stock.data?.last_price
      ? (stock.data.last_price / defaultUnitFactor).toFixed(preferences.priceDisplayPrecision)
      : "");

  const storeValue =
    storeId ?? String(stock.data?.last_shopping_location_id ?? product?.shopping_location_id ?? "");

  function onSubmit(e: FormEvent) {
    e.preventDefault();

    if (!amountValid || conversions.isPending || conversions.isError) return;
    const location = locationValue ? Number(locationValue) : null;

    if (move === "purchase") {
      let unitPrice = Number(
        (Number(priceValue) * unitFactor).toFixed(preferences.priceInputPrecision),
      );

      if (priceTypeValue === "total")
        unitPrice = Number(
          (unitPrice / (value - (tareEnabled ? tareWeight : 0))).toFixed(
            preferences.priceInputPrecision,
          ),
        );

      const purchaseOptions: PurchaseOptions = {
        best_before_date: datesEnabled ? bestBeforeValue || null : null,
        price: priceEnabled ? (priceValue === "" ? null : unitPrice) : 0,
        note: note || null,
      };

      if (preferences.showPurchaseDate) purchaseOptions.purchased_date = purchasedDate || null;

      if (locationsEnabled) purchaseOptions.location_id = location;

      if (priceEnabled) purchaseOptions.shopping_location_id = Number(storeValue) || null;
      purchase.mutate({
        productId,
        amount: stockValue,
        purchase: purchaseOptions,
      });
    } else if (move === "consume") {
      const consumeOptions: ConsumeOptions = { spoiled };

      if (tareEnabled) consumeOptions.exact_amount = exactAmount;

      if (locationsEnabled) consumeOptions.location_id = location;
      consume.mutate({
        productId,
        amount: stockValue,
        consume: consumeOptions,
      });
    } else {
      open.mutate({ productId, amount: stockValue });
    }
  }

  const unit = unitLabel(selectedUnit, value || 1, pluralIndex);
  const verb = tr({ purchase: "Purchase", consume: "Consume", open: "Mark opened" }[move]);

  return (
    <section className="panel stock-panel" aria-labelledby="stock-heading">
      <h2 className="panel-head" id="stock-heading">
        {tr("Stock")}
        <span>
          {min > 0
            ? tr("minimum %s", String(catalog.amountText(productId, min)))
            : tr("no minimum set")}
        </span>
      </h2>
      {stock.isLoading ? <LoadingBlock label={tr("Loading stock…")} /> : null}
      {stock.isError ? <ErrorBlock message={stock.error.message} /> : null}
      {conversions.isError ? <ErrorBlock message={conversions.error.message} /> : null}
      <div className="stock-level">
        <div className="stock-figure">
          <span className="stock-amount">{formatAmount(onHand)}</span>
          <span className="stock-unit">
            {catalog.stockUnitText(productId, onHand)} {tr("on hand")}
          </span>
          {openingEnabled && opened > 0 ? (
            <span className="stock-opened">
              {formatAmount(opened)} {tr("opened")}
            </span>
          ) : null}
        </div>
        <Gauge amount={minimumAmount} min={min} label={product?.name ?? tr("Product")} />
      </div>

      <form className="move-form" onSubmit={onSubmit}>
        <div className="seg-group" role="group" aria-label={tr("Stock move")}>
          {(["purchase", "consume", "open"] as const).flatMap((id) =>
            id === "open" && (!openingEnabled || product?.disable_open || tareEnabled)
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
                      setQuantityUnitId(null);
                    }}
                  >
                    {tr({ purchase: "Purchase", consume: "Consume", open: "Open" }[id])}
                  </button>,
                ],
          )}
        </div>
        <div className="field-row">
          <label className="field">
            <span>{grossWeight ? tr("Gross weight") : tr("Amount")}</span>
            <span className="amount-field" data-unit-select={unitSelectionEnabled || undefined}>
              <input
                aria-label={grossWeight ? tr("Gross weight") : tr("Amount")}
                value={amountValue}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                autoFocus={initialMove !== "purchase"}
                required
              />
              {unitSelectionEnabled ? null : <span className="unit">{unit}</span>}
            </span>
          </label>
          {unitSelectionEnabled ? (
            <label className="field">
              <span>{tr("Quantity unit")}</span>
              <select
                value={unitId}
                onChange={(e) => {
                  setAmount(amountValue);
                  setQuantityUnitId(e.target.value);
                }}
              >
                {[...unitFactors.keys()].map((id) => (
                  <option key={id} value={id}>
                    {catalog.unit(id)?.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {move === "purchase" ? (
            <>
              {datesEnabled ? (
                <label className="field">
                  <span>{tr("Best before")}</span>
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
                  <span>{tr("Location")}</span>
                  <select value={locationValue} onChange={(e) => setLocationId(e.target.value)}>
                    <option value="">{tr("Product default")}</option>
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
              <span>{tr("Spoiled — thrown away, not eaten")}</span>
            </label>
          ) : null}
        </div>
        {unitId !== stockUnitId && value > 0 ? (
          <p className="field-hint">
            {tr("This equals")} {catalog.amountText(productId, stockValue)}.
          </p>
        ) : null}
        {grossWeight ? (
          <p className="field-hint">
            {tr("Tare weight:")} {catalog.amountText(productId, tareWeight)}
            {tr(". Enter the weight including the container.")}
          </p>
        ) : null}
        {move === "consume" && tareEnabled ? (
          <label className="check-field">
            <input
              type="checkbox"
              checked={exactAmount}
              onChange={(e) => setExactAmount(e.target.checked)}
            />
            <span>{tr("Consume exact amount")}</span>
          </label>
        ) : null}
        {move === "purchase" ? (
          <details>
            <summary>{tr("Purchase details")}</summary>
            <div className="form-grid">
              {priceEnabled ? (
                <label className="field">
                  <span>
                    {priceTypeValue === "total"
                      ? tr("Total price")
                      : unitId === stockUnitId
                        ? tr("Price per stock unit")
                        : tr("Price per %s", String(selectedUnit?.name ?? "unit"))}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={priceValue}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </label>
              ) : null}
              {priceEnabled ? (
                <label className="field">
                  <span>{tr("Price type")}</span>
                  <select value={priceTypeValue} onChange={(e) => setPriceType(e.target.value)}>
                    <option value="unit">{tr("Unit price")}</option>
                    <option value="total">{tr("Total price")}</option>
                  </select>
                </label>
              ) : null}
              {priceEnabled ? (
                <label className="field">
                  <span>{tr("Store")}</span>
                  <select value={storeValue} onChange={(e) => setStoreId(e.target.value)}>
                    <option value="">{tr("No store")}</option>
                    {(stores.data ?? []).map((store) => (
                      <option key={store.id} value={store.id}>
                        {store.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {preferences.showPurchaseDate ? (
                <label className="field">
                  <span>{tr("Purchase date")}</span>
                  <input
                    type="date"
                    value={purchasedDate}
                    onChange={(e) => setPurchasedDate(e.target.value)}
                  />
                </label>
              ) : null}
              <label className="field">
                <span>{tr("Note")}</span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
          </details>
        ) : null}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending || conversions.isPending || conversions.isError || !amountValid}
        >
          {verb} {value > 0 ? `${formatAmount(value)} ${unit}` : ""}
        </button>
        {stockValue < minimumValue ? (
          <p className="field-hint" role="status">
            {tr("Minimum gross weight:")} {catalog.amountText(productId, minimumValue)}.
          </p>
        ) : null}
        {move !== "purchase" && stockValue > maximumValue ? (
          <p className="field-hint" role="status">
            {tr("Only")} {catalog.amountText(productId, onHand)} {tr("on hand.")}
          </p>
        ) : null}
      </form>
    </section>
  );
}
