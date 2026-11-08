import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import moment from "moment/min/moment-with-locales.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userSettingsQuery } from "@/hooks/queries";
import { useModalDialog } from "@/hooks/useModalDialog";
import { useGenericError } from "@/hooks/useGenericError";
import { api, request } from "@/lib/api";
import { getTopmostGrocyWindow } from "@/lib/embedded-window";
import { useInvalidateStock } from "@/lib/catalog";
import { useFeatures } from "@/lib/features";
import { usePermissions } from "@/lib/permissions";
import { unitLabel } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { stockEditorUnits } from "@/lib/stock-editor";
import { nativeQuantityValue } from "@/lib/native-quantity";
import { playUiSound } from "@/lib/ui-sound";
import {
  getConsumeCatalog,
  getConsumeBarcode,
  getConsumeDetails,
  getConsumeEntries,
  getConsumeLocations,
  getConsumeStockEntry,
  type ConsumeCatalog,
  type ConsumeDetails,
  type ConsumeEntry,
  type ConsumeOptions,
  type ConsumeSelection,
} from "@/lib/consume";
import { useConsumeDocument, type ConsumeDocument } from "@/lib/consume-document";
import { tableAttribute, tableText } from "@/lib/native-table-cell";
import type { Booking } from "@/lib/types";
import type { JsonObject } from "@/lib/json";
import { ProductPicker, type ProductCode } from "./ProductPicker";
import { RecipePicker } from "./RecipePicker";
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

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog transfer-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();

        props.onClose?.();
      }}
    >
      <h2 id={title}>{t("Consume")}</h2>
      <ConsumeForm
        {...props}
        onClose={
          props.onClose
            ? () => {
                if (dialog.current?.open) props.onClose?.();
              }
            : undefined
        }
      />
    </dialog>
  );
}

export function ConsumeForm(props: Props) {
  const document = useConsumeDocument(props.options);

  return <ConsumeDocumentBody key={document.revision} {...props} document={document} />;
}

function ConsumeDocumentBody({ document, ...props }: Props & { document: ConsumeDocument }) {
  const { t } = useI18n();
  const settings = useQuery({ ...userSettingsQuery(), refetchOnMount: "always" });

  const catalog = useQuery({
    queryKey: ["stock", "consume-editor"],
    queryFn: ({ signal }) => getConsumeCatalog(signal),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (
    catalog.isSuccess &&
    catalog.isFetchedAfterMount &&
    settings.isSuccess &&
    settings.isFetchedAfterMount
  )
    return (
      <ConsumeFields
        {...props}
        options={document.initialOptions}
        document={document}
        catalog={catalog.data}
      />
    );

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
  document: consumeDocument,
}: Props & { catalog: ConsumeCatalog; document: ConsumeDocument }) {
  const { t, pluralIndex } = useI18n();
  const features = useFeatures();
  const can = usePermissions();
  const preferences = usePreferences();
  const client = useQueryClient();
  const invalidate = useInvalidateStock();
  const notify = useNotify();
  const genericError = useGenericError();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const amountAtFocus = useRef<{ value: string; edited: boolean }>(undefined);
  const picker = useRef<HTMLDivElement>(null);
  const currentDetails = useRef<ConsumeDetails>(undefined);
  const currentCode = useRef<ProductCode>(undefined);
  const selectionReads = useRef(new Set<string>());
  const loadedSelection = useRef<string>(undefined);

  // Native callbacks share these values before React renders their changes.
  const sourceValues = useRef<{
    sum: number;
    specific: boolean;
    factor: number;
    amount: string;
    product: string;
    location: string;
    stockId: string;
    exact: boolean;
    spoiled: boolean;
    recipe: string;
    maximum?: string;
  }>({
    sum: 0,
    specific: false,
    factor: NaN,
    amount: "",
    product: "",
    location: "",
    stockId: "",
    exact: false,
    spoiled: false,
    recipe: "",
    maximum: undefined,
  });

  const bookingBusy = useRef(false);
  const openBody = useRef<JsonObject>({});
  const initialScanMode = !consumeDocument.serverEmbedded && preferences.scanConsume;
  const scanState = useRef(initialScanMode);
  const [scanEnabled, setScanEnabled] = useState(initialScanMode);
  const alive = useRef(true);
  const owner = useRef(new AbortController());
  const [options] = useState(initialOptions);
  const [barcodeAdded, setBarcodeAdded] = useState(false);
  const [additionalBarcodes, setAdditionalBarcodes] = useState<Record<string, string>>({});
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

  const [product, updateProduct] = useState(initial ? String(initial.id) : "");
  const [selection, setSelection] = useState<ConsumeSelection>();
  const [amount, updateAmount] = useState(String(preferences.consumeAmount));
  const [conversionAmount, updateConversionAmount] = useState(String(preferences.consumeAmount));
  const conversionValue = useRef(String(preferences.consumeAmount));
  const [unitId, setUnitId] = useState("");
  const [unitRestored, setUnitRestored] = useState(false);
  const [location, updateLocation] = useState("");

  type SourceOption = { location_id: number; location_name: string; isDefault?: boolean };

  const [sources, setSources] = useState<SourceOption[]>(() =>
    catalog.locations.map((row) => ({ location_id: row.id, location_name: row.name })),
  );

  const sourceOptions = useRef(sources);
  const unitChoices = useRef<ReturnType<typeof stockEditorUnits>>([]);

  const [entries, setEntries] = useState<ConsumeEntry[]>([]);
  const [sum, updateSum] = useState(0);
  const [maximum, updateMaximum] = useState<string>();
  const [specific, updateSpecific] = useState(false);
  const [stockItemDisabled, setStockItemDisabled] = useState(true);
  const [stockId, updateStockId] = useState("");
  const [exact, setExact] = useState(false);
  const [spoiled, setSpoiled] = useState(false);
  const [recipe, setRecipe] = useState("");
  const [recipeText, setRecipeText] = useState("");
  const [recipeMenu, setRecipeMenu] = useState(false);
  const recipeMenuState = useRef(false);

  const changeRecipeMenu = (open: boolean) => {
    recipeMenuState.current = open;
    setRecipeMenu(open);
  };

  const [loading, setLoading] = useState(initial !== undefined && options.embedded !== undefined);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [externalBusy, setExternalBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [card, setCard] = useState(initial?.id);
  const [expanded, setExpanded] = useState(false);
  const details = selection?.details;
  const locationsEnabled = features.enabled("STOCK_LOCATION_TRACKING");
  const recipesEnabled = features.enabled("RECIPES");
  const precision = preferences.amountPrecision;
  const minimum = precision > 0 ? 10 ** -precision : 1;

  const [units, setUnits] = useState<ReturnType<typeof stockEditorUnits>>([]);

  const unit = units.find((row) => String(row.id) === unitId);
  const factor = unit?.factor ?? NaN;
  const tare = details?.product.enable_tare_weight_handling === 1;
  const tareWeight = details?.product.tare_weight ?? 0;
  const minimumAmount = tare && !exact ? tareWeight : minimum;

  function setProduct(value: string) {
    sourceValues.current.product = value;
    updateProduct(value);
  }

  function setLocation(value: string) {
    sourceValues.current.location = value;
    updateLocation(value);
  }

  function setStockId(value: string) {
    sourceValues.current.stockId = value;
    updateStockId(value);
  }

  function setAmount(value: string) {
    sourceValues.current.amount = value;
    updateAmount(value);
  }

  function setConversionAmount(value: string) {
    conversionValue.current = value;
    updateConversionAmount(value);
  }

  function setSum(value: number) {
    sourceValues.current.sum = value;
    updateSum(value);
  }

  function setSpecific(value: boolean) {
    sourceValues.current.specific = value;
    updateSpecific(value);
  }

  function replaceSources(value: SourceOption[]) {
    sourceOptions.current = value;
    setSources(value);
  }

  function setMaximum(value: string | undefined) {
    sourceValues.current.maximum = value;
    updateMaximum(value);
  }

  function applyDetails(value: ConsumeDetails) {
    currentDetails.current = value;
    setSelection((previous) => ({ details: value, locations: previous?.locations ?? [] }));
  }

  function bookingAmount(value: string, unitFactor: number) {
    return (Number(value) / unitFactor).toFixed(Math.max(1, precision)).replace(/0*$/g, "");
  }

  const postedAmount = bookingAmount(conversionAmount, factor);

  function limit(
    data: ConsumeDetails,
    total: number,
    nextFactor: number,
    nextExact = sourceValues.current.exact,
  ) {
    if (data.has_childs) return undefined;

    return (
      data.product.enable_tare_weight_handling === 1 && !nextExact
        ? total + (data.product.tare_weight ?? 0)
        : total * nextFactor
    ).toFixed(precision);
  }

  async function changed(identity: number) {
    await invalidate(identity);
    await client.invalidateQueries({ queryKey: ["product-overview", identity] });
  }

  const save = useMutation({
    onMutate: () => {
      setSaving(true);
      document.body.classList.add("cursor-busy");
    },
    mutationFn: async (vars: { product: string; body: JsonObject; open: boolean }) => {
      const signal = owner.current.signal;
      signal.throwIfAborted();
      const fresh = await getConsumeDetails(vars.product, signal);
      signal.throwIfAborted();

      const bookings = await request<Booking[]>(
        `/api/stock/products/${vars.product}/${vars.open ? "open" : "consume"}`,
        {
          method: "POST",
          // Native Mark as opened shares jsonData across its pending details callbacks.
          body: JSON.stringify(vars.open ? openBody.current : vars.body),
          signal,
        },
      )
        .catch((reason: Error) => {
          if (!signal.aborted && !vars.open)
            genericError("Error while saving, probably this item already exists", reason);
          throw reason;
        })
        .finally(() =>
          Promise.all(
            [
              "stock",
              "products",
              "recipes",
              "recipe-fulfillment",
              "recipe-view",
              "recipe-overview",
              "shopping",
              "product-overview",
              "mealplan-calendar",
            ].map((key) => client.invalidateQueries({ queryKey: [key], refetchType: "none" })),
          ),
        );

      signal.throwIfAborted();

      if (!bookings[0]) throw new Error(t("The stock booking could not be read."));

      return { vars, fresh, transaction: bookings[0].transaction_id, signal };
    },
    onSuccess: async ({ vars, fresh, transaction, signal }) => {
      if (!alive.current || signal.aborted) return;

      try {
        if (!vars.open && scanState.current) playUiSound("success");

        if (!vars.open && consumeDocument.read("flow") === "InplaceAddBarcodeToExistingProduct") {
          const barcode: JsonObject = { product_id: vars.product };
          const rawBarcode = consumeDocument.read("barcode");

          if (rawBarcode !== undefined) barcode.barcode = rawBarcode;
          void request("/api/objects/product_barcodes", {
            method: "POST",
            body: JSON.stringify(barcode),
            signal,
          })
            .finally(() => {
              void client.invalidateQueries({ queryKey: ["stock"], refetchType: "none" });
              void client.invalidateQueries({ queryKey: ["product-related"], refetchType: "none" });
            })
            .then(() => {
              if (signal.aborted) return;

              try {
                consumeDocument.barcodeAdded();
                setBarcodeAdded(true);
              } catch (reason) {
                if (!signal.aborted) console.error(reason);
              }
            })
            .catch((reason: Error) => {
              if (signal.aborted) return;
              bookingBusy.current = false;
              setSaving(false);
              setFinished(false);
              setUnitRestored(true);
              setStockItemDisabled(false);
              document.body.classList.remove("cursor-busy");
              genericError("Error while saving, probably this item already exists", reason);
            });
        }

        const posted = Number(vars.body.amount);

        const removed = Math.abs(
          posted -
            (!vars.open &&
            fresh.product.enable_tare_weight_handling === 1 &&
            !vars.body.exact_amount
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

        const embedded = !vars.open && consumeDocument.read("embedded") !== undefined;

        if (!embedded || window.parent === window)
          notify({
            message,
            undo: async () => {
              await api.undoTransaction(transaction);
            },
          });

        setEntries([]);
        setSpecific(false);
        setStockId("");
        bookingBusy.current = false;

        if (!embedded) {
          // EndUiBusy enables all native controls, including an unchecked item picker.
          setSaving(false);
          setUnitRestored(true);
          setStockItemDisabled(false);
          document.body.classList.remove("cursor-busy");
        }

        if (embedded) {
          setFinished(true);

          if (window.parent !== window) {
            const quotedTransaction = JSON.stringify(transaction)
              .slice(1, -1)
              .replaceAll("'", "\\'");

            const undo = `<br><a class="btn btn-secondary btn-sm mt-2" href="#" onclick="UndoStockTransaction('${tableAttribute(quotedTransaction)}')"><i class="fa-solid fa-undo"></i> ${tableText(t("Undo"))}</a>`;
            getTopmostGrocyWindow().postMessage(
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
          if (!vars.open) {
            if (consumeDocument.read("flow") === "InplaceAddBarcodeToExistingProduct") {
              const selected = sourceValues.current.product;
              const rawBarcode = consumeDocument.read("barcode");
              setAdditionalBarcodes((current) => ({
                ...current,
                [selected]: `${current[selected] ?? ""}${rawBarcode},`,
              }));
            }

            consumeDocument.finishFlow();
          }

          setProduct("");
          currentCode.current = undefined;

          const nextAmount = nativeQuantityValue(
            preferences.useQuickConsumeAmount
              ? vars.open
                ? String((fresh.product.quick_consume_amount ?? 0) * sourceValues.current.factor)
                : ""
              : String(preferences.consumeAmount),
            precision,
          );

          setAmount(nextAmount);
          setConversionAmount(nextAmount);

          if (vars.open) {
            if (fresh.product.move_on_open === 1 && fresh.default_consume_location)
              notify({
                message: t("Moved to %1$s", fresh.default_consume_location.name),
                tone: "info",
              });
          } else {
            setSelection(undefined);
            setUnitId("");
            setUnits([]);
            unitChoices.current = [];
            sourceValues.current.factor = NaN;
            setMaximum(undefined);
            setLocation("");
            replaceSources([]);
            setRecipe("");
            sourceValues.current.recipe = "";
            setRecipeText("");
          }

          requestAnimationFrame(() => picker.current?.querySelector("input")?.focus());
        }

        if (!vars.open) await changed(fresh.product.id);

        if (!vars.open && alive.current && !signal.aborted) onClose?.();
      } catch (reason) {
        // Script errors inside a native success callback do not run the transport error handler.
        if (!signal.aborted) console.error(reason);
      }
    },
    onError: (reason: Error) => {
      if (!alive.current) return;
      bookingBusy.current = false;
      setSaving(false);
      setUnitRestored(true);
      setStockItemDisabled(false);
      document.body.classList.remove("cursor-busy");
      console.error(reason);
    },
  });

  function scanSubmit(singleUnit = true) {
    if (!scanState.current || bookingBusy.current) return;
    const data = currentDetails.current;

    if (!data) return;

    if (singleUnit) {
      setAmount("1");
      setConversionAmount("1");
      // The amount group also includes the unit select, whose change refreshes limits.
      setMaximum(limit(data, sourceValues.current.sum, sourceValues.current.factor));
    }

    const current = sourceValues.current;
    const display = Number(current.amount);
    const ceiling = current.maximum;

    const floor =
      data.product.enable_tare_weight_handling === 1 && !current.exact
        ? (data.product.tare_weight ?? 0)
        : minimum;

    if (
      !current.product ||
      !Number.isFinite(current.factor) ||
      !current.amount ||
      display < floor ||
      display !== Number(display.toFixed(precision)) ||
      (ceiling !== undefined && display > Number(ceiling)) ||
      (locationsEnabled && !current.location) ||
      (current.specific && !current.stockId)
    ) {
      notify({
        message: t("Scan mode is on but not all required fields could be populated automatically"),
        tone: "warning",
      });
      playUiSound("error");

      return;
    }

    if (recipeMenuState.current) return;

    const body: JsonObject = {
      amount: bookingAmount(conversionValue.current, current.factor),
      allow_subproduct_substitution: true,
      exact_amount: current.exact,
      spoiled: current.spoiled,
    };

    if (current.specific) body.stock_entry_id = current.stockId;

    if (locationsEnabled) body.location_id = current.location;

    if (recipesEnabled && current.recipe) body.recipe_id = current.recipe;
    bookingBusy.current = true;
    save.mutate({ product: current.product, body, open: false });
  }

  async function refreshLocation(value: string) {
    const signal = owner.current.signal;
    const selectedCode = currentCode.current;
    const embedded = consumeDocument.read("embedded") !== undefined;
    const forced = embedded ? consumeDocument.read("stockId") : selectedCode?.stockId;

    if (sourceValues.current.specific) setStockItemDisabled(true);
    setSpecific(false);
    setStockId("");
    setEntries([]);
    setLocation(value);
    const reloadStockCode = !embedded && selectedCode?.stockId !== undefined;

    if (!value && !reloadStockCode) {
      setSum(0);

      return;
    }

    setSourceLoading(true);

    try {
      if (reloadStockCode && selectedCode?.stockId !== undefined) {
        const stock = await getConsumeStockEntry(
          sourceValues.current.product,
          selectedCode.stockId,
          signal,
        );

        signal.throwIfAborted();

        if (!stock) return;
        value = String(stock.location_id);
        setLocation(value);
        // Native changes only the display input after this lookup.
        setAmount(String(stock.amount));
      }

      setSum(0);
      const rows = await getConsumeEntries(sourceValues.current.product, signal);
      signal.throwIfAborted();
      const located = rows.filter((row) => String(row.location_id) === value);
      setEntries((previous) => [...previous, ...located]);
      setSum(
        sourceValues.current.sum + located.reduce((total, row) => total + (row.amount || 0), 0),
      );

      for (const row of located) {
        const matches = forced === true ? Number(row.stock_id) === 1 : row.stock_id === forced;

        if (!matches) continue;
        const checked = !sourceValues.current.specific;
        setSpecific(checked);
        setStockItemDisabled(!checked);
        setStockId(String(forced));
      }

      // Both callbacks read the current picker, even for an older location response.
      const freshRead = getConsumeDetails(sourceValues.current.product, signal);

      if (!currentCode.current || currentCode.current.barcode.startsWith("grcy")) scanSubmit();
      const fresh = await freshRead;
      signal.throwIfAborted();
      applyDetails(fresh);
      setMaximum(limit(fresh, sourceValues.current.sum, sourceValues.current.factor));
    } catch (reason) {
      if (!signal.aborted) console.error(reason);
    } finally {
      if (!signal.aborted) setSourceLoading(false);
    }
  }

  async function selectProduct(value: string, selectedCode?: ProductCode) {
    // The React picker can repeat one text commit on input, Enter and blur.
    if (
      value === sourceValues.current.product &&
      !selectedCode &&
      (loadedSelection.current === value || selectionReads.current.has(value))
    )
      return;

    if (value && scanState.current) playUiSound("barcodescannerbeep");
    const signal = owner.current.signal;
    setProduct(value);
    currentCode.current = selectedCode;
    setLocation("");
    setEntries([]);
    setStockId("");

    if (sourceValues.current.specific) setStockItemDisabled(true);
    setSpecific(false);

    if (!value) return;
    loadedSelection.current = undefined;
    selectionReads.current.add(value);

    if (card === Number(value))
      void client.invalidateQueries({ queryKey: ["product-overview", Number(value)] });
    setCard(Number(value));
    setLoading(true);

    try {
      const fresh = await getConsumeDetails(value, signal);
      signal.throwIfAborted();
      loadedSelection.current = value;
      applyDetails(fresh);

      const choices = stockEditorUnits(
        catalog,
        String(fresh.product.id),
        fresh.quantity_unit_stock.id,
      );

      unitChoices.current = choices;
      setUnits(choices);
      const nextUnit = choices.find((row) => row.id === fresh.default_quantity_unit_consume?.id);
      setUnitId(nextUnit ? String(nextUnit.id) : "");
      sourceValues.current.factor = nextUnit?.factor ?? NaN;
      setUnitRestored(false);

      const nextAmount = nativeQuantityValue(
        preferences.useQuickConsumeAmount
          ? String((fresh.product.quick_consume_amount ?? 0) * sourceValues.current.factor)
          : String(preferences.consumeAmount),
        precision,
      );

      setAmount(nextAmount);
      setConversionAmount(nextAmount);
      setMaximum(limit(fresh, sourceValues.current.sum, sourceValues.current.factor));
      const preferred = fresh.product.default_consume_location_id || fresh.location?.id;
      replaceSources([]);
      setLocation("");
      setLoading(false);
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLInputElement>(`[id="${id}-amount"]`)?.focus(),
      );

      if (fresh.product.enable_tare_weight_handling === 1)
        setMaximum((fresh.stock_amount + (fresh.product.tare_weight ?? 0)).toFixed(precision));
      const locations = await getConsumeLocations(value, signal);
      signal.throwIfAborted();
      const seen = new Set<number>();
      let defaultAdded = false;
      let defaultAmount = 0;
      const locationReads: Promise<void>[] = [];

      for (const row of locations) {
        if (!seen.has(row.location_id)) {
          replaceSources([
            ...sourceOptions.current,
            { ...row, isDefault: row.location_id === preferred },
          ]);

          if (row.location_id === preferred) {
            locationReads.push(refreshLocation(String(preferred)));
            defaultAdded = true;
          }
        }

        if (row.location_id === preferred) defaultAmount += row.amount;
        seen.add(row.location_id);

        if (!defaultAdded)
          locationReads.push(
            refreshLocation(
              sourceOptions.current.some((option) => option.location_id === preferred)
                ? String(preferred)
                : "",
            ),
          );
      }

      if (defaultAmount === 0) {
        const first = sourceOptions.current[0];

        if (!first) throw new TypeError("Cannot set properties of undefined (setting 'selected')");
        locationReads.push(refreshLocation(String(first.location_id)));
      }

      const selectedBarcode = currentCode.current;

      const barcodeRead = selectedBarcode
        ? getConsumeBarcode(selectedBarcode.barcode, signal)
            .then((barcode) => {
              signal.throwIfAborted();

              if (!barcode) return;

              if (barcode.amount != null) setAmount(String(barcode.amount));

              if (barcode.qu_id != null) {
                const barcodeUnit = unitChoices.current.find((row) => row.id === barcode.qu_id);
                setUnitId(barcodeUnit ? String(barcodeUnit.id) : "");
                sourceValues.current.factor = barcodeUnit?.factor ?? NaN;
              }

              setConversionAmount(sourceValues.current.amount);
              const current = currentDetails.current;

              if (current)
                setMaximum(limit(current, sourceValues.current.sum, sourceValues.current.factor));
              // Native refreshes the visible value after the amount group has
              // already captured the hidden stock amount, then validates scans.
              setAmount(nativeQuantityValue(sourceValues.current.amount, precision));
              scanSubmit(false);
            })
            .catch((reason) => {
              if (!signal.aborted) console.error(reason);
            })
        : undefined;

      await Promise.all([...locationReads, barcodeRead]);
    } catch (reason) {
      if (!signal.aborted) console.error(reason);
    } finally {
      selectionReads.current.delete(value);

      if (!signal.aborted) setLoading(false);
    }
  }

  const start = useEffectEvent(() => {
    // ProductPicker's earlier bookmark events precede the Consume handlers.
    if (consumeDocument.read("embedded") === undefined) return;
    setProduct(initial ? String(initial.id) : "");
    const location = consumeDocument.read("locationId");

    if (location !== undefined) {
      const selected = catalog.locations.find((row) => String(row.id) === String(location));
      void refreshLocation(selected ? String(selected.id) : "");
      const checked = !sourceValues.current.specific;
      setSpecific(checked);
      setStockItemDisabled(!checked);
    }

    void selectProduct(sourceValues.current.product);
  });

  useEffect(() => {
    alive.current = true;
    owner.current = new AbortController();
    const frame = requestAnimationFrame(() => start());

    return () => {
      cancelAnimationFrame(frame);
      alive.current = false;
      owner.current.abort();
      document.body.classList.remove("cursor-busy");
    };
  }, []);

  const busy = pickerBusy || saving || finished;

  const valid =
    !!product &&
    !!details &&
    !!unit &&
    !!amount &&
    Number(amount) >= minimumAmount &&
    Number(amount) === Number(Number(amount).toFixed(precision)) &&
    (!Number.isFinite(Number(maximum)) || Number(amount) <= Number(maximum)) &&
    (!specific || !!stockId);

  useEffect(() => onPendingChange?.(saving), [saving, onPendingChange]);

  function submit(open = false) {
    if (busy || !valid || !form.current?.reportValidity() || recipeMenu) return;
    const body: JsonObject = { amount: postedAmount, allow_subproduct_substitution: true };

    if (specific) body.stock_entry_id = stockId;

    if (!open) {
      body.exact_amount = exact;
      body.spoiled = spoiled;

      if (locationsEnabled) body.location_id = location;

      if (recipesEnabled && recipe) body.recipe_id = recipe;
    }

    bookingBusy.current = true;

    if (open) openBody.current = body;
    save.mutate({ product, body, open });
  }

  const scan = useMutation({
    mutationFn: (enabled: boolean) => api.putUserSetting("scan_mode_consume_enabled", enabled),
    onSuccess: () => client.invalidateQueries({ queryKey: userSettingsQuery().queryKey }),
    onError: (reason: Error) => console.error(reason),
  });

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
        <fieldset className="picker-form-lock" disabled={externalBusy}>
          {!consumeDocument.serverEmbedded ? (
            <button
              type="button"
              className="btn"
              aria-pressed={scanEnabled}
              onClick={() => {
                const enabled = !scanState.current;
                scanState.current = enabled;
                setScanEnabled(enabled);

                if (enabled) playUiSound("silence");
                scan.mutate(enabled);
              }}
            >
              {t("Scan mode")} {t(scanEnabled ? "on" : "off")}
            </button>
          ) : null}
          <fieldset disabled={saving || finished}>
            <div ref={picker}>
              <ProductPicker
                products={catalog.products}
                barcodes={catalog.products.map((row) => ({
                  product_id: row.id,
                  barcodes: `${catalog.barcodes.find((entry) => entry.product_id === row.id)?.barcodes ?? ""}${additionalBarcodes[String(row.id)] ?? ""}`,
                }))}
                plugin={catalog.barcode_lookup_plugin_name}
                value={product}
                required
                disabled={busy}
                lookupDisabled={consumeDocument.read("flow") !== undefined}
                autoFocus
                allowCreate={false}
                deferSelection={scanEnabled}
                workflowPath={`/consume${consumeDocument.serverEmbedded ? "?embedded" : ""}`}
                onChange={(value, nextCode) => void selectProduct(value, nextCode)}
                onEmptyCommit={() => {
                  if (scanState.current) playUiSound("barcodescannerbeep");
                }}
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
                onAssignBarcode={consumeDocument.assignBarcode}
                onBusyChange={setPickerBusy}
                onFormBusyChange={setExternalBusy}
              />
            </div>
            {!barcodeAdded && options.flow === "InplaceAddBarcodeToExistingProduct" ? (
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
                    sourceValues.current.exact = event.target.checked;
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
                  disabled={pickerBusy || saving || finished}
                  min={minimumAmount}
                  max={maximum}
                  step={String(minimum)}
                  onChange={(value) => {
                    if (amountAtFocus.current && document.activeElement?.id === `${id}-amount`)
                      amountAtFocus.current.edited = true;
                    setAmount(value);
                    setConversionAmount(value);
                  }}
                  onFocus={(value) => {
                    amountAtFocus.current = { value, edited: false };
                  }}
                  onBlur={(value) => {
                    // Native change-on-blur follows a user edit, but not a
                    // programmatic-only value refresh after barcode lookup.
                    if (amountAtFocus.current?.edited && amountAtFocus.current.value !== value)
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
            {conversionAmount &&
            unit &&
            details &&
            unit.name !== details.quantity_unit_stock.name ? (
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
                  void refreshLocation(event.target.value);
                }}
              >
                <option value="" />
                {sources.map((row, index) => (
                  <option key={`${row.location_id}:${index}`} value={row.location_id}>
                    {row.location_name}
                    {row.isDefault ? ` (${t("Default location")})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={spoiled}
                disabled={busy}
                onChange={(event) => {
                  sourceValues.current.spoiled = event.target.checked;
                  setSpoiled(event.target.checked);
                }}
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
              <RecipePicker
                recipes={catalog.recipes}
                value={recipe}
                text={recipeText}
                disabled={busy}
                open={recipeMenu}
                onOpenChange={changeRecipeMenu}
                onChange={(value, text) => {
                  sourceValues.current.recipe = value;
                  setRecipe(value);
                  setRecipeText(text);
                }}
              />
            ) : null}
          </fieldset>
          {loading || sourceLoading ? <LoadingBlock /> : null}
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !valid}>
              {saving ? t("Saving…") : t("OK")}
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
              <button type="button" className="btn" disabled={saving} onClick={onClose}>
                {t("Cancel")}
              </button>
            ) : null}
          </div>
        </fieldset>
      </form>
      {!consumeDocument.serverEmbedded && card !== undefined ? (
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
