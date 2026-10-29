import { useEffect, useEffectEvent, useId, useRef, useState, type FormEvent } from "react";
import moment from "moment/min/moment-with-locales.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userSettingsQuery } from "@/hooks/queries";
import { useModalDialog } from "@/hooks/useModalDialog";
import { api, request } from "@/lib/api";
import { useInvalidateStock } from "@/lib/catalog";
import { useI18n } from "@/lib/i18n";
import { unitLabel } from "@/lib/format";
import { usePreferences } from "@/lib/preferences";
import type { Booking } from "@/lib/types";
import type { JsonObject } from "@/lib/json";
import { tableText, tableAttribute } from "@/lib/native-table-cell";
import {
  getTransferCatalog,
  getTransferDetails,
  getTransferEntries,
  getTransferSelection,
  transferUnits,
  type TransferCatalog,
  type TransferEntry,
  type TransferOptions,
  type TransferSelection,
} from "@/lib/transfer";
import { ProductPicker, type ProductCode } from "./ProductPicker";
import { ProductCard } from "./ProductOverview";
import { NumberPicker } from "./NumberPicker";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { useNotify } from "./Toaster";

type Props = {
  options: TransferOptions;
  onClose?: () => void;
  onChanged?: (productId: number) => Promise<void>;
  onPendingChange?: (pending: boolean) => void;
  onOptionsChange?: (options: TransferOptions) => void;
};

export function TransferDialog(props: Omit<Props, "onPendingChange">) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const title = useId();
  const [pending, setPending] = useState(false);

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog transfer-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!pending) props.onClose?.();
      }}
    >
      <h2 id={title}>{t("Transfer")}</h2>
      <TransferForm {...props} onPendingChange={setPending} />
    </dialog>
  );
}

export function TransferForm(props: Props) {
  const { t } = useI18n();
  const settings = useQuery(userSettingsQuery());

  const catalog = useQuery({
    queryKey: ["stock", "transfer-editor"],
    queryFn: ({ signal }) => getTransferCatalog(signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  if (catalog.isSuccess && catalog.isFetchedAfterMount && settings.isSuccess)
    return <TransferFields {...props} catalog={catalog.data} />;

  return (
    <>
      {catalog.isPending || catalog.isFetching || settings.isPending ? (
        <LoadingBlock label={t("Loading…")} />
      ) : null}
      {catalog.error || settings.error ? (
        <>
          <ErrorBlock message={(catalog.error || settings.error)!.message} />
          <button
            type="button"
            className="btn"
            onClick={() => void Promise.all([catalog.refetch(), settings.refetch()])}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {props.onClose ? (
        <button type="button" className="btn" onClick={props.onClose}>
          {t("Cancel")}
        </button>
      ) : null}
    </>
  );
}

function TransferFields({
  catalog,
  options: initialOptions,
  onClose,
  onChanged,
  onPendingChange,
  onOptionsChange,
}: Props & { catalog: TransferCatalog }) {
  const { t, pluralIndex } = useI18n();
  const preferences = usePreferences();
  const client = useQueryClient();
  const invalidate = useInvalidateStock();
  const notify = useNotify();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const productField = useRef<HTMLDivElement>(null);
  const initialAmountConverted = useRef(false);
  const read = useRef<AbortController>(undefined);
  const entryRead = useRef<AbortController>(undefined);
  const selectionVersion = useRef(0);
  const sourceVersion = useRef(0);
  const [options, setOptions] = useState(initialOptions);
  const prefillName = options["product-name"];

  const namedProduct =
    prefillName === undefined
      ? undefined
      : (catalog.products.find((row) =>
          (
            catalog.barcodes
              .find((barcode) => barcode.product_id === row.id)
              ?.barcodes?.toLowerCase() ?? ""
          ).includes(prefillName),
        ) ?? catalog.products.find((row) => row.name.includes(prefillName)));

  const initialProduct =
    options.product === undefined
      ? namedProduct
      : catalog.products.find((row) => String(row.id) === options.product);

  const [productId, setProductId] = useState(initialProduct ? String(initialProduct.id) : "");
  const [selection, setSelection] = useState<TransferSelection>();
  const [code, setCode] = useState<ProductCode>();
  const [amount, setAmount] = useState(String(preferences.transferAmount));
  const [amountCalculated, setAmountCalculated] = useState(false);
  const [unitId, setUnitId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [specific, setSpecific] = useState(false);
  const [stockId, setStockId] = useState("");
  const [entries, setEntries] = useState<TransferEntry[]>([]);
  const [maximum, setMaximum] = useState<string>();
  const [pickerBusy, setPickerBusy] = useState(false);
  const [finishedEmbedded, setFinishedEmbedded] = useState(false);
  const [error, setError] = useState<{ message: string; retry?: "product" | "source" }>();
  const [toError, setToError] = useState("");

  const [barcodeToLink, setBarcodeToLink] = useState(
    options.flow === "InplaceAddBarcodeToExistingProduct" ? options.barcode : undefined,
  );

  const [cardProduct, setCardProduct] = useState<number | undefined>(initialProduct?.id);
  const [expanded, setExpanded] = useState(false);

  const units = selection
    ? transferUnits(
        catalog,
        String(selection.details.product.id),
        selection.details.quantity_unit_stock.id,
      )
    : [];

  const unit = units.find((row) => String(row.id) === unitId);
  const factor = unit?.factor ?? NaN;
  const precision = preferences.amountPrecision;
  const minimum = precision > 0 ? 10 ** -precision : 1;

  const postedAmount = !amountCalculated
    ? "NaN"
    : (Number(amount) / factor).toFixed(Math.max(1, precision)).replace(/0*$/g, "");

  const forcedStock =
    code?.stockId ?? (options.embedded !== undefined ? options.stockId : undefined);

  const readEntries = useMutation({
    mutationFn: async (vars: {
      product: string;
      from: string;
      forced?: string;
      factor: number;
      version: number;
      signal: AbortSignal;
      rebuild: boolean;
    }) => ({ rows: await getTransferEntries(vars.product, vars.signal), vars }),
    onSuccess: ({ rows, vars }) => {
      if (vars.version !== sourceVersion.current || vars.signal.aborted) return;
      const located = rows.filter((row) => String(row.location_id) === vars.from);

      if (vars.rebuild) {
        const seen = new Set<string>();

        const first = located.filter((row) => {
          if (seen.has(row.stock_id)) return false;
          seen.add(row.stock_id);

          return true;
        });

        setEntries(first);
        setStockId(first.some((row) => row.stock_id === vars.forced) ? vars.forced! : "");
      }

      setMaximum(
        (located.reduce((sum, row) => sum + row.amount, 0) * vars.factor).toFixed(precision),
      );
    },
    onError: (reason: Error, vars) => {
      if (vars.version === sourceVersion.current && !vars.signal.aborted)
        setError({ message: reason.message, retry: "source" });
    },
  });

  function refreshSource(
    value: string,
    {
      data = selection,
      factor: nextFactor = factor,
      forced = forcedStock,
      rebuild = true,
      recheck = true,
    }: {
      data?: TransferSelection;
      factor?: number;
      forced?: string;
      rebuild?: boolean;
      recheck?: boolean;
    } = {},
  ) {
    entryRead.current?.abort();
    const version = ++sourceVersion.current;

    if (rebuild) {
      setEntries([]);
      setStockId("");

      if (recheck && forced !== undefined) setSpecific(true);
    }

    if (!value || !data) return;
    entryRead.current = new AbortController();
    readEntries.mutate({
      product: String(data.details.product.id),
      from: value,
      forced,
      factor: nextFactor,
      version,
      signal: entryRead.current.signal,
      rebuild,
    });
  }

  const load = useMutation({
    mutationFn: async (vars: {
      product: string;
      code?: ProductCode;
      version: number;
      signal: AbortSignal;
    }) => ({ data: await getTransferSelection(vars.product, vars.signal, vars.code), vars }),
    onSuccess: ({ data, vars }) => {
      if (vars.version !== selectionVersion.current || vars.signal.aborted) return;

      if (!initialAmountConverted.current) {
        initialAmountConverted.current = true;
        setAmount("");
        setAmountCalculated(false);
      } else setAmountCalculated(true);

      if (data.details.product.enable_tare_weight_handling === 1) {
        setProductId("");
        setSelection(undefined);
        setError({
          message: t("Products with tare weight enabled are currently not supported for transfer"),
        });
        requestAnimationFrame(() => productField.current?.querySelector("input")?.focus());

        return;
      }

      setSelection(data);

      let source =
        data.locations.find((row) => row.location_id === data.details.location?.id)?.location_id ??
        data.locations.at(-1)?.location_id;

      if (options.locationId !== undefined)
        source = data.locations.find(
          (row) => String(row.location_id) === options.locationId,
        )?.location_id;

      const value = source === undefined ? "" : String(source);

      // The native stock-code lookup sets the source without a change event.
      // Stock choices and their limit still come from the location callback.
      const displayedSource =
        data.stockLocation === undefined
          ? source
          : data.locations.find((row) => row.location_id === data.stockLocation)?.location_id;

      setFrom(displayedSource === undefined ? "" : String(displayedSource));
      const nextUnits = transferUnits(catalog, vars.product, data.details.quantity_unit_stock.id);
      const requestedUnit = data.barcode?.qu_id ?? data.details.quantity_unit_stock.id;
      const nextUnit = nextUnits.find((row) => row.id === requestedUnit);
      setUnitId(nextUnit ? String(nextUnit.id) : "");

      if (data.barcode) setAmountCalculated(true);

      if (data.barcode?.amount != null) setAmount(String(data.barcode.amount));

      const forced =
        vars.code?.stockId ?? (options.embedded !== undefined ? options.stockId : undefined);

      refreshSource(value, { data, factor: nextUnit?.factor ?? NaN, forced });
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLInputElement>(`[id="${id}-amount"]`)?.focus(),
      );
    },
    onError: (reason: Error, vars) => {
      if (vars.version === selectionVersion.current && !vars.signal.aborted)
        setError({ message: reason.message, retry: "product" });
    },
  });

  function selectProduct(value: string, nextCode?: ProductCode) {
    if (value === productId && !nextCode && (selection || load.isPending)) return;
    read.current?.abort();
    entryRead.current?.abort();
    const version = ++selectionVersion.current;
    sourceVersion.current++;
    setProductId(value);
    setCode(nextCode);
    setSelection(undefined);
    setTo("");
    setToError("");
    setFrom("");
    setEntries([]);
    setStockId("");
    setError(undefined);

    if (options.stockId === undefined) setSpecific(false);

    if (!value) return;
    setCardProduct(Number(value));
    read.current = new AbortController();
    load.mutate({ product: value, code: nextCode, version, signal: read.current.signal });
  }

  const start = useEffectEvent(() => {
    if (!initialProduct) return;
    read.current = new AbortController();
    load.mutate({
      product: String(initialProduct.id),
      version: ++selectionVersion.current,
      signal: read.current.signal,
    });
  });

  useEffect(() => {
    start();

    return () => {
      read.current?.abort();
      entryRead.current?.abort();
    };
  }, []);

  async function changed(product: number) {
    await invalidate();
    await client.invalidateQueries({ queryKey: ["product-overview", product] });
    await onChanged?.(product);
  }

  const save = useMutation({
    mutationFn: async (vars: {
      product: string;
      body: JsonObject;
      source: string;
      destination: string;
      sourceFreezer: number;
      destinationFreezer: number;
    }) => {
      const details = await getTransferDetails(vars.product);

      const bookings = await request<Booking[]>(`/api/stock/products/${vars.product}/transfer`, {
        method: "POST",
        body: JSON.stringify(vars.body),
      });

      let barcodeError: string | undefined;

      if (barcodeToLink !== undefined) {
        try {
          await api.action("/api/objects/product_barcodes", {
            barcode: barcodeToLink,
            product_id: vars.product,
          });
        } catch (reason) {
          barcodeError = reason instanceof Error ? reason.message : String(reason);
        }
      }

      return { details, bookings, barcodeError, vars };
    },
    onSuccess: async ({ details, bookings, barcodeError, vars }) => {
      if (options.embedded !== undefined && !barcodeError) setFinishedEmbedded(true);
      const posted = Math.abs(Number(vars.body.amount));

      const message = t(
        "Transfered %1$s of %2$s from %3$s to %4$s",
        `${posted} ${unitLabel({ ...details.quantity_unit_stock, plural_forms: catalog.units.find((row) => row.name === details.quantity_unit_stock.name)?.plural_forms }, posted, pluralIndex, false)}`,
        details.product.name,
        vars.source,
        vars.destination,
      );

      const transaction = bookings[0]?.transaction_id;

      if (options.embedded !== undefined && window.parent !== window) {
        const undo = transaction
          ? `<br><a class="btn btn-secondary btn-sm mt-2" href="#" onclick="UndoStockTransaction(${tableAttribute(JSON.stringify(transaction))})"><i class="fa-solid fa-undo"></i> ${tableText(t("Undo"))}</a>`
          : "";

        window.top?.postMessage(
          {
            Message: "BroadcastMessage",
            Payload: { Message: "ProductChanged", Payload: vars.product },
          },
          window.location.origin,
        );
        window.parent.postMessage(
          { Message: "ShowSuccessMessage", Payload: tableText(message) + undo },
          window.location.origin,
        );
        window.parent.postMessage(
          { Message: "CloseLastModal", Payload: null },
          window.location.origin,
        );
      }

      notify({
        message,
        undo: transaction
          ? async () => {
              await api.undoTransaction(transaction);
              await changed(details.product.id);
            }
          : undefined,
      });

      if (barcodeError) notify({ message: barcodeError, tone: "error" });
      else setBarcodeToLink(undefined);

      if (!barcodeError && options.flow !== undefined) {
        const next: TransferOptions =
          options.flow === "InplaceAddBarcodeToExistingProduct" ? {} : { ...options };

        delete next.flow;
        delete next.barcode;
        delete next["product-name"];
        setOptions(next);
        onOptionsChange?.(next);
      }

      if (options.embedded === undefined) {
        if (vars.sourceFreezer === 0 && vars.destinationFreezer === 1) {
          notify({ message: t("Frozen") });

          if (details.product.should_not_be_frozen)
            notify({ message: t("This product shouldn't be frozen"), tone: "error" });
        }

        if (vars.sourceFreezer === 1 && vars.destinationFreezer === 0)
          notify({ message: t("Thawed") });
        selectProduct("");
        setAmount(String(preferences.transferAmount));
        setSpecific(false);
        setMaximum(undefined);
        requestAnimationFrame(() => productField.current?.querySelector("input")?.focus());
      }

      await changed(details.product.id);
      onClose?.();
    },
    onError: (reason: Error) => setError({ message: reason.message }),
  });

  useEffect(() => onPendingChange?.(save.isPending), [save.isPending, onPendingChange]);

  const busy =
    save.isPending || finishedEmbedded || load.isPending || readEntries.isPending || pickerBusy;

  const sources = selection
    ? selection.locations.map((row) => ({
        id: row.location_id,
        name:
          row.location_name +
          (row.location_id === selection.details.location?.id ? ` (${t("Default location")})` : ""),
        is_freezer: row.location_is_freezer,
      }))
    : catalog.locations;

  const valid =
    !!selection &&
    !!productId &&
    !!from &&
    !!to &&
    !!unit &&
    !!amount &&
    Number(amount) >= minimum &&
    Number(amount.toString()) === Number(Number(amount).toFixed(precision)) &&
    (maximum === undefined || Number(amount) <= Number(maximum)) &&
    (!specific || !!stockId) &&
    error?.retry === undefined;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busy || !valid || !event.currentTarget.reportValidity()) return;
    setError(undefined);
    const source = sources.find((row) => String(row.id) === from)!;
    const destination = catalog.locations.find((row) => String(row.id) === to)!;
    const body: JsonObject = { amount: postedAmount, location_id_from: from, location_id_to: to };

    if (specific) body.stock_entry_id = stockId;
    save.mutate({
      product: productId,
      body,
      source: source.name,
      destination: destination.name,
      sourceFreezer: source.is_freezer,
      destinationFreezer: destination.is_freezer,
    });
  }

  return (
    <div className="transfer-layout">
      <form ref={form} className="move-form transfer-form" onSubmit={submit}>
        <fieldset disabled={save.isPending || finishedEmbedded}>
          <div ref={productField}>
            <ProductPicker
              products={catalog.products}
              barcodes={catalog.barcodes}
              plugin={catalog.barcode_lookup_plugin_name}
              value={productId}
              required
              disabled={busy}
              lookupDisabled={options.flow !== undefined || barcodeToLink !== undefined}
              autoFocus
              allowCreate={false}
              onChange={selectProduct}
              onResolved={() =>
                requestAnimationFrame(() =>
                  form.current?.querySelector<HTMLInputElement>(`[id="${id}-amount"]`)?.focus(),
                )
              }
              onAssignBarcode={(barcode) => {
                const next: TransferOptions = {
                  flow: "InplaceAddBarcodeToExistingProduct",
                  barcode,
                };

                if (options.embedded !== undefined) next.embedded = options.embedded;
                setOptions(next);
                onOptionsChange?.(next);
                setBarcodeToLink(barcode);
                initialAmountConverted.current = false;
                setAmount(String(preferences.transferAmount));
                selectProduct("");
              }}
              onBusyChange={setPickerBusy}
            />
          </div>
          {barcodeToLink !== undefined ? (
            <p role="status">
              {barcodeToLink}{" "}
              {t("will be added to the list of barcodes for the selected product on submit")}
            </p>
          ) : null}
          <label className="field">
            <span>{t("From location")}</span>
            <select
              required
              disabled={busy}
              value={from}
              onChange={(event) => {
                const value = event.target.value;
                setFrom(value);

                if (value === to) setTo("");
                setError(undefined);
                refreshSource(value);
              }}
            >
              <option value="" />
              {sources.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${id}-amount`}>{t("Amount")}</label>
              <NumberPicker
                id={`${id}-amount`}
                label={t("Amount")}
                value={amount}
                required
                disabled={busy}
                min={minimum}
                max={maximum}
                step={String(minimum)}
                onChange={(value) => {
                  setAmountCalculated(true);
                  setAmount(value);
                }}
              />
            </div>
            <label className="field">
              <span>{t("Quantity unit")}</span>
              <select
                required
                disabled={busy || units.length === 1}
                value={unitId}
                onChange={(event) => {
                  const value = event.target.value;
                  setUnitId(value);
                  setAmountCalculated(true);
                  setMaximum(
                    (
                      (selection?.details.stock_amount ?? NaN) *
                      (units.find((row) => String(row.id) === value)?.factor ?? NaN)
                    ).toFixed(precision),
                  );
                }}
              >
                {units.length === 0 ? <option value="" /> : null}
                {units.map((row) => (
                  <option key={String(row.id)} value={String(row.id)}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <input type="hidden" name="amount" value={postedAmount} />
          {amount &&
          unit &&
          selection &&
          unit.name !== selection.details.quantity_unit_stock.name ? (
            <p className="field-help">
              {t(
                "This equals %1$s %2$s",
                (Number(amount) / factor).toLocaleString(),
                unitLabel(
                  {
                    ...selection.details.quantity_unit_stock,
                    plural_forms: catalog.units.find(
                      (row) => row.name === selection.details.quantity_unit_stock.name,
                    )?.plural_forms,
                  },
                  Number(amount) / factor,
                  pluralIndex,
                  false,
                ),
              )}
            </p>
          ) : null}
          {maximum === (0).toFixed(precision) ? (
            <p role="status">{t("There are no units available at this location")}</p>
          ) : null}
          <div className="field">
            <label htmlFor={`${id}-to`}>{t("To location")}</label>
            <select
              id={`${id}-to`}
              required
              disabled={busy}
              value={to}
              aria-invalid={!!toError}
              aria-describedby={toError ? `${id}-to-error` : undefined}
              onChange={(event) => {
                const value = event.target.value;
                setTo(value === from ? "" : value);
                setToError(
                  value === from ? t('This cannot be the same as the "From" location') : "",
                );
              }}
            >
              <option value="" />
              {catalog.locations.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
            {toError ? (
              <small id={`${id}-to-error`} role="status">
                {toError}
              </small>
            ) : null}
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              checked={specific}
              disabled={busy}
              onChange={(event) => {
                const checked = event.target.checked;
                setSpecific(checked);

                if (!checked) {
                  setStockId("");
                  refreshSource(from, { recheck: false });
                }
              }}
            />
            {t("Use a specific stock item")}
          </label>
          <label className="field">
            <span className="sr-only">{t("Specific stock item")}</span>
            <select
              required={specific}
              disabled={busy || !specific}
              value={stockId}
              onChange={(event) => {
                const value = event.target.value;
                setStockId(value);

                if (value)
                  setMaximum(
                    Number(entries.find((row) => row.stock_id === value)?.amount).toFixed(
                      precision,
                    ),
                  );
                else refreshSource(from, { rebuild: false });
              }}
            >
              <option value="" />
              {entries.map((row) => (
                <option key={row.stock_id} value={row.stock_id}>
                  {t(
                    "Amount: %1$s; Due on %2$s; Bought on %3$s",
                    row.amount,
                    moment(row.best_before_date).format("YYYY-MM-DD"),
                    moment(row.purchased_date).format("YYYY-MM-DD"),
                  )}
                  ; {t(row.open === 1 ? "Opened" : "Not opened")}
                  {row.note ? ` ${row.note}` : ""}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        {load.isPending || readEntries.isPending ? <LoadingBlock label={t("Loading…")} /> : null}
        {error ? (
          <>
            <ErrorBlock message={error.message} />
            {error.retry ? (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  setError(undefined);

                  if (error.retry === "product") selectProduct(productId, code);
                  else refreshSource(from);
                }}
              >
                {t("Retry")}
              </button>
            ) : null}
          </>
        ) : null}
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !valid}>
            {save.isPending ? t("Saving…") : t("OK")}
          </button>
          {onClose ? (
            <button type="button" className="btn" disabled={save.isPending} onClick={onClose}>
              {t("Cancel")}
            </button>
          ) : null}
        </div>
      </form>
      {options.embedded === undefined && cardProduct !== undefined ? (
        <section className="transfer-product">
          <ProductCard
            productId={cardProduct}
            embedded={false}
            expanded={expanded}
            onExpandedChange={setExpanded}
            onReturn={async () => {
              await changed(cardProduct);
            }}
          />
        </section>
      ) : null}
    </div>
  );
}
