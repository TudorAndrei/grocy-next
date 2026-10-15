import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, request } from "@/lib/api";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
type Entry = {
  id: number;
  amount: number;
  location_id: number;
  best_before_date: string | null;
  price: number | null;
  open: number;
};
export function StockActions({ productId }: { productId: number }) {
  const client = useQueryClient();
  const [kind, setKind] = useState("add");
  const [amount, setAmount] = useState("1");
  const [bestBefore, setBestBefore] = useState("");
  const [price, setPrice] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [editEntry, setEditEntry] = useState<Entry | null>(null);
  const [entryAmount, setEntryAmount] = useState("");
  const [entryExpiry, setEntryExpiry] = useState("");
  const stock = useQuery({
    queryKey: ["stock", productId],
    queryFn: () => api.getStockProduct(productId),
  });
  const locations = useQuery({
    queryKey: ["objects", "locations"],
    queryFn: () => api.objects("locations"),
  });
  const entries = useQuery({
    queryKey: ["stock-entries", productId],
    queryFn: () => request<Entry[]>(`/api/stock/products/${productId}/entries`),
  });
  const logs = useQuery({
    queryKey: ["stock-log", productId],
    queryFn: () =>
      request<
        Array<{
          id: number;
          amount: number;
          transaction_type: string;
          undone: number;
        }>
      >(
        `/api/objects/stock_log?query[]=product_id=${productId}&order=id:desc&limit=12`,
      ),
  });
  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: async () => {
      setEditEntry(null);
      await client.invalidateQueries();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body: Record<string, unknown> =
      kind === "inventory"
        ? { new_amount: Number(amount) }
        : { amount: Number(amount) };
    if (kind === "transfer") {
      body.location_id_from = Number(from);
      body.location_id_to = Number(to);
    } else if (from) body.location_id = Number(from);
    if (bestBefore && (kind === "add" || kind === "inventory"))
      body.best_before_date = bestBefore;
    if (price && kind === "add") body.price = Number(price);
    action.mutate(() =>
      api.action(`/api/stock/products/${productId}/${kind}`, body),
    );
  };
  const error =
    stock.error ||
    locations.error ||
    entries.error ||
    logs.error ||
    action.error;
  const names = (id: number) =>
    locations.data?.find((l) => l.id === id)?.name ?? `Location #${id}`;
  return (
    <section className="panel panel-inner">
      <h2>Stock</h2>
      {stock.isPending && <LoadingBlock label="Loading stock..." />}
      {stock.data && (
        <p>
          On hand {stock.data.stock_amount ?? 0}. Opened{" "}
          {stock.data.stock_amount_opened ?? 0}.
        </p>
      )}
      {error && <ErrorBlock message={error.message} />}
      {action.isSuccess && <p role="status">Stock updated.</p>}
      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="stock-action">Action</label>
            <select
              id="stock-action"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                action.reset();
              }}
            >
              <option value="add">Purchase</option>
              <option value="consume">Consume</option>
              <option value="open">Mark opened</option>
              <option value="transfer">Transfer</option>
              <option value="inventory">Count stock</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="stock-amount">
              {kind === "inventory"
                ? "New stock count"
                : "Amount in stock units"}
            </label>
            <input
              id="stock-amount"
              type="number"
              step="any"
              min={kind === "inventory" ? "0" : "0.000001"}
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          {kind !== "open" && (
            <div className="field">
              <label htmlFor="stock-from">
                {kind === "transfer" ? "From location" : "Location"}
              </label>
              <select
                id="stock-from"
                required={kind === "transfer"}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              >
                <option value="">
                  {kind === "add" ? "Product default" : "All locations"}
                </option>
                {locations.data?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {kind === "transfer" && (
            <div className="field">
              <label htmlFor="stock-to">To location</label>
              <select
                id="stock-to"
                required
                value={to}
                onChange={(e) => setTo(e.target.value)}
              >
                <option value="">Select location</option>
                {locations.data?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {(kind === "add" || kind === "inventory") && (
            <div className="field">
              <label htmlFor="stock-expiry">Best before date</label>
              <input
                id="stock-expiry"
                type="date"
                value={bestBefore}
                onChange={(e) => setBestBefore(e.target.value)}
              />
            </div>
          )}
          {kind === "add" && (
            <div className="field">
              <label htmlFor="stock-price">Price per stock unit</label>
              <input
                id="stock-price"
                type="number"
                min="0"
                step="any"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          )}
        </div>
        <button className="btn btn-primary" disabled={action.isPending}>
          Save stock action
        </button>
      </form>
      <h3>Stock entries</h3>
      <ul className="product-list">
        {entries.data?.map((entry) => (
          <li className="product-row" key={entry.id}>
            <span>
              {entry.amount} at {names(entry.location_id)}
              {entry.open ? ", opened" : ""}
              {entry.best_before_date
                ? `, best before ${entry.best_before_date}`
                : ""}
            </span>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setEditEntry(entry);
                setEntryAmount(String(entry.amount));
                setEntryExpiry(entry.best_before_date ?? "");
              }}
            >
              Edit entry
            </button>
          </li>
        ))}
      </ul>
      {editEntry && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            action.mutate(() =>
              request(`/api/stock/entry/${editEntry.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  amount: Number(entryAmount),
                  best_before_date: entryExpiry || null,
                }),
              }),
            );
          }}
        >
          <div className="form-grid">
            <div className="field">
              <label htmlFor="entry-amount">Entry amount</label>
              <input
                id="entry-amount"
                type="number"
                min="0"
                step="any"
                required
                value={entryAmount}
                onChange={(e) => setEntryAmount(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="entry-expiry">Entry best before date</label>
              <input
                id="entry-expiry"
                type="date"
                value={entryExpiry}
                onChange={(e) => setEntryExpiry(e.target.value)}
              />
            </div>
          </div>
          <div className="actions">
            <button className="btn btn-primary" disabled={action.isPending}>
              Save entry
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setEditEntry(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <h3>Recent stock bookings</h3>
      <ul className="product-list">
        {logs.data?.map((log) => (
          <li className="product-row" key={log.id}>
            <span>
              {log.transaction_type}: {log.amount}
              {log.undone ? " (undone)" : ""}
            </span>
            {!log.undone && (
              <button
                className="btn btn-ghost"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate(() =>
                    api.action(`/api/stock/bookings/${log.id}/undo`),
                  )
                }
              >
                Undo booking
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
