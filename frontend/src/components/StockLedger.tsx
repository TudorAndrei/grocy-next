import { useI18n } from "@/lib/i18n";
import type { JsonObject } from "@/lib/json";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, request } from "@/lib/api";
import { useCatalog } from "@/lib/catalog";
import { usePreferences } from "@/lib/preferences";
import { objectsQuery } from "@/hooks/queries";
import { useFeatures } from "@/lib/features";
import { isoDay } from "@/lib/format";
import { ErrorBlock } from "./ErrorBlock";

type Entry = {
  id: number;
  amount: number;
  location_id: number;
  best_before_date: string | null;
  price: number | null;
  open: number;
  purchased_date?: string | null;
  shopping_location_id?: number | null;
  note?: string | null;
};

type Booking = {
  id: number;
  amount: number;
  transaction_type: string;
  undone: number;
};

type PriceRow = { price: number; row_created_timestamp?: string };

type Adjust = "transfer" | "inventory";

/** Entry-level stock work: transfer, count, entry edits, prices and booking undo. */
export function StockLedger({ productId }: { productId: number }) {
  const { t: tr } = useI18n();

  const features = useFeatures();
  const priceEnabled = features.enabled("STOCK_PRICE_TRACKING");
  const locationsEnabled = features.enabled("STOCK_LOCATION_TRACKING");
  const datesEnabled = features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING");
  const openingEnabled = features.enabled("STOCK_PRODUCT_OPENED_TRACKING");
  const { formatAmount, formatPrice, showPurchaseDate } = usePreferences();
  const client = useQueryClient();
  const catalog = useCatalog();
  const [selection, setAdjust] = useState<Adjust>("transfer");
  const adjust = locationsEnabled ? selection : "inventory";
  const [amount, setAmount] = useState("1");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [bestBefore, setBestBefore] = useState("");
  const [purchasedDate, setPurchasedDate] = useState(isoDay);
  const [editEntry, setEditEntry] = useState<Entry | null>(null);
  const [entryAmount, setEntryAmount] = useState("");
  const [entryExpiry, setEntryExpiry] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [entryPurchased, setEntryPurchased] = useState("");
  const [entryLocation, setEntryLocation] = useState("");
  const [entryStore, setEntryStore] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const [entryOpen, setEntryOpen] = useState(false);
  const stores = useQuery({ ...objectsQuery("shopping_locations"), enabled: priceEnabled });

  const entries = useQuery({
    queryKey: ["stock", "entries", productId],
    queryFn: () => request<Entry[]>(`/api/stock/products/${productId}/entries`),
  });

  const bookings = useQuery({
    queryKey: ["stock", "log", productId],
    queryFn: () =>
      request<Booking[]>(
        `/api/objects/stock_log?query[]=product_id=${productId}&order=id:desc&limit=12`,
      ),
  });

  const prices = useQuery({
    queryKey: ["stock", "prices", productId],
    queryFn: () => request<PriceRow[]>(`/api/stock/products/${productId}/price-history`),
    enabled: priceEnabled,
  });

  const action = useMutation({
    mutationFn: async (fn: () => Promise<void>) => {
      await fn();
    },
    onSuccess: async () => {
      setEditEntry(null);
      await client.invalidateQueries();
    },
  });

  const locationName = (id: number) =>
    catalog.locations.find((l) => l.id === id)?.name ?? `Location #${id}`;

  const error = entries.error || bookings.error || prices.error || action.error;

  function submitAdjust(e: FormEvent) {
    e.preventDefault();

    const body: JsonObject =
      adjust === "inventory" ? { new_amount: Number(amount) } : { amount: Number(amount) };

    if (adjust === "transfer") {
      body.location_id_from = Number(from);
      body.location_id_to = Number(to);
    } else {
      if (locationsEnabled && from) body.location_id = Number(from);

      if (datesEnabled && bestBefore) body.best_before_date = bestBefore;

      if (showPurchaseDate) body.purchased_date = purchasedDate || null;
    }

    action.mutate(() => api.action(`/api/stock/products/${productId}/${adjust}`, body));
  }

  function submitEntry(e: FormEvent) {
    e.preventDefault();

    if (!editEntry) return;

    const body: JsonObject = {
      amount: Number(entryAmount),
      best_before_date: entryExpiry || null,
      purchased_date: entryPurchased || null,
      price: priceEnabled ? (entryPrice === "" ? null : Number(entryPrice)) : 0,
      location_id: locationsEnabled ? Number(entryLocation) : 1,
      note: entryNote || null,
      open: openingEnabled && entryOpen,
    };

    if (priceEnabled) body.shopping_location_id = entryStore ? Number(entryStore) : null;
    action.mutate(() =>
      request(`/api/stock/entry/${editEntry.id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    );
  }

  const locationOptions = catalog.locations.map((l) => (
    <option key={l.id} value={l.id}>
      {l.name}
    </option>
  ));

  return (
    <section className="panel" aria-labelledby="ledger-heading">
      <h2 className="panel-head" id="ledger-heading">
        {tr("Entries and bookings")}
      </h2>
      {error ? <ErrorBlock message={error.message} /> : null}

      <form className="panel-body move-form" onSubmit={submitAdjust}>
        <div className="seg-group" role="group" aria-label={tr("Stock adjustment")}>
          {(["transfer", "inventory"] as const).flatMap((id) =>
            id === "transfer" && !locationsEnabled
              ? []
              : [
                  <button
                    key={id}
                    type="button"
                    className="seg"
                    aria-pressed={adjust === id}
                    onClick={() => {
                      setAdjust(id);
                      action.reset();
                    }}
                  >
                    {tr({ transfer: "Transfer", inventory: "Count" }[id])}
                  </button>,
                ],
          )}
        </div>
        <div className="field-row">
          <label className="field">
            <span>{adjust === "inventory" ? tr("New stock count") : tr("Amount")}</span>
            <input
              type="number"
              step="any"
              min={adjust === "inventory" ? "0" : "0.000001"}
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          {locationsEnabled ? (
            <label className="field">
              <span>{adjust === "transfer" ? tr("From") : tr("Location")}</span>
              <select
                required={adjust === "transfer"}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              >
                <option value="">
                  {adjust === "transfer" ? tr("Select location") : tr("All locations")}
                </option>
                {locationOptions}
              </select>
            </label>
          ) : null}
          {adjust === "transfer" ? (
            <label className="field">
              <span>{tr("To")}</span>
              <select required value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">{tr("Select location")}</option>
                {locationOptions}
              </select>
            </label>
          ) : datesEnabled ? (
            <label className="field">
              <span>{tr("Best before")}</span>
              <input
                type="date"
                value={bestBefore}
                onChange={(e) => setBestBefore(e.target.value)}
              />
            </label>
          ) : null}
          {adjust === "inventory" && showPurchaseDate ? (
            <label className="field">
              <span>{tr("Purchase date")}</span>
              <input
                type="date"
                value={purchasedDate}
                onChange={(event) => setPurchasedDate(event.target.value)}
              />
            </label>
          ) : null}
        </div>
        <button type="submit" className="btn btn-primary" disabled={action.isPending}>
          {adjust === "transfer" ? tr("Transfer") : tr("Save count")}
        </button>
      </form>

      <h3 className="panel-sub">{tr("Stock entries")}</h3>
      {entries.isSuccess && entries.data.length === 0 ? (
        <p className="panel-empty">{tr("No stock entries.")}</p>
      ) : null}
      <ol className="ledger">
        {entries.data?.map((entry) => (
          <li key={entry.id}>
            <span>
              {formatAmount(entry.amount)}
              {locationsEnabled ? tr(" at %s", String(locationName(entry.location_id))) : ""}
              {openingEnabled && entry.open ? tr(", opened") : ""}
              {datesEnabled && entry.best_before_date
                ? tr(", best before %s", String(entry.best_before_date))
                : ""}
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setEditEntry(entry);
                setEntryAmount(String(entry.amount));
                setEntryExpiry(entry.best_before_date ?? "");
                setEntryPrice(entry.price == null ? "" : String(entry.price));
                setEntryPurchased(entry.purchased_date ?? "");
                setEntryLocation(String(entry.location_id));
                setEntryStore(
                  entry.shopping_location_id == null ? "" : String(entry.shopping_location_id),
                );
                setEntryNote(entry.note ?? "");
                setEntryOpen(Boolean(entry.open));
              }}
            >
              {tr("Edit")}
            </button>
          </li>
        ))}
      </ol>
      {editEntry ? (
        <form className="panel-body move-form" onSubmit={submitEntry}>
          <div className="form-grid">
            <label className="field">
              <span>{tr("Entry amount")}</span>
              <input
                type="number"
                min="0"
                step="any"
                required
                value={entryAmount}
                onChange={(e) => setEntryAmount(e.target.value)}
              />
            </label>
            {datesEnabled ? (
              <label className="field">
                <span>{tr("Best before")}</span>
                <input
                  type="date"
                  value={entryExpiry}
                  onChange={(e) => setEntryExpiry(e.target.value)}
                />
              </label>
            ) : null}
            <label className="field">
              <span>{tr("Purchase date")}</span>
              <input
                type="date"
                value={entryPurchased}
                onChange={(e) => setEntryPurchased(e.target.value)}
              />
            </label>
            {priceEnabled ? (
              <label className="field">
                <span>{tr("Price per stock unit")}</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={entryPrice}
                  onChange={(e) => setEntryPrice(e.target.value)}
                />
              </label>
            ) : null}
            {locationsEnabled ? (
              <label className="field">
                <span>{tr("Location")}</span>
                <select
                  required
                  value={entryLocation}
                  onChange={(e) => setEntryLocation(e.target.value)}
                >
                  {locationOptions}
                </select>
              </label>
            ) : null}
            {priceEnabled ? (
              <label className="field">
                <span>{tr("Store")}</span>
                <select value={entryStore} onChange={(e) => setEntryStore(e.target.value)}>
                  <option value="">{tr("No store")}</option>
                  {(stores.data ?? []).map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="field">
              <span>{tr("Note")}</span>
              <textarea value={entryNote} onChange={(e) => setEntryNote(e.target.value)} />
            </label>
            {openingEnabled ? (
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={entryOpen}
                  onChange={(e) => setEntryOpen(e.target.checked)}
                />
                <span>{tr("Opened")}</span>
              </label>
            ) : null}
          </div>
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={action.isPending}>
              {tr("Save entry")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditEntry(null)}>
              {tr("Cancel")}
            </button>
          </div>
        </form>
      ) : null}

      {priceEnabled ? (
        <>
          <h3 className="panel-sub">{tr("Price history")}</h3>
          {prices.isSuccess && prices.data.length === 0 ? (
            <p className="panel-empty">{tr("No purchase prices recorded yet.")}</p>
          ) : null}
          <ol className="ledger">
            {prices.data?.slice(0, 8).map((row, index) => (
              <li key={index}>
                <span>{formatPrice(row.price)}</span>
                <span className="faint">{row.row_created_timestamp ?? ""}</span>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      <h3 className="panel-sub">{tr("Recent bookings")}</h3>
      <ol className="ledger">
        {bookings.data?.map((log) => (
          <li key={log.id}>
            <span>
              {log.transaction_type.replace(/_/g, " ")}: {formatAmount(log.amount)}
              {log.undone ? tr(" (undone)") : ""}
            </span>
            {!log.undone ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate(() => api.action(`/api/stock/bookings/${log.id}/undo`))
                }
              >
                {tr("Undo")}
              </button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
