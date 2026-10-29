import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, request } from "@/lib/api";
import type { EntityRow } from "@/lib/entities";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { unitLabel } from "@/lib/format";
import { userfieldsQuery } from "@/lib/userfields";
import { useModalDialog } from "@/hooks/useModalDialog";
import { fetchApiDocument } from "@/lib/open-document";
import { EntityManager } from "./EntityManager";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { GrocycodeActions } from "./GrocycodeActions";
import { UserfieldValue } from "./UserfieldValue";
import { ResolvedConversionsDialog } from "./ResolvedConversions";

type Relation = "product_barcodes" | "quantity_unit_conversions";

type Action = { entity: Relation; id: number | null; remove?: boolean };

export function ProductRelatedData({
  row: product,
  pending: disabled,
  reload: onChanged,
  afterDelete: onDeleted,
}: {
  row: EntityRow;
  pending: boolean;
  reload: () => Promise<void>;
  afterDelete: () => Promise<void>;
}) {
  const { t, pluralIndex } = useI18n();
  const features = useFeatures();
  const preferences = usePreferences();
  const client = useQueryClient();
  const [action, setAction] = useState<Action>();
  const [resolved, setResolved] = useState(false);
  const fields = useQuery(userfieldsQuery);

  const data = useQuery({
    queryKey: ["product-related", product.id],
    queryFn: async () => {
      const scoped = (entity: string) =>
        request<EntityRow[]>(
          `/api/objects/${entity}?${new URLSearchParams({ "query[]": `product_id=${product.id}` })}`,
        );

      const [barcodes, conversions, units, stores] = await Promise.all([
        features.enabled("STOCK") ? scoped("product_barcodes") : [],
        scoped("quantity_unit_conversions"),
        api.objects("quantity_units"),
        features.enabled("STOCK_PRICE_TRACKING") ? api.objects("shopping_locations") : [],
      ]);

      return {
        barcodes: barcodes.sort((a, b) => String(a.barcode).localeCompare(String(b.barcode))),
        conversions,
        units,
        stores,
      };
    },
  });

  const changed = async () => {
    await client.invalidateQueries({ queryKey: ["product-related", product.id] });
    await onChanged();
  };

  const deleted = async () => {
    await client.invalidateQueries({ queryKey: ["product-related", product.id] });
    await onDeleted();
  };

  if (data.error || fields.error)
    return <ErrorBlock message={(data.error ?? fields.error)!.message} />;

  if (!data.data || !fields.data) return <LoadingBlock label={t("Loading product details…")} />;
  const unit = (id: EntityRow["qu_id"]) => data.data.units.find((row) => row.id === Number(id));

  const unitName = (id: EntityRow["qu_id"], count = 1) => {
    const value = unit(id);

    return value
      ? unitLabel(
          {
            name: String(value.name),
            name_plural: value.name_plural ?? null,
            plural_forms: value.plural_forms ?? null,
          },
          count,
          pluralIndex,
          false,
        )
      : id == null
        ? ""
        : `#${id}`;
  };

  const columns = fields.data.filter(
    (field) => field.entity === "product_barcodes" && field.show_as_column_in_tables === 1,
  );

  const conversionRows = [...data.data.conversions].sort((a, b) =>
    unitName(a.from_qu_id).localeCompare(unitName(b.from_qu_id)),
  );

  const conversionDescription = (row: EntityRow) =>
    t(
      "This means 1 %1$s is the same as %2$s %3$s",
      unitName(row.from_qu_id),
      preferences.formatAmount(Number(row.factor)),
      unitName(row.to_qu_id, Number(row.factor)),
    );

  return (
    <div className="product-related">
      {features.enabled("STOCK") ? (
        <section aria-label={t("Barcodes")}>
          <div className="section-heading">
            <h3>{t("Barcodes")}</h3>
            <button
              type="button"
              className="btn"
              disabled={disabled}
              onClick={() => setAction({ entity: "product_barcodes", id: null })}
            >
              {t("Add barcode")}
            </button>
          </div>
          <div className="table-scroll" tabIndex={0}>
            <table className="stock-table">
              <caption className="sr-only">{t("Barcodes")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("Barcode")}</th>
                  {features.enabled("STOCK_PRICE_TRACKING") ? (
                    <th scope="col">{t("Store")}</th>
                  ) : null}
                  <th scope="col">{t("Unit")}</th>
                  <th scope="col">{t("Amount")}</th>
                  <th scope="col">{t("Note")}</th>
                  {columns.map((field) => (
                    <th key={field.id} scope="col">
                      {field.caption}
                    </th>
                  ))}
                  <th scope="col">{t("Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {data.data.barcodes.map((row) => (
                  <tr key={row.id}>
                    <th scope="row" className="code">
                      {row.barcode}
                    </th>
                    {features.enabled("STOCK_PRICE_TRACKING") ? (
                      <td>
                        {String(
                          data.data.stores.find((store) => store.id === row.shopping_location_id)
                            ?.name ?? "",
                        )}
                      </td>
                    ) : null}
                    <td>{unitName(row.qu_id)}</td>
                    <td>
                      {row.amount == null ? "" : preferences.formatAmount(Number(row.amount))}
                    </td>
                    <td>{row.note}</td>
                    {columns.map((field) => (
                      <td key={field.id}>
                        <UserfieldValue
                          field={field}
                          value={row.userfields?.[field.name] ?? null}
                        />
                      </td>
                    ))}
                    <td>
                      <div className="actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={disabled}
                          onClick={() => setAction({ entity: "product_barcodes", id: row.id })}
                        >
                          {t("Edit")}
                          <span className="sr-only"> {row.barcode}</span>
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={disabled}
                          onClick={() =>
                            setAction({ entity: "product_barcodes", id: row.id, remove: true })
                          }
                        >
                          {t("Delete")}
                          <span className="sr-only"> {row.barcode}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.data.barcodes.length ? (
            <p className="empty-state">{t("No barcodes yet.")}</p>
          ) : null}
          <div className="product-code-preview">
            <CodePreview id={product.id} name={String(product.name ?? "")} />
            <GrocycodeActions id={product.id} kind="product" name={String(product.name ?? "")} />
          </div>
        </section>
      ) : null}
      <section aria-label={t("Product specific QU conversions")}>
        <div className="section-heading">
          <h3>{t("Product specific QU conversions")}</h3>
          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={disabled}
              onClick={() => setAction({ entity: "quantity_unit_conversions", id: null })}
            >
              {t("Add conversion")}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              aria-haspopup="dialog"
              onClick={() => setResolved(true)}
            >
              {t("Show resolved conversions")}
            </button>
          </div>
        </div>
        <div className="table-scroll" tabIndex={0}>
          <table className="stock-table">
            <caption className="sr-only">{t("Product specific QU conversions")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("From unit")}</th>
                <th scope="col">{t("To unit")}</th>
                <th scope="col">{t("Factor")}</th>
                <th scope="col">{t("Conversion")}</th>
                <th scope="col">{t("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {conversionRows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{unitName(row.from_qu_id)}</th>
                  <td>{unitName(row.to_qu_id)}</td>
                  <td>{preferences.formatAmount(Number(row.factor))}</td>
                  <td>{conversionDescription(row)}</td>
                  <td>
                    <div className="actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={disabled}
                        onClick={() =>
                          setAction({ entity: "quantity_unit_conversions", id: row.id })
                        }
                      >
                        {t("Edit")}
                        <span className="sr-only">
                          {" "}
                          {unitName(row.from_qu_id)} → {unitName(row.to_qu_id)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={disabled}
                        onClick={() =>
                          setAction({
                            entity: "quantity_unit_conversions",
                            id: row.id,
                            remove: true,
                          })
                        }
                      >
                        {t("Delete")}
                        <span className="sr-only">
                          {" "}
                          {unitName(row.from_qu_id)} → {unitName(row.to_qu_id)}
                        </span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!conversionRows.length ? (
          <p className="empty-state">{t("No product conversions yet.")}</p>
        ) : null}
      </section>
      {resolved ? (
        <ResolvedConversionsDialog product={product.id} onClose={() => setResolved(false)} />
      ) : null}
      {action ? (
        action.remove ? (
          <DeleteRelation
            key={action.entity + action.id}
            action={action}
            onClose={() => setAction(undefined)}
            onDeleted={deleted}
          />
        ) : (
          <RelationEditor
            key={action.entity + action.id}
            action={action}
            product={product}
            onClose={() => setAction(undefined)}
            onSaved={changed}
          />
        )
      ) : null}
    </div>
  );
}

function RelationEditor({
  action,
  product,
  onClose,
  onSaved,
}: {
  action: Action;
  product: EntityRow;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const title = useId();
  const [pending, setPending] = useState(false);

  const label =
    action.entity === "product_barcodes"
      ? action.id === null
        ? "Create Barcode"
        : "Edit Barcode"
      : action.id === null
        ? "Create quantity unit conversion"
        : "Edit quantity unit conversion";

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog shopping-list-dialog product-relation-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();

        if (!pending) onClose();
      }}
    >
      <h2 id={title}>{t(label)}</h2>
      <p>{product.name}</p>
      <EntityManager
        entity={action.entity}
        fixed={{ product_id: product.id }}
        onPendingChange={setPending}
        editor={{
          recordId: action.id,
          onCancel: onClose,
          onSaved: async () => {
            await onSaved();
            onClose();
          },
        }}
      />
    </dialog>
  );
}

function DeleteRelation({
  action,
  onClose,
  onDeleted,
}: {
  action: Action;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const title = useId();
  const removed = useRef(false);

  const remove = useMutation({
    mutationFn: async () => {
      if (!removed.current) {
        await api.deleteObject(action.entity, action.id!);
        removed.current = true;
      }

      await onDeleted();
    },
    onSuccess: onClose,
  });

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();

        if (!remove.isPending) onClose();
      }}
    >
      <h2 id={title}>
        {t(
          action.entity === "product_barcodes"
            ? "Are you sure you want to remove this barcode?"
            : "Are you sure you want to remove this conversion?",
        )}
      </h2>
      {remove.error ? <ErrorBlock message={remove.error.message} /> : null}
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          {t("Yes")}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={remove.isPending}
          onClick={onClose}
        >
          {t("No")}
        </button>
      </div>
    </dialog>
  );
}

function CodePreview({ id, name }: { id: number; name: string }) {
  const { t } = useI18n();

  const [result, setResult] = useState<
    { id: number; source: string } | { id: number; error: Error }
  >();

  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    void fetchApiDocument(`/api/v2/products/${id}/grocycode?size=60`, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setResult({ id, source: url });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setResult({ id, error });
      });

    return () => {
      controller.abort();

      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  return result?.id !== id ? (
    <LoadingBlock label={t("Loading Grocycode…")} />
  ) : "error" in result ? (
    <ErrorBlock message={result.error.message} />
  ) : (
    <img src={result.source} alt={t("%s Grocycode", name)} />
  );
}
