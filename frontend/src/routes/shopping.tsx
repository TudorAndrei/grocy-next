import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, queryKeys } from "@/lib/api";
import { useCatalog, useInvalidateStock } from "@/lib/catalog";
import { formatAmount } from "@/lib/format";
import { openApiDocument } from "@/lib/open-document";
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
  const [listId, setListId] = useState(1);

  const lists = useQuery({
    queryKey: queryKeys.objects("shopping_lists"),
    queryFn: () => api.objects("shopping_lists"),
  });

  const listKey = queryKeys.shopping(listId);
  const list = useQuery({ queryKey: listKey, queryFn: () => api.getShoppingList(listId) });
  const items = list.data?.items ?? [];
  const open = items.filter((item) => !item.done);
  const checked = items.filter((item) => item.done);

  const refresh = () => queryClient.invalidateQueries({ queryKey: listKey });

  const itemName = (item: ShoppingListItem) =>
    item.product_id != null ? catalog.productName(item.product_id) : (item.note ?? "Note");

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
    mutationFn: (item: ShoppingListItem) =>
      item.product_id != null
        ? api.removeShoppingProduct(item.product_id, item.amount, listId)
        : api.deleteObject("shopping_list", item.id),
    onSuccess: async (_data, item) => {
      await refresh();
      const productId = item.product_id;
      notify({
        message: `Removed ${itemName(item)}`,
        undo:
          productId != null
            ? async () => {
                await api.addShoppingProduct(productId, item.amount, item.note, listId);
                await refresh();
              }
            : undefined,
      });
    },
    onError,
  });

  const clear = useMutation({
    mutationFn: () => api.clearShoppingList(listId),
    onSuccess: async () => {
      await refresh();
      notify({ message: "Shopping list cleared" });
    },
    onError,
  });

  const addMissing = useMutation({
    mutationFn: () => api.addMissingToShoppingList(listId),
    onSuccess: async () => {
      await refresh();
      notify({ message: "Added every product below its minimum" });
    },
    onError,
  });

  const addDue = useMutation({
    mutationFn: (kind: "overdue" | "expired") =>
      kind === "overdue"
        ? api.addOverdueToShoppingList(listId)
        : api.addExpiredToShoppingList(listId),
    onSuccess: async (_data, kind) => {
      await refresh();
      notify({ message: `Added every ${kind} product` });
    },
    onError,
  });

  // Checked items become purchases; then the checked rows leave the list.
  const putAway = useMutation({
    mutationFn: async (done: ShoppingListItem[]) => {
      for (const item of done) {
        // Note-only rows have nothing to put in stock.
        if (item.product_id != null) await api.purchaseStock(item.product_id, item.amount);
      }

      await api.clearShoppingList(listId, true);

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
          <>
            {(lists.data?.length ?? 0) > 1 ? (
              <label className="select-field">
                <span className="sr-only">Shopping list</span>
                <select value={listId} onChange={(e) => setListId(Number(e.target.value))}>
                  {lists.data?.map((row) => (
                    <option key={row.id} value={row.id}>
                      {String(row.name ?? `List ${row.id}`)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
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
          </>
        }
      />

      {mode === "plan" ? (
        <div className="toolbar">
          <AddItemForm listId={listId} onAdded={refresh} />
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
              className="btn"
              disabled={addDue.isPending}
              onClick={() => addDue.mutate("overdue")}
            >
              Add overdue
            </button>
            <button
              type="button"
              className="btn"
              disabled={addDue.isPending}
              onClick={() => addDue.mutate("expired")}
            >
              Add expired
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
              Print
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => openApiDocument("/api/print/shoppinglist/thermal")}
            >
              Thermal print
            </button>
            <Link to="/labels" className="btn btn-ghost">
              Labels
            </Link>
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
      {list.isError ? <ErrorBlock message={list.error.message} /> : null}
      {list.isSuccess && items.length === 0 ? (
        <p className="empty-state">
          The list is empty. Add a product above, press ⌘K and type “list coffee”, or pull in
          everything below its minimum with Add missing.
        </p>
      ) : null}

      {items.length > 0 ? (
        <ul className="shop-list panel">
          {[...open, ...checked].map((item) => {
            const product = item.product_id != null ? catalog.product(item.product_id) : undefined;

            return (
              <li key={item.id} className="shop-item" data-done={item.done ? "true" : "false"}>
                <button
                  type="button"
                  className="shop-check"
                  role="checkbox"
                  aria-checked={item.done}
                  aria-label={`${itemName(item)} in the basket`}
                  onClick={() => toggle.mutate(item)}
                >
                  <span className="shop-box">{item.done ? <Icon name="check" /> : null}</span>
                  <span className="shop-name">
                    {itemName(item)}
                    <small>
                      {product
                        ? (catalog.location(product.location_id)?.name ?? "No location")
                        : "Note"}
                      {item.product_id != null && item.note ? ` · ${item.note}` : ""}
                    </small>
                  </span>
                  <span className="amount">
                    {item.product_id != null
                      ? catalog.amountText(item.product_id, item.amount)
                      : formatAmount(item.amount)}
                  </span>
                </button>
                {mode === "plan" ? (
                  <span className="row-actions">
                    {item.product_id != null ? (
                      <Link
                        to="/products/$productId"
                        params={{ productId: String(item.product_id) }}
                        className="btn btn-sm btn-ghost"
                      >
                        Product
                      </Link>
                    ) : null}
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

function AddItemForm({ listId, onAdded }: { listId: number; onAdded: () => Promise<void> }) {
  const catalog = useCatalog();
  const notify = useNotify();
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState("");

  const add = useMutation({
    mutationFn: async () => {
      if (productId) {
        await api.addShoppingProduct(Number(productId), Number(amount), note.trim(), listId);
      } else {
        await api.createObject("shopping_list", {
          shopping_list_id: listId,
          product_id: null,
          amount: Number(amount),
          note: note.trim(),
        });
      }
    },
    onSuccess: async () => {
      await onAdded();
      notify({
        message: `Added ${productId ? catalog.productName(Number(productId)) : note.trim()}`,
      });
      setAmount("1");
      setNote("");
      setProductId("");
    },
    onError: (err: Error) => notify({ message: err.message, tone: "error" }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();

    if ((!productId && !note.trim()) || !(Number(amount) > 0)) return;
    add.mutate();
  }

  const unit = productId ? catalog.stockUnitText(Number(productId), Number(amount) || 1) : "";

  return (
    <form className="add-form" onSubmit={onSubmit}>
      <label className="select-field grow">
        <span className="sr-only">Product</span>
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Note only (no product)</option>
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
          placeholder={productId ? "Note (optional)" : "Note"}
          required={!productId}
        />
      </label>
      <button
        type="submit"
        className="btn btn-primary"
        disabled={add.isPending || (!productId && !note.trim())}
      >
        <Icon name="plus" />
        Add
      </button>
    </form>
  );
}
