import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, queryKeys } from "@/lib/api";
import { useCatalog, useInvalidateStock } from "@/lib/catalog";
import type { ShoppingList, ShoppingListItem } from "@/lib/types";
import { ErrorBlock } from "@/components/ErrorBlock";
import { Icon } from "@/components/Icon";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";
import { useNotify } from "@/components/Toaster";

export const Route = createFileRoute("/shopping")({
  component: ShoppingPage,
});

type Mode = "plan" | "shop";

function initialMode(): Mode {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches
    ? "shop"
    : "plan";
}

function ShoppingPage() {
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const notify = useNotify();
  const invalidateStock = useInvalidateStock();
  const [mode, setMode] = useState<Mode>(initialMode);

  const listKey = queryKeys.shopping(1);
  const list = useQuery({ queryKey: listKey, queryFn: () => api.getShoppingList(1) });
  const items = list.data?.items ?? [];
  const open = items.filter((item) => !item.done);
  const checked = items.filter((item) => item.done);

  const refresh = () => queryClient.invalidateQueries({ queryKey: listKey });
  const onError = (err: Error) => notify({ message: err.message, tone: "error" });

  const toggle = useMutation({
    mutationFn: (item: ShoppingListItem) => api.setShoppingItemDone(item.id, !item.done),
    onMutate: async (item) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<ShoppingList>(listKey);
      queryClient.setQueryData<ShoppingList>(listKey, (data) =>
        data
          ? {
              ...data,
              items: data.items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)),
            }
          : data,
      );
      return { previous };
    },
    onError: (err: Error, _item, context) => {
      if (context?.previous) queryClient.setQueryData(listKey, context.previous);
      onError(err);
    },
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: (item: ShoppingListItem) => api.removeShoppingProduct(item.product_id, item.amount),
    onSuccess: async (_data, item) => {
      await refresh();
      notify({
        message: `Removed ${catalog.productName(item.product_id)}`,
        undo: async () => {
          await api.addShoppingProduct(item.product_id, item.amount, item.note);
          await refresh();
        },
      });
    },
    onError,
  });

  const clear = useMutation({
    mutationFn: () => api.clearShoppingList(1),
    onSuccess: async () => {
      await refresh();
      notify({ message: "Shopping list cleared" });
    },
    onError,
  });

  const addMissing = useMutation({
    mutationFn: () => api.addMissingToShoppingList(1),
    onSuccess: async () => {
      await refresh();
      notify({ message: "Added every product below its minimum" });
    },
    onError,
  });

  // Checked items become purchases; then the checked rows leave the list.
  const putAway = useMutation({
    mutationFn: async (done: ShoppingListItem[]) => {
      for (const item of done) {
        await api.purchaseStock(item.product_id, item.amount);
      }
      await api.clearShoppingList(1, true);
      return done.length;
    },
    onSuccess: async (count) => {
      await Promise.all([refresh(), invalidateStock()]);
      notify({ message: `Booked ${count} ${count === 1 ? "purchase" : "purchases"} into stock` });
    },
    onError: async (err: Error) => {
      await Promise.all([refresh(), invalidateStock()]);
      onError(err);
    },
  });

  return (
    <div className="shopping" data-mode={mode}>
      <PageHeader
        title={list.data?.name ?? "Shopping list"}
        lead={
          list.isSuccess
            ? `${open.length} to buy${checked.length ? ` · ${checked.length} in the basket` : ""}`
            : "Build the list for the next run, then check items off in the shop."
        }
        actions={
          <div className="seg-group" role="group" aria-label="Mode">
            <button
              type="button"
              className="seg"
              aria-pressed={mode === "plan"}
              onClick={() => setMode("plan")}
            >
              Plan
            </button>
            <button
              type="button"
              className="seg"
              aria-pressed={mode === "shop"}
              onClick={() => setMode("shop")}
            >
              In the shop
            </button>
          </div>
        }
      />

      {mode === "plan" ? (
        <div className="toolbar">
          <AddItemForm onAdded={refresh} />
          <div className="toolbar-end">
            <button
              type="button"
              className="btn"
              disabled={addMissing.isPending}
              onClick={() => addMissing.mutate()}
            >
              Add missing
            </button>
            <button
              type="button"
              className="btn btn-danger-quiet"
              disabled={clear.isPending || items.length === 0}
              onClick={() => {
                if (window.confirm(`Remove all ${items.length} items from the list?`))
                  clear.mutate();
              }}
            >
              Clear list
            </button>
          </div>
        </div>
      ) : null}

      {list.isLoading ? <LoadingBlock label="Loading shopping list…" /> : null}
      {list.isError ? <ErrorBlock message={(list.error as Error).message} /> : null}
      {list.isSuccess && items.length === 0 ? (
        <p className="empty-state">
          The list is empty. Add a product above, press ⌘K and type “list coffee”, or pull in
          everything below its minimum with Add missing.
        </p>
      ) : null}

      {items.length > 0 ? (
        <ul className="shop-list panel">
          {[...open, ...checked].map((item) => {
            const product = catalog.product(item.product_id);
            return (
              <li key={item.id} className="shop-item" data-done={item.done ? "true" : "false"}>
                <button
                  type="button"
                  className="shop-check"
                  role="checkbox"
                  aria-checked={item.done}
                  aria-label={`${catalog.productName(item.product_id)} in the basket`}
                  onClick={() => toggle.mutate(item)}
                >
                  <span className="shop-box">{item.done ? <Icon name="check" /> : null}</span>
                  <span className="shop-name">
                    {catalog.productName(item.product_id)}
                    <small>
                      {catalog.location(product?.location_id)?.name ?? "No location"}
                      {item.note ? ` · ${item.note}` : ""}
                    </small>
                  </span>
                  <span className="amount">{catalog.amountText(item.product_id, item.amount)}</span>
                </button>
                {mode === "plan" ? (
                  <span className="row-actions">
                    <Link
                      to="/products/$productId"
                      params={{ productId: String(item.product_id) }}
                      className="btn btn-sm btn-ghost"
                    >
                      Product
                    </Link>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(item)}
                    >
                      Remove
                    </button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {checked.length > 0 ? (
        <div className="basket-bar">
          <span>
            <b>{checked.length}</b> in the basket
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={putAway.isPending}
            onClick={() => putAway.mutate(checked)}
          >
            {putAway.isPending ? "Booking…" : `Put ${checked.length} in stock`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AddItemForm({ onAdded }: { onAdded: () => Promise<unknown> }) {
  const catalog = useCatalog();
  const notify = useNotify();
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState("");

  const add = useMutation({
    mutationFn: () => api.addShoppingProduct(Number(productId), Number(amount), note.trim()),
    onSuccess: async () => {
      await onAdded();
      notify({ message: `Added ${catalog.productName(Number(productId))}` });
      setAmount("1");
      setNote("");
      setProductId("");
    },
    onError: (err: Error) => notify({ message: err.message, tone: "error" }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!productId || !(Number(amount) > 0)) return;
    add.mutate();
  }

  const unit = productId ? catalog.stockUnitText(Number(productId), Number(amount) || 1) : "";

  return (
    <form className="add-form" onSubmit={onSubmit}>
      <label className="select-field grow">
        <span className="sr-only">Product</span>
        <select value={productId} onChange={(e) => setProductId(e.target.value)} required>
          <option value="">Choose a product…</option>
          {catalog.products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      </label>
      <label className="amount-field">
        <span className="sr-only">Amount</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        {unit ? <span className="unit">{unit}</span> : null}
      </label>
      <label className="note-field">
        <span className="sr-only">Note</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
        />
      </label>
      <button type="submit" className="btn btn-primary" disabled={add.isPending || !productId}>
        <Icon name="plus" />
        Add
      </button>
    </form>
  );
}
