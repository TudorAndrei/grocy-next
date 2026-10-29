import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import moment from "moment/min/moment-with-locales.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userSettingsQuery } from "@/hooks/queries";
import { useModalDialog } from "@/hooks/useModalDialog";
import { api, request } from "@/lib/api";
import { useInvalidateStock } from "@/lib/catalog";
import { useFeatures } from "@/lib/features";
import { usePermissions } from "@/lib/permissions";
import { unitLabel } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { stockEditorUnits } from "@/lib/stock-editor";
import {
  getConsumeCatalog,
  getConsumeBarcode,
  getConsumeDetails,
  getConsumeEntries,
  getConsumeSelection,
  getConsumeStockEntry,
  type ConsumeCatalog,
  type ConsumeDetails,
  type ConsumeEntry,
  type ConsumeOptions,
  type ConsumeSelection,
} from "@/lib/consume";
import { tableAttribute, tableText } from "@/lib/native-table-cell";
import type { Booking } from "@/lib/types";
import type { JsonObject } from "@/lib/json";
import { ProductPicker, type ProductCode } from "./ProductPicker";
import { ProductCard } from "./ProductOverview";
import { NumberPicker } from "./NumberPicker";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { useNotify } from "./Toaster";

type Props = {
  options: ConsumeOptions;
  onClose?: () => void;
  onPendingChange?: (pending: boolean) => void;
  onOptionsChange?: (options: ConsumeOptions) => void;
};

export function ConsumeDialog(props: Omit<Props, "onPendingChange">) {
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
      <h2 id={title}>{t("Consume")}</h2>
      <ConsumeForm {...props} onPendingChange={setPending} />
    </dialog>
  );
}

export function ConsumeForm(props: Props) {
  const { t } = useI18n();
  const settings = useQuery(userSettingsQuery());

  const catalog = useQuery({
    queryKey: ["stock", "consume-editor"],
    queryFn: ({ signal }) => getConsumeCatalog(signal),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (catalog.isSuccess && catalog.isFetchedAfterMount && settings.isSuccess)
    return <ConsumeFields {...props} catalog={catalog.data} />;

  return (
    <>
      {catalog.isPending || catalog.isFetching || settings.isPending ? <LoadingBlock /> : null}
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

function ConsumeFields({
  catalog,
  options: initialOptions,
  onClose,
  onPendingChange,
  onOptionsChange,
}: Props & { catalog: ConsumeCatalog }) {
  const { t, pluralIndex } = useI18n();
  const features = useFeatures();
  const can = usePermissions();
  const preferences = usePreferences();
  const client = useQueryClient();
  const invalidate = useInvalidateStock();
  const notify = useNotify();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const amountAtFocus = useRef<string>(undefined);
  const read = useRef<AbortController>(undefined);
  const sourceRead = useRef<AbortController>(undefined);
  const version = useRef(0);
  const sourceVersion = useRef(0);
  // Native callbacks share these values before React renders their changes.
  const sourceValues = useRef({ sum: 0, specific: false, factor: NaN, amount: "" });
  const autoSubmit = useRef(false);
  const alive = useRef(true);
  const [options, setOptions] = useState(initialOptions);
  const prefill = options["product-name"];

  const named =
    prefill === undefined
      ? undefined
      : (catalog.products.find((row) =>
          (
            catalog.barcodes
              .find((barcode) => barcode.product_id === row.id)
              ?.barcodes?.toLowerCase() ?? ""
          ).includes(prefill),
        ) ?? catalog.products.find((row) => row.name.includes(prefill)));

  const initial =
    options.product === undefined
      ? named
      : catalog.products.find((row) => String(row.id) === options.product);

  const [product, setProduct] = useState(initial ? String(initial.id) : "");
  const [selection, setSelection] = useState<ConsumeSelection>();
  const [code, setCode] = useState<ProductCode>();
  const [amount, updateAmount] = useState(String(preferences.consumeAmount));
  const [conversionAmount, setConversionAmount] = useState(String(preferences.consumeAmount));
  const [unitId, setUnitId] = useState("");
  const [unitRestored, setUnitRestored] = useState(false);
  const [location, setLocation] = useState("");

  const [sources, setSources] = useState(() =>
    catalog.locations.map((row) => ({ location_id: row.id, location_name: row.name })),
  );

  const [entries, setEntries] = useState<ConsumeEntry[]>([]);
  const [sum, updateSum] = useState(0);
  const [maximum, setMaximum] = useState<string>();
  const [specific, updateSpecific] = useState(false);
  const [stockItemDisabled, setStockItemDisabled] = useState(true);
  const [stockId, setStockId] = useState("");
  const [exact, setExact] = useState(false);
  const [spoiled, setSpoiled] = useState(false);
  const [recipe, setRecipe] = useState("");
  const [recipeText, setRecipeText] = useState("");
  const [loading, setLoading] = useState(initial !== undefined && options.embedded !== undefined);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<{ message: string; retry?: "product" | "source" }>();
  const [card, setCard] = useState(initial?.id);
  const [expanded, setExpanded] = useState(false);
  const details = selection?.details;
  const locationsEnabled = features.enabled("STOCK_LOCATION_TRACKING");
  const recipesEnabled = features.enabled("RECIPES");
  const scanEnabled = options.embedded === undefined && preferences.scanConsume;
  const precision = preferences.amountPrecision;
  const minimum = precision > 0 ? 10 ** -precision : 1;

  const units = details
    ? stockEditorUnits(catalog, String(details.product.id), details.quantity_unit_stock.id)
    : [];

  const unit = units.find((row) => String(row.id) === unitId);
  const factor = unit?.factor ?? NaN;
  const tare = details?.product.enable_tare_weight_handling === 1;
  const tareWeight = details?.product.tare_weight ?? 0;
  const minimumAmount = tare && !exact ? tareWeight : minimum;

  function setAmount(value: string) {
    sourceValues.current.amount = value;
    updateAmount(value);
  }

  function setSum(value: number) {
    sourceValues.current.sum = value;
    updateSum(value);
  }

  function setSpecific(value: boolean) {
    sourceValues.current.specific = value;
    updateSpecific(value);
  }

  const postedAmount = (Number(conversionAmount) / factor)
    .toFixed(Math.max(1, precision))
    .replace(/0*$/g, "");

  function limit(data: ConsumeDetails, total: number, nextFactor: number, nextExact = exact) {
    if (data.has_childs) return undefined;

    return (
      data.product.enable_tare_weight_handling === 1 && !nextExact
        ? total + (data.product.tare_weight ?? 0)
        : total * nextFactor
    ).toFixed(precision);
  }

  async function refreshLocation(
    value: string,
    {
      data = selection,
      selectedCode = code,
      batch,
    }: {
      data?: ConsumeSelection;
      selectedCode?: ProductCode;
      batch?: { current: number; controller: AbortController };
    } = {},
  ) {
    if (!batch) {
      sourceRead.current?.abort();
      sourceRead.current = new AbortController();
    }

    const current = batch?.current ?? ++sourceVersion.current;
    const signal = (batch?.controller ?? sourceRead.current!).signal;

    if (sourceValues.current.specific) setStockItemDisabled(true);
    setSpecific(false);
    setStockId("");
    setEntries([]);
    setLocation(value);

    const reloadStockCode = options.embedded === undefined && selectedCode?.stockId !== undefined;

    if ((!value && !reloadStockCode) || !data) {
      setSum(0);
      setSourceLoading(false);

      return;
    }

    setSourceLoading(true);

    try {
      if (reloadStockCode && selectedCode?.stockId !== undefined) {
        const stock = await getConsumeStockEntry(
          String(data.details.product.id),
          selectedCode.stockId,
          signal,
        );

        if (signal.aborted || current !== sourceVersion.current || !stock) return;
        value = String(stock.location_id);
        setLocation(value);
        // The native callback changes only the display input, not the amount picker.
        setAmount(String(stock.amount));
      }

      // Native resets the shared sum when each stock-code lookup returns.
      setSum(0);
      const rows = await getConsumeEntries(String(data.details.product.id), signal);

      if (signal.aborted || current !== sourceVersion.current) return;
      const located = rows.filter((row) => String(row.location_id) === value);
      const total = located.reduce((amount, row) => amount + (row.amount || 0), 0);
      const forced = options.embedded === undefined ? selectedCode?.stockId : options.stockId;
      setEntries((previous) => [...previous, ...located]);
      setSum(sourceValues.current.sum + total);

      const matchingEntries = located.filter((row) => row.stock_id === forced).length;

      if (forced !== undefined && matchingEntries > 0) {
        // Native clicks the checkbox once for each matching row, including duplicates.
        const checked = sourceValues.current.specific !== (matchingEntries % 2 === 1);
        setSpecific(checked);
        setStockItemDisabled(!checked);
        setStockId(forced);
      }

      const fresh = await getConsumeDetails(String(data.details.product.id), signal);

      if (signal.aborted || current !== sourceVersion.current) return;
      setSelection({ ...data, details: fresh });
      setMaximum(limit(fresh, sourceValues.current.sum, sourceValues.current.factor));

      if (scanEnabled && (!selectedCode || selectedCode.barcode.startsWith("grcy"))) {
        setAmount("1");
        setConversionAmount("1");
        autoSubmit.current = true;
      }
    } catch (reason) {
      if (!signal.aborted && current === sourceVersion.current)
        setError({
          message: reason instanceof Error ? reason.message : String(reason),
          retry: "source",
        });
    } finally {
      if (current === sourceVersion.current) setSourceLoading(false);
    }
  }

  async function selectProduct(value: string, selectedCode?: ProductCode) {
    if (value === product && !selectedCode && (selection || (loading && read.current))) return;
    read.current?.abort();
    sourceRead.current?.abort();
    const current = ++version.current;
    sourceVersion.current++;
    autoSubmit.current = false;
    setProduct(value);
    setCode(selectedCode);
    setSelection(undefined);
    setLocation("");
    setEntries([]);
    setStockId("");

    if (specific) setStockItemDisabled(true);
    setSpecific(false);
    setSourceLoading(false);
    setError(undefined);

    if (!value) {
      setLoading(false);

      return;
    }

    if (card === Number(value))
      void client.invalidateQueries({ queryKey: ["product-overview", Number(value)] });
    setCard(Number(value));
    setLoading(true);
    read.current = new AbortController();
    const signal = read.current.signal;

    try {
      const data = await getConsumeSelection(value, signal);

      if (signal.aborted || current !== version.current) return;
      const choices = stockEditorUnits(catalog, value, data.details.quantity_unit_stock.id);
      const selectedUnit = data.details.default_quantity_unit_consume?.id;
      const nextUnit = choices.find((row) => row.id === selectedUnit);

      const nextAmount = preferences.useQuickConsumeAmount
        ? String((data.details.product.quick_consume_amount ?? 0) * (nextUnit?.factor ?? NaN))
        : String(preferences.consumeAmount);

      const preferred =
        data.details.product.default_consume_location_id || data.details.location?.id;

      const convertedAmount = nextAmount;

      setSelection(data);
      const seen = new Set<number>();
      setSources(
        data.locations.filter((row) => {
          if (seen.has(row.location_id)) return false;
          seen.add(row.location_id);

          return true;
        }),
      );
      setUnitId(nextUnit ? String(nextUnit.id) : "");
      sourceValues.current.factor = nextUnit?.factor ?? NaN;
      setUnitRestored(false);
      setAmount(nextAmount === "NaN" ? "" : nextAmount);
      setConversionAmount(convertedAmount);
      const changes: string[] = [];
      let defaultAdded = false;
      let defaultAmount = 0;
      seen.clear();

      for (const row of data.locations) {
        if (row.location_id === preferred) {
          if (!seen.has(row.location_id)) {
            changes.push(String(preferred));
            defaultAdded = true;
          }

          defaultAmount += row.amount;
        }

        seen.add(row.location_id);

        if (!defaultAdded) changes.push("");
      }

      if (defaultAmount === 0 && data.locations[0])
        changes.push(String(data.locations[0].location_id));

      sourceRead.current = new AbortController();
      const batch = { current: ++sourceVersion.current, controller: sourceRead.current };

      const locationReads = changes.map((source) =>
        refreshLocation(source, {
          data,
          selectedCode,
          batch,
        }),
      );

      let barcodeFound = false;

      const barcodeRead = selectedCode
        ? getConsumeBarcode(selectedCode.barcode, signal).then((barcode) => {
            if (signal.aborted || current !== version.current || !barcode) return;
            barcodeFound = true;

            if (barcode.amount != null) setAmount(String(barcode.amount));

            if (barcode.qu_id != null) {
              const barcodeUnit = choices.find((row) => row.id === barcode.qu_id);
              setUnitId(barcodeUnit ? String(barcodeUnit.id) : "");
              sourceValues.current.factor = barcodeUnit?.factor ?? NaN;
            }

            setConversionAmount(sourceValues.current.amount);
          })
        : undefined;

      await Promise.all([...locationReads, barcodeRead]);

      if (signal.aborted || current !== version.current) return;

      if (scanEnabled && barcodeFound) autoSubmit.current = true;
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLInputElement>(`[id="${id}-amount"]`)?.focus(),
      );
    } catch (reason) {
      if (!signal.aborted && current === version.current)
        setError({
          message: reason instanceof Error ? reason.message : String(reason),
          retry: "product",
        });
    } finally {
      if (current === version.current) setLoading(false);
    }
  }

  const start = useEffectEvent(() => {
    // Native full-page bookmark events run before the consume handler is installed.
    if (initial && options.embedded !== undefined) void selectProduct(String(initial.id));
  });

  useEffect(() => {
    alive.current = true;
    const frame = requestAnimationFrame(() => start());

    return () => {
      cancelAnimationFrame(frame);
      alive.current = false;
      read.current?.abort();
      sourceRead.current?.abort();
    };
  }, []);

  async function changed(identity: number) {
    await invalidate();
    await client.invalidateQueries({ queryKey: ["product-overview", identity] });
  }

  const save = useMutation({
    mutationFn: async (vars: { product: string; body: JsonObject; open: boolean }) => {
      const fresh = await getConsumeDetails(vars.product);

      const bookings = await request<Booking[]>(
        `/api/stock/products/${vars.product}/${vars.open ? "open" : "consume"}`,
        { method: "POST", body: JSON.stringify(vars.body) },
      );

      if (!bookings[0]) throw new Error(t("The stock booking could not be read."));

      return { vars, fresh, transaction: bookings[0].transaction_id };
    },
    onSuccess: async ({ vars, fresh, transaction }) => {
      if (
        !vars.open &&
        options.flow === "InplaceAddBarcodeToExistingProduct" &&
        options.barcode !== undefined
      ) {
        void api
          .action("/api/objects/product_barcodes", {
            barcode: options.barcode,
            product_id: vars.product,
          })
          .then(() => {
            if (!alive.current || options.embedded !== undefined) return;
            setOptions({});
            onOptionsChange?.({});
          })
          .catch((reason: Error) => notify({ message: reason.message, tone: "error" }));
      }

      const posted = Number(vars.body.amount);

      const removed = Math.abs(
        posted -
          (!vars.open && fresh.product.enable_tare_weight_handling === 1 && !vars.body.exact_amount
            ? (fresh.product.tare_weight ?? 0) + fresh.stock_amount
            : 0),
      );

      const stockUnit = {
        ...fresh.quantity_unit_stock,
        plural_forms: catalog.units.find((row) => row.id === fresh.quantity_unit_stock.id)
          ?.plural_forms,
      };

      const message = t(
        vars.open ? "Marked %1$s of %2$s as opened" : "Removed %1$s of %2$s from stock",
        `${vars.open ? posted.toLocaleString() : removed} ${unitLabel(stockUnit, posted, pluralIndex, false)}`,
        fresh.product.name,
      );

      notify({
        message,
        undo: async () => {
          await api.undoTransaction(transaction);
        },
      });

      setEntries([]);
      setSpecific(false);
      setStockId("");

      if (vars.open || options.embedded === undefined) {
        // EndUiBusy enables all native controls, including an unchecked item picker.
        setUnitRestored(true);
        setStockItemDisabled(false);
      }

      if (!vars.open && options.embedded !== undefined) {
        setFinished(true);

        if (window.parent !== window) {
          const undo = `<br><a class="btn btn-secondary btn-sm mt-2" href="#" onclick="UndoStockTransaction(${tableAttribute(JSON.stringify(transaction))})"><i class="fa-solid fa-undo"></i> ${tableText(t("Undo"))}</a>`;
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
      } else {
        setProduct("");

        const nextAmount = preferences.useQuickConsumeAmount
          ? vars.open
            ? String((fresh.product.quick_consume_amount ?? 0) * factor)
            : ""
          : String(preferences.consumeAmount);

        setAmount(nextAmount);
        setConversionAmount(nextAmount);

        if (vars.open) {
          if (fresh.product.move_on_open === 1 && fresh.default_consume_location)
            notify({ message: t("Moved to %1$s", fresh.default_consume_location.name) });
        } else {
          setSelection(undefined);
          setUnitId("");
          setMaximum(undefined);
          setLocation("");
          setSources([]);
          setRecipe("");
          setRecipeText("");
          const next = { ...options };
          delete next.flow;
          delete next.barcode;
          delete next["product-name"];
          setOptions(next);
          onOptionsChange?.(next);
        }

        requestAnimationFrame(() => picker.current?.querySelector("input")?.focus());
      }

      if (!vars.open) await changed(fresh.product.id);

      if (!vars.open) onClose?.();
    },
    onError: (reason: Error) => {
      setUnitRestored(true);
      setStockItemDisabled(false);
      setError({ message: reason.message });
    },
  });

  const busy = loading || sourceLoading || pickerBusy || save.isPending || finished;

  const valid =
    !!product &&
    !!details &&
    !!unit &&
    !!amount &&
    Number(amount) >= minimumAmount &&
    Number(amount) === Number(Number(amount).toFixed(precision)) &&
    (!Number.isFinite(Number(maximum)) || Number(amount) <= Number(maximum)) &&
    (!specific || !!stockId) &&
    error?.retry === undefined;

  useEffect(() => onPendingChange?.(save.isPending), [save.isPending, onPendingChange]);

  function submit(open = false) {
    if (busy || !valid || !form.current?.reportValidity()) return;
    setError(undefined);
    const body: JsonObject = { amount: postedAmount, allow_subproduct_substitution: true };

    if (specific) body.stock_entry_id = stockId;

    if (!open) {
      body.exact_amount = exact;
      body.spoiled = spoiled;

      if (locationsEnabled) body.location_id = location;

      if (recipesEnabled && recipe) body.recipe_id = recipe;
    }

    save.mutate({ product, body, open });
  }

  const scan = useMutation({
    mutationFn: () => api.putUserSetting("scan_mode_consume_enabled", !preferences.scanConsume),
    onSuccess: () => client.invalidateQueries({ queryKey: userSettingsQuery().queryKey }),
  });

  const scanReady = useEffectEvent(() => {
    if (!autoSubmit.current || busy || !details || !form.current) return;
    autoSubmit.current = false;

    if (valid && form.current.checkValidity()) form.current.requestSubmit();
    else
      notify({
        message: t("Scan mode is on but not all required fields could be populated automatically"),
        tone: "error",
      });
  });

  useEffect(() => {
    scanReady();
  }, [busy, details]);

  const preferred = details?.product.default_consume_location_id || details?.location?.id;

  return (
    <div className="transfer-layout">
      <form
        ref={form}
        className="move-form transfer-form"
        aria-label={t("Consume")}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {options.embedded === undefined ? (
          <button
            type="button"
            className="btn"
            aria-pressed={scanEnabled}
            disabled={scan.isPending || save.isPending}
            onClick={() => scan.mutate()}
          >
            {t("Scan mode")} {t(scanEnabled ? "on" : "off")}
          </button>
        ) : null}
        {scan.error ? <ErrorBlock message={scan.error.message} /> : null}
        <fieldset disabled={save.isPending || finished}>
          <div ref={picker}>
            <ProductPicker
              products={catalog.products}
              barcodes={catalog.barcodes}
              plugin={catalog.barcode_lookup_plugin_name}
              value={product}
              required
              disabled={busy}
              lookupDisabled={options.flow !== undefined}
              autoFocus
              allowCreate={false}
              workflowPath={`/consume${options.embedded === undefined ? "" : "?embedded"}`}
              onChange={(value, nextCode) => void selectProduct(value, nextCode)}
              onResolved={() =>
                requestAnimationFrame(() => {
                  if (
                    document.activeElement !== document.body &&
                    !picker.current?.contains(document.activeElement)
                  )
                    return;
                  form.current?.querySelector<HTMLInputElement>(`[id="${id}-amount"]`)?.focus();
                })
              }
              onAssignBarcode={(barcode) => {
                const next: ConsumeOptions = {
                  flow: "InplaceAddBarcodeToExistingProduct",
                  barcode,
                };

                if (options.embedded !== undefined) next.embedded = options.embedded;
                setOptions(next);
                onOptionsChange?.(next);
                void selectProduct("");
              }}
              onBusyChange={setPickerBusy}
            />
          </div>
          {options.flow === "InplaceAddBarcodeToExistingProduct" ? (
            <p role="status">
              {options.barcode}{" "}
              {t("will be added to the list of barcodes for the selected product on submit")}
            </p>
          ) : null}
          {tare ? (
            <label className="check-field">
              <input
                type="checkbox"
                checked={exact}
                disabled={busy}
                onChange={(event) => {
                  setExact(event.target.checked);
                  setMaximum(limit(details!, sum, factor, event.target.checked));
                }}
              />
              {t("Consume exact amount")}
            </label>
          ) : null}
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${id}-amount`}>{t("Amount")}</label>
              <NumberPicker
                id={`${id}-amount`}
                label={t("Amount")}
                value={amount}
                required
                disabled={loading || pickerBusy || save.isPending || finished}
                min={minimumAmount}
                max={maximum}
                step={String(minimum)}
                onChange={(value) => {
                  setAmount(value);
                  setConversionAmount(value);
                }}
                onFocus={(value) => {
                  amountAtFocus.current = value;
                }}
                onBlur={(value) => {
                  if (amountAtFocus.current !== undefined && amountAtFocus.current !== value)
                    setConversionAmount(value);
                  amountAtFocus.current = undefined;
                }}
              />
            </div>
            <label className="field">
              <span>{t("Quantity unit")}</span>
              <select
                required
                disabled={busy || (units.length === 1 && !unitRestored)}
                value={unitId}
                onChange={(event) => {
                  const value = event.target.value;
                  setUnitId(value);
                  sourceValues.current.factor =
                    units.find((row) => String(row.id) === value)?.factor ?? NaN;
                  setConversionAmount(amount);

                  if (details)
                    setMaximum(
                      limit(
                        details,
                        sum,
                        units.find((row) => String(row.id) === value)?.factor ?? NaN,
                      ),
                    );
                }}
              >
                {units.length === 0 || !unit ? <option value="" /> : null}
                {units.map((row) => (
                  <option key={String(row.id)} value={String(row.id)}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <input type="hidden" name="amount" value={postedAmount} />
          {conversionAmount && unit && details && unit.name !== details.quantity_unit_stock.name ? (
            <p className="field-help">
              {t(
                "This equals %1$s %2$s",
                (Number(conversionAmount) / factor).toLocaleString(),
                unitLabel(
                  details.quantity_unit_stock,
                  Number(conversionAmount) / factor,
                  pluralIndex,
                  false,
                ),
              )}
            </p>
          ) : null}
          {tare && !exact ? (
            <p className="field-help">
              {t(
                "Tare weight handling enabled - please weigh the whole container, the amount to be posted will be automatically calculcated",
              )}
            </p>
          ) : null}
          {maximum === (0).toFixed(precision) ? (
            <p role="status">{t("There are no units available at this location")}</p>
          ) : null}
          <label className="field" hidden={!locationsEnabled}>
            <span>{t("Location")}</span>
            <select
              required
              disabled={busy || !locationsEnabled}
              value={location}
              onChange={(event) => {
                setError(undefined);

                void refreshLocation(event.target.value);
              }}
            >
              <option value="" />
              {sources.map((row) => (
                <option key={row.location_id} value={row.location_id}>
                  {row.location_name}
                  {row.location_id === preferred ? ` (${t("Default location")})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={spoiled}
              disabled={busy}
              onChange={(event) => setSpoiled(event.target.checked)}
            />
            {t("Spoiled")}
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={specific}
              disabled={busy}
              onChange={(event) => {
                setSpecific(event.target.checked);
                setStockItemDisabled(!event.target.checked);

                if (!event.target.checked) setStockId("");
              }}
            />
            {t("Use a specific stock item")}
          </label>
          <label className="field">
            <span className="sr-only">{t("Specific stock item")}</span>
            <select
              required={specific}
              disabled={busy || stockItemDisabled}
              value={stockId}
              onChange={(event) => {
                const value = event.target.value;
                setStockId(value);

                if (value) {
                  setMaximum(
                    Number(entries.find((row) => row.stock_id === value)?.amount).toFixed(
                      precision,
                    ),
                  );
                } else {
                  // The native clear callback reads the absent amount_aggregated field.
                  const total = entries.reduce(
                    (sum, row) => sum + Number(row.amount_aggregated),
                    0,
                  );

                  setSum(total);
                  setMaximum(total.toFixed(precision));
                }
              }}
            >
              <option value="" />
              {entries.map((row, index) => (
                <option key={`${row.stock_id}:${index}`} value={row.stock_id}>
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
          {recipesEnabled ? (
            <div className="field">
              <label htmlFor={`${id}-recipe`}>{t("Recipe")}</label>
              <input
                id={`${id}-recipe`}
                list={`${id}-recipes`}
                aria-describedby={`${id}-recipe-hint`}
                value={recipeText}
                disabled={busy}
                onChange={(event) => {
                  const text = event.target.value;
                  setRecipeText(text);
                  const found = catalog.recipes.find((row) => row.name === text);
                  setRecipe(found ? String(found.id) : "");
                }}
                onBlur={() => {
                  if (!recipeText.startsWith("grcy")) return;
                  const parts = recipeText.split(":");

                  const found =
                    parts[1] === "r"
                      ? catalog.recipes.find((row) => String(row.id) === parts[2])
                      : undefined;

                  setRecipe(found ? String(found.id) : "");
                  setRecipeText(found?.name ?? "");
                }}
              />
              <datalist id={`${id}-recipes`}>
                {catalog.recipes.map((row) => (
                  <option key={row.id} value={row.name} />
                ))}
              </datalist>
              <small id={`${id}-recipe-hint`}>{t("This is for statistical purposes only")}</small>
            </div>
          ) : null}
        </fieldset>
        {loading || sourceLoading ? <LoadingBlock /> : null}
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

                  if (error.retry === "product") void selectProduct(product, code);
                  else void refreshLocation(location);
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
          {features.enabled("STOCK_PRODUCT_OPENED_TRACKING") ? (
            <button
              type="button"
              className="btn"
              disabled={
                busy ||
                !valid ||
                !can("STOCK_OPEN") ||
                tare ||
                details?.product.disable_open === 1 ||
                details?.stock_amount === details?.stock_amount_opened
              }
              onClick={() => submit(true)}
            >
              {t("Mark as opened")}
            </button>
          ) : null}
          {onClose ? (
            <button type="button" className="btn" disabled={save.isPending} onClick={onClose}>
              {t("Cancel")}
            </button>
          ) : null}
        </div>
      </form>
      {options.embedded === undefined && card !== undefined ? (
        <section className="transfer-product">
          <ProductCard
            productId={card}
            embedded={false}
            expanded={expanded}
            onExpandedChange={setExpanded}
            onReturn={() => changed(card)}
          />
        </section>
      ) : null}
    </div>
  );
}
