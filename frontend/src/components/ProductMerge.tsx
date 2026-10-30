import { useI18n } from "@/lib/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { productsQuery } from "@/hooks/queries";
import { ErrorBlock } from "./ErrorBlock";

type Props = {
  productId: number;
};

export function ProductMerge({ productId }: Props) {
  const { t: tr } = useI18n();

  const client = useQueryClient();
  const products = useQuery(productsQuery());
  const [removeId, setRemoveId] = useState("");

  const merge = useMutation({
    mutationFn: () => api.mergeProducts(productId, Number(removeId)),
    onSuccess: async () => {
      setRemoveId("");
      await client.invalidateQueries();
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (!removeId) return;
    merge.mutate();
  };

  const choices = (products.data ?? []).filter((p) => p.id !== productId);

  return (
    <section className="panel" aria-labelledby="merge-heading">
      <h2 className="panel-head" id="merge-heading">
        {tr("Merge products")}
      </h2>
      <div className="panel-body">
        <p className="field-hint">
          {tr(
            "Move stock and history from another product into this one, then remove the duplicate catalog entry.",
          )}
        </p>
        {merge.error ? <ErrorBlock message={merge.error.message} /> : null}
        <form className="inline-form" onSubmit={onSubmit}>
          <select
            value={removeId}
            onChange={(e) => setRemoveId(e.target.value)}
            required
            aria-label={tr("Product to merge into this one")}
          >
            <option value="">{tr("Select duplicate product")}</option>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-ghost" disabled={merge.isPending || !removeId}>
            {tr("Merge into this product")}
          </button>
        </form>
      </div>
    </section>
  );
}
