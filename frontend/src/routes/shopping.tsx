import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, request } from "@/lib/api";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
export const Route = createFileRoute("/shopping")({ component: ShoppingPage });
type Item = {
  id: number;
  product_id: number | null;
  amount: number;
  note: string | null;
  done: boolean;
};
function ShoppingPage() {
  const client = useQueryClient();
  const [listId, setListId] = useState(1);
  const [product, setProduct] = useState("");
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState("");
  const lists = useQuery({
    queryKey: ["objects", "shopping_lists"],
    queryFn: () => api.objects("shopping_lists"),
  });
  const products = useQuery({
    queryKey: ["products"],
    queryFn: api.listProducts,
  });
  const query = useQuery({
    queryKey: ["shopping", listId],
    queryFn: () =>
      request<{ name: string; items: Item[] }>(
        `/api/v2/shopping-lists/${listId}`,
      ),
    enabled: !!listId,
  });
  const change = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: async () => {
      await client.invalidateQueries();
    },
  });
  const add = (event: FormEvent) => {
    event.preventDefault();
    change.mutate(() =>
      api.createObject("shopping_list", {
        shopping_list_id: listId,
        product_id: product ? Number(product) : null,
        amount: Number(amount),
        note: note || null,
      }),
    );
  };
  const error = query.error || lists.error || products.error || change.error;
  return (
    <>
      <h1 className="page-title">Shopping list</h1>
      <p className="page-lead">
        Add products or notes. Mark each item when you buy it.
      </p>
      <div className="field">
        <label htmlFor="shopping-list">List</label>
        <select
          id="shopping-list"
          value={listId}
          onChange={(e) => setListId(Number(e.target.value))}
        >
          {lists.data?.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name}
            </option>
          ))}
        </select>
      </div>
      {error && <ErrorBlock message={error.message} />}
      {query.isPending && <LoadingBlock label="Loading shopping list..." />}
      <form onSubmit={add} className="panel panel-inner">
        <h2>Add an item</h2>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="shopping-product">Product</label>
            <select
              id="shopping-product"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
            >
              <option value="">Note only</option>
              {products.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="shopping-amount">Amount in stock units</label>
            <input
              id="shopping-amount"
              type="number"
              min="0.000001"
              step="any"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="shopping-note">Note</label>
            <input
              id="shopping-note"
              required={!product}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <button
          className="btn btn-primary"
          disabled={change.isPending || !listId}
        >
          Add item
        </button>
      </form>
      <div className="actions">
        <button
          className="btn btn-ghost"
          disabled={change.isPending}
          onClick={() =>
            change.mutate(() =>
              api.action("/api/stock/shoppinglist/add-missing-products", {
                list_id: listId,
              }),
            )
          }
        >
          Add low stock products
        </button>
        <button
          className="btn btn-ghost"
          disabled={change.isPending}
          onClick={() =>
            change.mutate(() =>
              api.action("/api/stock/shoppinglist/clear", {
                list_id: listId,
                done_only: true,
              }),
            )
          }
        >
          Clear purchased items
        </button>
        <button className="btn btn-ghost" onClick={() => window.print()}>
          Print list
        </button>
      </div>
      <ul className="product-list">
        {query.data?.items.map((item) => (
          <li className="product-row" key={item.id}>
            <label className="shopping-item">
              <input
                type="checkbox"
                checked={item.done}
                disabled={change.isPending}
                onChange={() =>
                  change.mutate(() =>
                    api.updateObject("shopping_list", item.id, {
                      done: item.done ? 0 : 1,
                    }),
                  )
                }
              />
              <span className={item.done ? "completed" : ""}>
                {item.amount}{" "}
                {products.data?.find((p) => p.id === item.product_id)?.name ??
                  item.note}
                {item.product_id && item.note ? ` (${item.note})` : ""}
              </span>
            </label>
            <button
              className="btn btn-ghost"
              disabled={change.isPending}
              onClick={() =>
                change.mutate(() => api.deleteObject("shopping_list", item.id))
              }
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {query.isSuccess && !query.data.items.length && (
        <p className="empty-state">The list is empty. Add an item above.</p>
      )}
    </>
  );
}
