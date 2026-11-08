import { nativeObjectUserfieldPresent } from "@/lib/native-userfield-values";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useMatch, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, request } from "@/lib/api";
import type { EntityRow } from "@/lib/entities";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { unitLabel } from "@/lib/format";
import { userfieldsQuery } from "@/lib/userfields";
import { useNativeLabelPrint } from "@/hooks/useNativeLabelPrint";
import { useModalDialog } from "@/hooks/useModalDialog";
import { fetchApiDocument } from "@/lib/open-document";
import { EntityManager } from "./EntityManager";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { GrocycodeActions } from "./GrocycodeActions";
import { NativeProductCodeActions } from "./NativeProductCodeActions";
import { UserfieldValue } from "./UserfieldValue";
import { ResolvedConversionsDialog } from "./ResolvedConversions";
import { useDialogState } from "@/hooks/useDialogState";
import { EmbeddedPageDialog, type EmbeddedPage } from "./EmbeddedPageDialog";

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
  const router = useRouter();
  const native = useMatch({ from: "/product/$productId", shouldThrow: false });
  const print = useNativeLabelPrint();
  const [embedded, setEmbedded] = useState<EmbeddedPage>();
  const nextEmbedded = useRef(0);
  const dialogs = useDialogState<Action>();
  const action = dialogs.state?.value;
  const setAction = dialogs.open;

  const close = () => {
    if (dialogs.state) dialogs.close(dialogs.state.id);
  };

  const [resolved, setResolved] = useState(false);
  const fields = useQuery(userfieldsQuery);

  const editorControl = (action: Action, label: ReactNode) => {
    if (!native)
      return (
        <button
          type="button"
          className={action.id === null ? "btn" : "btn btn-ghost"}
          disabled={disabled}
          onClick={() => setAction(action)}
        >
          {label}
        </button>
      );
    const id = String(action.id ?? "new");

    const href =
      (action.entity === "product_barcodes"
        ? router.buildLocation({
            to: "/productbarcodes/$barcodeId",
            params: { barcodeId: id },
            search: {},
          })
        : router.buildLocation({
            to: "/quantityunitconversion/$conversionId",
            params: { conversionId: id },
            search: {},
          })
      ).publicHref + `?embedded&product=${product.id}`;

    const dialogType = action.entity === "product_barcodes" ? "form" : "wider";

    return (
      <a
        className={`${action.id === null ? "btn" : "btn btn-ghost"} show-as-dialog-link`}
        href={href}
        aria-disabled={disabled || undefined}
        data-dialog-type={dialogType}
        onClick={(event) => {
          if (disabled) {
            event.preventDefault();

            return;
          }

          if (
            event.button !== 0 ||
            event.ctrlKey ||
            event.shiftKey ||
            event.metaKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          setEmbedded({ id: ++nextEmbedded.current, url: event.currentTarget.href, dialogType });
        }}
      >
        {label}
      </a>
    );
  };

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

  const nativeCode = native ? (
    <section key="native-grocycode" aria-label={t("Grocycode")}>
      <div className="section-heading">
        <h3
          title={t(
            "Grocycode is a unique referer to this %s in your Grocy instance - print it onto a label and scan it like any other barcode",
            t("Product"),
          )}
        >
          {t("Grocycode")}
        </h3>
      </div>
      <div className="product-code-preview">
        <CodePreview id={product.id} name={String(product.name ?? "")} native />
        <NativeProductCodeActions
          productId={product.id}
          onPrint={() => print(`/api/stock/products/${product.id}/printlabel`)}
        />
      </div>
    </section>
  ) : null;

  if (data.error || fields.error)
    return (
      <div className="product-related">
        {nativeCode}
        <ErrorBlock message={(data.error ?? fields.error)!.message} />
      </div>
    );

  if (!data.data || !fields.data)
    return (
      <div className="product-related">
        {nativeCode}
        <LoadingBlock label={t("Loading product details…")} />
      </div>
    );
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
            {editorControl({ entity: "product_barcodes", id: null }, t("Add barcode"))}
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
                          nativeTable={Boolean(native)}
                          field={field}
                          value={row.userfields?.[field.name] ?? null}
                          present={
                            !native || nativeObjectUserfieldPresent(row.userfields, field.name)
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <div className="actions">
                        {editorControl(
                          { entity: "product_barcodes", id: row.id },
                          <>
                            {t("Edit")}
                            <span className="sr-only"> {row.barcode}</span>
                          </>,
                        )}
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
          {!native ? (
            <div className="product-code-preview">
              <CodePreview id={product.id} name={String(product.name ?? "")} />
              <GrocycodeActions id={product.id} kind="product" name={String(product.name ?? "")} />
            </div>
          ) : null}
        </section>
      ) : null}
      {nativeCode}
      <section aria-label={t("Product specific QU conversions")}>
        <div className="section-heading">
          <h3>{t("Product specific QU conversions")}</h3>
          <div className="actions">
            {editorControl({ entity: "quantity_unit_conversions", id: null }, t("Add conversion"))}
            {native ? (
              <a
                className="btn btn-ghost show-as-dialog-link"
                data-dialog-type="wider"
                href={
                  router.buildLocation({ to: "/quantityunitconversionsresolved", search: {} })
                    .publicHref + `?embedded&product=${product.id}`
                }
                onClick={(event) => {
                  if (
                    event.button !== 0 ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.metaKey ||
                    event.altKey
                  )
                    return;
                  event.preventDefault();
                  setEmbedded({
                    id: ++nextEmbedded.current,
                    url: event.currentTarget.href,
                    dialogType: "wider",
                  });
                }}
              >
                {t("Show resolved conversions")}
              </a>
            ) : (
              <button
                type="button"
                className="btn btn-ghost"
                aria-haspopup="dialog"
                onClick={() => setResolved(true)}
              >
                {t("Show resolved conversions")}
              </button>
            )}
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
                      {editorControl(
                        { entity: "quantity_unit_conversions", id: row.id },
                        <>
                          {t("Edit")}
                          <span className="sr-only">
                            {" "}
                            {unitName(row.from_qu_id)} → {unitName(row.to_qu_id)}
                          </span>
                        </>,
                      )}
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
      {embedded ? (
        <EmbeddedPageDialog
          key={embedded.id}
          page={embedded}
          onClose={() => setEmbedded(undefined)}
        />
      ) : null}
      {action ? (
        action.remove ? (
          <DeleteRelation
            key={action.entity + action.id}
            action={action}
            onClose={close}
            onDeleted={deleted}
          />
        ) : (
          <RelationEditor
            key={action.entity + action.id}
            action={action}
            product={product}
            onClose={close}
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

        onClose();
      }}
    >
      <h2 id={title}>{t(label)}</h2>
      <p>{product.name}</p>
      <EntityManager
        entity={action.entity}
        fixed={{ product_id: product.id }}
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

        onClose();
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

function CodePreview({ id, name, native = false }: { id: number; name: string; native?: boolean }) {
  const { t } = useI18n();

  const [result, setResult] = useState<
    { id: number; source: string } | { id: number; error: Error }
  >();

  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    void fetchApiDocument(
      native ? `/product/${id}/grocycode?size=60` : `/api/v2/products/${id}/grocycode?size=60`,
      controller.signal,
    )
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
  }, [id, native]);

  return result?.id !== id ? (
    <LoadingBlock label={t("Loading Grocycode…")} />
  ) : "error" in result ? (
    <ErrorBlock message={result.error.message} />
  ) : (
    <img src={result.source} alt={t("%s Grocycode", name)} loading={native ? "lazy" : undefined} />
  );
}
