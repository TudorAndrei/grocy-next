import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { api, queryKeys } from "@/lib/api";
import { formatAmount } from "@/lib/format";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/shopping")({
  component: ShoppingPage,
});

function ShoppingPage() {
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("1");
  const [feedback, setFeedback] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: queryKeys.shopping(1),
    queryFn: () => api.getShoppingList(1),
  });
  const productsQuery = useQuery({
    queryKey: queryKeys.products,
    queryFn: () => api.listProducts(),
  });

  const productNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const product of productsQuery.data ?? []) {
      map.set(product.id, product.name);
    }
    return map;
  }, [productsQuery.data]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.shopping(1) });
  };

  const addItem = useMutation({
    mutationFn: () => api.addShoppingProduct(Number(productId), Number(amount)),
    onSuccess: async () => {
      setFeedback("Added to list.");
      setAmount("1");
      await invalidate();
    },
    onError: (err: Error) => setFeedback(err.message),
  });

  const removeItem = useMutation({
    mutationFn: ({ id, qty }: { id: number; qty: number }) =>
      api.removeShoppingProduct(id, qty),
    onSuccess: async () => {
      await invalidate();
    },
  });

  const clearList = useMutation({
    mutationFn: () => api.clearShoppingList(1),
    onSuccess: async () => {
      setFeedback("List cleared.");
      await invalidate();
    },
    onError: (err: Error) => setFeedback(err.message),
  });

  const addMissing = useMutation({
    mutationFn: () => api.addMissingToShoppingList(1),
    onSuccess: async () => {
      setFeedback("Missing products added.");
      await invalidate();
    },
    onError: (err: Error) => setFeedback(err.message),
  });

  function onAdd(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);
    if (!productId) {
      setFeedback("Choose a product.");
      return;
    }
    addItem.mutate();
  }

  const items = listQuery.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={listQuery.data?.name ?? "Shopping list"}
        lead="Build the list for the next run, including products already below minimum."
        actions={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={addMissing.isPending}
              onClick={() => {
                setFeedback(null);
                addMissing.mutate();
              }}
            >
              Add missing
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={clearList.isPending || items.length === 0}
              onClick={() => {
                setFeedback(null);
                clearList.mutate();
              }}
            >
              Clear
            </button>
          </>
        }
      />

      <section className="panel" style={{ marginBottom: "1.1rem" }}>
        <div className="panel-inner">
          <h2 className="panel-title">Add item</h2>
          <form className="inline-form" onSubmit={onAdd}>
            <label className="sr-only" htmlFor="shop-product">
              Product
            </label>
            <select
              id="shop-product"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              style={{ flex: "1 1 14rem" }}
            >
              <option value="">Select product…</option>
              {(productsQuery.data ?? []).map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="shop-amount">
              Amount
            </label>
            <input
              id="shop-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              style={{ width: "5.5rem" }}
            />
            <button type="submit" className="btn btn-primary" disabled={addItem.isPending}>
              {addItem.isPending ? "Adding…" : "Add"}
            </button>
          </form>
          {feedback ? (
            <p className="muted" style={{ margin: "0.75rem 0 0" }} role="status">
              {feedback}
            </p>
          ) : null}
        </div>
      </section>

      {listQuery.isLoading ? <LoadingBlock label="Loading shopping list…" /> : null}
      {listQuery.isError ? (
        <ErrorBlock
          message={
            listQuery.error instanceof Error
              ? listQuery.error.message
              : "Could not load shopping list."
          }
        />
      ) : null}

      {listQuery.isSuccess && items.length === 0 ? (
        <p className="empty-state">List is empty. Add a product or pull in missing stock.</p>
      ) : null}

      {listQuery.isSuccess && items.length > 0 ? (
        <section className="panel">
          <div className="panel-inner" style={{ padding: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Amount</th>
                  <th>Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link
                        to="/products/$productId"
                        params={{ productId: String(item.product_id) }}
                        className="row-link"
                      >
                        {productNames.get(item.product_id) ?? `Product #${item.product_id}`}
                      </Link>
                    </td>
                    <td className="amount-cell">{formatAmount(item.amount)}</td>
                    <td className="muted">{item.note || "—"}</td>
                    <td>
                      <div className="actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={removeItem.isPending}
                          onClick={() =>
                            removeItem.mutate({
                              id: item.product_id,
                              qty: item.amount,
                            })
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
