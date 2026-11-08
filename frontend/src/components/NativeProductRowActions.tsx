import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useGenericError } from "@/hooks/useGenericError";
import { useModalDialog } from "@/hooks/useModalDialog";
import { request } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { HouseholdRowMenu } from "./HouseholdRowMenu";

type Product = { id: number; name: string | null };

type Write = (method: "DELETE" | "POST", path: string, onReload: () => void) => void;

const ActionsContext = createContext<Write | null>(null);

/** Requests belong to the products document, including when table filtering removes a row. */
export function NativeProductActionsScope({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const genericError = useGenericError();
  const owner = useRef<AbortController>(undefined);

  useEffect(() => {
    const scope = new AbortController();
    owner.current = scope;

    return () => scope.abort();
  }, []);

  const write: Write = (method, path, onReload) => {
    const signal = owner.current?.signal;

    if (!signal || signal.aborted) return;
    void (async () => {
      try {
        await request(path, { method, body: "{}", signal });
      } catch (error) {
        if (!signal.aborted) {
          if (method === "DELETE") console.error(error);
          else
            genericError(
              "Error while merging",
              error instanceof Error ? error : new Error(String(error)),
            );
        }

        return;
      } finally {
        for (const queryKey of [
          ["native-products"],
          ["products"],
          ["objects"],
          ["stock"],
          ["shopping"],
          ["product-overview"],
          ["product-related"],
          ["product-barcode-form"],
          ["content", "products"],
          ["recipes"],
          ["recipe-view"],
          ["recipe-overview"],
          ["recipe-fulfillment"],
          ["recipe-form"],
          ["recipe-ingredient-editor"],
          ["mealplan-calendar"],
          ["native-calendar"],
          ["calendar"],
        ])
          void client.invalidateQueries({ queryKey, refetchType: "none" });
      }

      if (!signal.aborted) onReload();
    })();
  };

  return <ActionsContext.Provider value={write}>{children}</ActionsContext.Provider>;
}

export function NativeProductRowActions({
  product,
  products,
  onReload,
}: {
  product: Product;
  products: readonly Product[];
  onReload: () => void;
}) {
  const { t } = useI18n();
  const write = useContext(ActionsContext);
  const [deleting, setDeleting] = useState(false);
  const [merging, setMerging] = useState(false);
  const [keep, setKeep] = useState("");
  const [remove, setRemove] = useState("");

  if (!write) throw new Error("Native product actions require their page scope");

  return (
    <div className="native-product-row-actions">
      <Link
        to="/product/$productId"
        params={{ productId: String(product.id) }}
        className="btn btn-ghost btn-sm"
        aria-label={t("Edit this item")}
      >
        {t("Edit")}
      </Link>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-label={t("Delete this item")}
        onClick={() => setDeleting(true)}
      >
        {t("Delete")}
      </button>
      <HouseholdRowMenu label={t("Actions for %s", product.name ?? "")}>
        <Link
          role="menuitem"
          to="/product/$productId"
          params={{ productId: "new" }}
          search={{ "copy-of": product.id }}
        >
          {t("Copy")}
        </Link>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setKeep(String(product.id));
            setRemove("");
            setMerging(true);
          }}
        >
          {t("Merge")}
        </button>
      </HouseholdRowMenu>
      {deleting ? (
        <ProductDeleteDialog
          product={product}
          onClose={() => setDeleting(false)}
          onConfirm={() => {
            write("DELETE", `/api/objects/products/${product.id}`, onReload);
            setDeleting(false);
          }}
        />
      ) : null}
      {merging ? (
        <ProductMergeDialog
          products={products}
          keep={keep}
          remove={remove}
          onKeep={setKeep}
          onRemove={setRemove}
          onClose={() => setMerging(false)}
          onSubmit={() => {
            write("POST", `/api/stock/products/${keep}/merge/${remove}`, onReload);
          }}
        />
      ) : null}
    </div>
  );
}

function ProductDeleteDialog({
  product,
  onClose,
  onConfirm,
}: {
  product: Product;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const accept = useRef<HTMLButtonElement>(null);
  const closed = useRef(false);
  useEffect(() => accept.current?.focus(), []);

  const dismiss = () => {
    if (closed.current) return;
    closed.current = true;
    onClose();
  };

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog native-product-delete"
      aria-label={t("Delete this item")}
      onClose={(event) => {
        if (!event.currentTarget.open) dismiss();
      }}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <p>{t('Are you sure you want to delete product "%s"?', product.name ?? "")}</p>
      <p>
        {t(
          "This also removes any stock amount, the journal and all other references of this product - consider disabling it instead, if you want to keep that and just hide the product.",
        )}
      </p>
      <div className="actions">
        <button
          ref={accept}
          type="button"
          className="btn btn-primary"
          onClick={() => {
            if (closed.current) return;
            closed.current = true;
            onConfirm();
          }}
        >
          {t("Yes")}
        </button>
        <button type="button" className="btn" onClick={dismiss}>
          {t("No")}
        </button>
      </div>
    </dialog>
  );
}

function ProductMergeDialog({
  products,
  keep,
  remove,
  onKeep,
  onRemove,
  onClose,
  onSubmit,
}: {
  products: readonly Product[];
  keep: string;
  remove: string;
  onKeep: (value: string) => void;
  onRemove: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const form = useRef<HTMLFormElement>(null);
  const closed = useRef(false);

  const dismiss = () => {
    if (closed.current) return;
    closed.current = true;
    onClose();
  };

  const submit = () => {
    if (form.current?.reportValidity()) onSubmit();
  };

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog native-product-merge"
      aria-label={t("Merge products")}
      onClose={(event) => {
        if (!event.currentTarget.open) dismiss();
      }}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <h2>{t("Merge products")}</h2>
      <form ref={form} noValidate onSubmit={(event) => event.preventDefault()}>
        <label className="field" title={t("After merging, this product will be kept")}>
          {t("Product to keep")}
          <select required value={keep} onChange={(event) => onKeep(event.target.value)}>
            <option value="" />
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <label
          className="field"
          title={t(
            "After merging, all occurences of this product will be replaced by the kept product (means this product will not exist anymore)",
          )}
        >
          {t("Product to remove")}
          <select required value={remove} onChange={(event) => onRemove(event.target.value)}>
            <option value="" />
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <div className="actions">
          <button type="button" className="btn" onClick={dismiss}>
            {t("Cancel")}
          </button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            {t("OK")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
