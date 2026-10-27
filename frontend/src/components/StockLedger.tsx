import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, request } from "@/lib/api";
import { useCatalog } from "@/lib/catalog";
import { formatAmount } from "@/lib/format";
import { ErrorBlock } from "./ErrorBlock";

type Entry = {
  id: number;
  amount: number;
  location_id: number;
  best_before_date: string | null;
  price: number | null;
  open: number;
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
  const client = useQueryClient();
  const catalog = useCatalog();
  const [adjust, setAdjust] = useState<Adjust>("transfer");
  const [amount, setAmount] = useState("1");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [bestBefore, setBestBefore] = useState("");
  const [editEntry, setEditEntry] = useState<Entry | null>(null);
  const [entryAmount, setEntryAmount] = useState("");
  const [entryExpiry, setEntryExpiry] = useState("");

  const entries = useQuery({
    queryKey: ["stock-entries", productId],
    queryFn: () => request<Entry[]>(`/api/stock/products/${productId}/entries`),
  });
  const bookings = useQuery({
    queryKey: ["stock-log", productId],
    queryFn: () =>
      request<Booking[]>(
        `/api/objects/stock_log?query[]=product_id=${productId}&order=id:desc&limit=12`,
      ),
  });
  const prices = useQuery({
    queryKey: ["stock-prices", productId],
    queryFn: () => request<PriceRow[]>(`/api/stock/products/${productId}/price-history`),
  });
  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
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
    const body: Record<string, unknown> =
      adjust === "inventory" ? { new_amount: Number(amount) } : { amount: Number(amount) };
    if (adjust === "transfer") {
      body.location_id_from = Number(from);
      body.location_id_to = Number(to);
    } else {
      if (from) body.location_id = Number(from);
      if (bestBefore) body.best_before_date = bestBefore;
    }
    action.mutate(() => api.action(`/api/stock/products/${productId}/${adjust}`, body));
  }

  function submitEntry(e: FormEvent) {
    e.preventDefault();
    if (!editEntry) return;
    action.mutate(() =>
      request(`/api/stock/entry/${editEntry.id}`, {
        method: "PUT",
        body: JSON.stringify({
          amount: Number(entryAmount),
          best_before_date: entryExpiry || null,
        }),
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
        Entries and bookings
      </h2>
      {error ? <ErrorBlock message={error.message} /> : null}

      <form className="panel-body move-form" onSubmit={submitAdjust}>
        <div className="seg-group" role="group" aria-label="Stock adjustment">
          {(["transfer", "inventory"] as const).map((id) => (
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
              {{ transfer: "Transfer", inventory: "Count" }[id]}
            </button>
          ))}
        </div>
        <div className="field-row">
          <label className="field">
            <span>{adjust === "inventory" ? "New stock count" : "Amount"}</span>
            <input
              type="number"
              step="any"
              min={adjust === "inventory" ? "0" : "0.000001"}
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="field">
            <span>{adjust === "transfer" ? "From" : "Location"}</span>
            <select
              required={adjust === "transfer"}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            >
              <option value="">{adjust === "transfer" ? "Select location" : "All locations"}</option>
              {locationOptions}
            </select>
          </label>
          {adjust === "transfer" ? (
            <label className="field">
              <span>To</span>
              <select required value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Select location</option>
                {locationOptions}
              </select>
            </label>
          ) : (
            <label className="field">
              <span>Best before</span>
              <input
                type="date"
                value={bestBefore}
                onChange={(e) => setBestBefore(e.target.value)}
              />
            </label>
          )}
        </div>
        <button type="submit" className="btn btn-primary" disabled={action.isPending}>
          {adjust === "transfer" ? "Transfer" : "Save count"}
        </button>
      </form>

      <h3 className="panel-sub">Stock entries</h3>
      {entries.isSuccess && entries.data.length === 0 ? (
        <p className="panel-empty">No stock entries.</p>
      ) : null}
      <ol className="ledger">
        {entries.data?.map((entry) => (
          <li key={entry.id}>
            <span>
              {formatAmount(entry.amount)} at {locationName(entry.location_id)}
              {entry.open ? ", opened" : ""}
              {entry.best_before_date ? `, best before ${entry.best_before_date}` : ""}
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setEditEntry(entry);
                setEntryAmount(String(entry.amount));
                setEntryExpiry(entry.best_before_date ?? "");
              }}
            >
              Edit
            </button>
          </li>
        ))}
      </ol>
      {editEntry ? (
        <form className="panel-body move-form" onSubmit={submitEntry}>
          <div className="field-row">
            <label className="field">
              <span>Entry amount</span>
              <input
                type="number"
                min="0"
                step="any"
                required
                value={entryAmount}
                onChange={(e) => setEntryAmount(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Best before</span>
              <input
                type="date"
                value={entryExpiry}
                onChange={(e) => setEntryExpiry(e.target.value)}
              />
            </label>
          </div>
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={action.isPending}>
              Save entry
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditEntry(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <h3 className="panel-sub">Price history</h3>
      {prices.isSuccess && prices.data.length === 0 ? (
        <p className="panel-empty">No purchase prices recorded yet.</p>
      ) : null}
      <ol className="ledger">
        {prices.data?.slice(0, 8).map((row, index) => (
          <li key={index}>
            <span>{row.price}</span>
            <span className="faint">{row.row_created_timestamp ?? ""}</span>
          </li>
        ))}
      </ol>

      <h3 className="panel-sub">Recent bookings</h3>
      <ol className="ledger">
        {bookings.data?.map((log) => (
          <li key={log.id}>
            <span>
              {log.transaction_type.replace(/_/g, " ")}: {formatAmount(log.amount)}
              {log.undone ? " (undone)" : ""}
            </span>
            {!log.undone ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={action.isPending}
                onClick={() => action.mutate(() => api.action(`/api/stock/bookings/${log.id}/undo`))}
              >
                Undo
              </button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
