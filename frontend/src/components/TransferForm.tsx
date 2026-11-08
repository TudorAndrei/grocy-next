import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import moment from "moment/min/moment-with-locales.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGenericError } from "@/hooks/useGenericError";
import { useUserSettings } from "@/hooks/useUserSettings";
import { userSettingsQuery } from "@/hooks/queries";
import { useModalDialog } from "@/hooks/useModalDialog";
import { api, request } from "@/lib/api";
import { getTopmostGrocyWindow } from "@/lib/embedded-window";
import { useInvalidateStock } from "@/lib/catalog";
import { useI18n } from "@/lib/i18n";
import { unitLabel } from "@/lib/format";
import { usePreferences, preferenceEnabled } from "@/lib/preferences";
import { nativeQuantityValue } from "@/lib/native-quantity";
import { useTransferDocument, type TransferDocument } from "@/lib/transfer-document";
import type { Booking } from "@/lib/types";
import type { JsonObject } from "@/lib/json";
import { tableText, tableAttribute } from "@/lib/native-table-cell";
import {
  getTransferCatalog,
  getTransferDetails,
  getTransferEntries,
  getTransferLocations,
  getTransferBarcode,
  getTransferStockLocation,
  transferUnits,
  type TransferCatalog,
  type TransferEntry,
  type TransferOptions,
  type TransferDetails,
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
      <h2 id={title}>{t("Transfer")}</h2>
      <TransferForm
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

export function TransferForm(props: Props) {
  const document = useTransferDocument(props.options);

  return <TransferDocumentBody key={document.revision} {...props} document={document} />;
}

function TransferDocumentBody({ document, ...props }: Props & { document: TransferDocument }) {
  const { t } = useI18n();
  const settings = useQuery({ ...userSettingsQuery(), refetchOnMount: "always" });

  const catalog = useQuery({
    queryKey: ["stock", "transfer-editor"],
    queryFn: ({ signal }) => getTransferCatalog(signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  if (
    catalog.isSuccess &&
    catalog.isFetchedAfterMount &&
    settings.isSuccess &&
    settings.isFetchedAfterMount
  )
    return (
      <TransferFields
        {...props}
        document={document}
        options={document.initialOptions}
        catalog={catalog.data}
      />
    );

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
  document: transferDocument,
}: Props & { catalog: TransferCatalog; document: TransferDocument }) {
  const { t, pluralIndex } = useI18n();
  const preferences = usePreferences();
  const settings = useUserSettings();
  const rawDefaultAmount = settings.data?.stock_default_transfer_amount;

  const defaultAmount = nativeQuantityValue(
    String(rawDefaultAmount ?? ""),
    preferences.amountPrecision,
  );

  const client = useQueryClient();
  const invalidate = useInvalidateStock();
  const notify = useNotify();
  const genericError = useGenericError();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const productField = useRef<HTMLDivElement>(null);
  const initialAmountConverted = useRef(false);
  const owner = useRef(new AbortController());
  const alive = useRef(true);
  const code = useRef<ProductCode>(undefined);
  const lastCommit = useRef<string>(undefined);
  const [options] = useState(initialOptions);
  const [barcodeAdded, setBarcodeAdded] = useState(false);
  const [additionalBarcodes, setAdditionalBarcodes] = useState<Record<string, string>>({});
  const prefillName = options["product-name"];

  const namedProduct =
    prefillName === undefined || prefillName === ""
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

  const [productId, updateProduct] = useState(initialProduct ? String(initialProduct.id) : "");
  const [details, setDetails] = useState<TransferDetails>();
  const [amount, updateAmount] = useState(defaultAmount);
  const [postedAmount, setPostedAmount] = useState("NaN");
  const [conversionInfo, setConversionInfo] = useState<string>();
  const [units, setUnits] = useState<ReturnType<typeof transferUnits>>([]);
  const [unitId, updateUnit] = useState("");
  const [unitRestored, setUnitRestored] = useState(false);
  const [sources, setSources] = useState(catalog.locations);
  const [from, updateFrom] = useState("");
  const [to, updateTo] = useState("");
  const [specific, updateSpecific] = useState(false);
  const [specificRestored, setSpecificRestored] = useState(false);
  const [stockId, setStockId] = useState("");
  const [entries, setEntries] = useState<TransferEntry[]>([]);
  const [maximum, setMaximum] = useState<string>();
  const [pickerBusy, setPickerBusy] = useState(false);
  const [externalBusy, setExternalBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [finishedEmbedded, setFinishedEmbedded] = useState(false);
  const [productError, setProductError] = useState("");
  const [toError, setToError] = useState("");
  const [cardProduct, setCardProduct] = useState<number>();
  const [expanded, setExpanded] = useState(false);
  const unit = units.find((row) => String(row.id) === unitId);
  const factor = unit?.factor ?? NaN;
  const precision = preferences.amountPrecision;
  const minimum = precision > 0 ? 10 ** -precision : 1;

  const live = useRef({
    productId,
    from,
    to,
    amount,
    factor,
    unitId,
    sources,
    entries,
    details,
    units,
    specific,
  });

  useLayoutEffect(() => {
    live.current = {
      productId,
      from,
      to,
      amount,
      factor,
      unitId,
      sources,
      entries,
      details,
      units,
      specific,
    };
  });

  function setProductId(value: string) {
    live.current.productId = value;
    updateProduct(value);
  }

  function setFrom(value: string) {
    live.current.from = value;
    updateFrom(value);
  }

  function setTo(value: string) {
    live.current.to = value;
    updateTo(value);
  }

  function setSpecific(value: boolean) {
    live.current.specific = value;
    setSpecificRestored(false);
    updateSpecific(value);
  }

  function setAmount(value: string) {
    live.current.amount = value;
    updateAmount(value);
  }

  function setUnitId(value: string) {
    live.current.factor = live.current.units.find((row) => String(row.id) === value)?.factor ?? NaN;
    live.current.unitId = value;
    updateUnit(value);
  }

  function convertAmount() {
    const destination = Number(live.current.amount) / live.current.factor;
    setPostedAmount(destination.toFixed(Math.max(1, precision)).replace(/0*$/g, ""));
    const selected = live.current.units.find((row) => String(row.id) === live.current.unitId);
    const stockUnit = live.current.details?.quantity_unit_stock;

    setConversionInfo(
      live.current.amount && selected && stockUnit && selected.name !== stockUnit.name
        ? t(
            "This equals %1$s %2$s",
            destination.toLocaleString(),
            unitLabel(
              {
                ...stockUnit,
                plural_forms: catalog.units.find((row) => row.name === stockUnit.name)
                  ?.plural_forms,
              },
              destination,
              pluralIndex,
              false,
            ),
          )
        : undefined,
    );
  }

  function logFailure(reason: Error) {
    if (!owner.current.signal.aborted) console.error(reason);
  }

  const readEntries = useMutation({
    mutationFn: async (vars: {
      product: string;
      from: string;
      forced?: string | true;
      signal: AbortSignal;
      rebuild: boolean;
    }) => ({ rows: await getTransferEntries(vars.product, vars.signal), vars }),
    onSuccess: ({ rows, vars }) => {
      if (vars.signal.aborted) return;

      const located = rows.filter(
        (row) => String(row.location_id) === (vars.rebuild ? vars.from : live.current.from),
      );

      if (vars.rebuild) {
        setEntries((current) => {
          const next = [...current];

          for (const row of located)
            if (!next.some((entry) => entry.stock_id === row.stock_id)) next.push(row);
          live.current.entries = next;

          return next;
        });

        for (const row of located) if (row.stock_id === vars.forced) setStockId(row.stock_id);
      }

      setMaximum(
        (located.reduce((sum, row) => sum + row.amount, 0) * live.current.factor).toFixed(
          precision,
        ),
      );
    },
    onError: (reason: Error, vars) => {
      if (!vars.signal.aborted) console.error(reason);
    },
  });

  function refreshSource(value: string, { rebuild = true, recheck = true } = {}) {
    let forced =
      transferDocument.read("embedded") !== undefined
        ? transferDocument.read("stockId")
        : undefined;

    if (code.current?.stockId !== undefined) forced = code.current.stockId;

    if (rebuild) {
      setEntries([]);
      live.current.entries = [];
      setStockId("");

      if (recheck && forced !== undefined && !live.current.specific) setSpecific(true);
    }

    if (value)
      readEntries.mutate({
        product: live.current.productId,
        from: value,
        forced,
        signal: owner.current.signal,
        rebuild,
      });
  }

  function changeFrom(value: string) {
    setFrom(value);

    if (value === live.current.to) setTo("");
    refreshSource(value);
  }

  const load = useMutation({
    mutationFn: async (vars: { product: string; signal: AbortSignal }) => ({
      data: await getTransferDetails(vars.product, vars.signal),
      vars,
    }),
    onSuccess: ({ data, vars }) => {
      if (vars.signal.aborted) return;
      const choices = transferUnits(catalog, String(data.product.id), data.quantity_unit_stock.id);
      const priorStock = live.current.details?.stock_amount ?? NaN;
      setDetails(data);
      live.current.details = data;
      setUnits(choices);
      live.current.units = choices;
      setUnitRestored(false);

      if (!initialAmountConverted.current) {
        initialAmountConverted.current = true;
        setAmount("");
        live.current.factor = NaN;
        live.current.unitId = "";
      } else {
        live.current.factor = choices[0]?.factor ?? NaN;
        live.current.unitId = choices[0] ? String(choices[0].id) : "";
      }

      convertAmount();
      setMaximum((priorStock * live.current.factor).toFixed(precision));
      setUnitId(
        choices.some((row) => row.id === data.quantity_unit_stock.id)
          ? String(data.quantity_unit_stock.id)
          : "",
      );

      if (data.product.enable_tare_weight_handling === 1) {
        setProductError(
          t("Products with tare weight enabled are currently not supported for transfer"),
        );
        selectProduct("");
        requestAnimationFrame(() => productField.current?.querySelector("input")?.focus());

        return;
      }

      setSources([]);
      live.current.sources = [];
      setFrom("");
      void getTransferLocations(vars.product, vars.signal)
        .then((locations) => {
          if (vars.signal.aborted) return;
          const next: typeof sources = [];
          let defaultSet = false;

          for (const row of locations) {
            const isDefault = row.location_id === data.location?.id;
            next.push({
              id: row.location_id,
              name: row.location_name + (isDefault ? ` (${t("Default location")})` : ""),
              is_freezer: row.location_is_freezer,
            });
            live.current.sources = [...next];
            setSources([...next]);

            if (isDefault) {
              changeFrom(String(row.location_id));
              defaultSet = true;
            } else if (!defaultSet) changeFrom(String(row.location_id));
          }

          const rawFrom = transferDocument.read("locationId");

          if (rawFrom !== undefined)
            changeFrom(
              next.some((row) => String(row.id) === String(rawFrom)) ? String(rawFrom) : "",
            );
        })
        .catch(logFailure);
      const selectedCode = code.current;

      if (selectedCode)
        void getTransferBarcode(selectedCode.barcode, vars.signal)
          .then((barcode) => {
            if (vars.signal.aborted || !barcode) return;

            if (barcode.amount !== null) setAmount(String(barcode.amount));

            if (barcode.qu_id !== null)
              setUnitId(
                live.current.units.some((row) => row.id === barcode.qu_id)
                  ? String(barcode.qu_id)
                  : "",
              );
            convertAmount();
            setMaximum(
              ((live.current.details?.stock_amount ?? NaN) * live.current.factor).toFixed(
                precision,
              ),
            );
            // Locale refresh follows the group's hidden amount and help snapshot.
            setAmount(nativeQuantityValue(live.current.amount, precision));
          })
          .catch(logFailure);

      if (selectedCode?.stockId !== undefined)
        void getTransferStockLocation(selectedCode.stockId, vars.signal)
          .then((location) => {
            if (vars.signal.aborted) return;
            setFrom(
              live.current.sources.some((row) => row.id === location) ? String(location) : "",
            );
          })
          .catch(logFailure);
      setProductError("");
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLInputElement>(`[id="${id}-amount"]`)?.focus(),
      );
    },
    onError: (reason: Error, vars) => {
      if (!vars.signal.aborted) console.error(reason);
    },
  });

  function selectProduct(value: string, nextCode?: ProductCode) {
    if (value === live.current.productId && !nextCode && lastCommit.current === value) return;
    lastCommit.current = value;
    setProductId(value);
    code.current = nextCode;
    setEntries([]);
    live.current.entries = [];
    setStockId("");
    const rawStock = transferDocument.read("stockId");

    if (rawStock === undefined) {
      if (live.current.specific) {
        setSpecific(false);
        refreshSource(live.current.from, { recheck: false });
      }

      setFrom("");
    }

    setTo("");
    setToError("");

    if (!value) return;
    setCardProduct(Number(value));
    load.mutate({ product: value, signal: owner.current.signal });
  }

  const start = useEffectEvent(() => {
    if (transferDocument.read("embedded") === undefined) return;
    const rawFrom = transferDocument.read("locationId");

    if (rawFrom !== undefined) {
      changeFrom(
        live.current.sources.some((row) => String(row.id) === String(rawFrom))
          ? String(rawFrom)
          : "",
      );
      setSpecific(!live.current.specific);

      if (!live.current.specific) refreshSource(live.current.from, { recheck: false });

      // jQuery's explicit second change observes the unchecked reentrant click.
      if (!live.current.specific) refreshSource(live.current.from);
    }

    selectProduct(initialProduct ? String(initialProduct.id) : "");
  });

  useEffect(() => {
    alive.current = true;
    owner.current = new AbortController();
    // Install the native document's initial picker events once.
    // eslint-disable-next-line react/set-state-in-effect
    start();

    return () => {
      alive.current = false;
      owner.current.abort();
      document.body.classList.remove("cursor-busy");
    };
  }, []);

  async function changed(product: number) {
    await invalidate(product);
    await client.invalidateQueries({ queryKey: ["product-overview", product] });
    await onChanged?.(product);
  }

  function endBusy() {
    setSaving(false);
    setFinishedEmbedded(false);
    setUnitRestored(true);
    setSpecificRestored(true);
    document.body.classList.remove("cursor-busy");
  }

  const save = useMutation({
    onMutate: () => {
      setSaving(true);
      document.body.classList.add("cursor-busy");
    },
    mutationFn: async (vars: { product: string; body: JsonObject }) => {
      const signal = owner.current.signal;
      signal.throwIfAborted();
      const product = await getTransferDetails(vars.product, signal);
      signal.throwIfAborted();

      const bookings = await request<Booking[]>(`/api/stock/products/${vars.product}/transfer`, {
        method: "POST",
        body: JSON.stringify(vars.body),
        signal,
      }).finally(() =>
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

      return { product, bookings, vars, signal };
    },
    onSuccess: async ({ product, bookings, vars, signal }) => {
      if (signal.aborted) return;

      if (transferDocument.read("flow") === "InplaceAddBarcodeToExistingProduct") {
        const barcode: JsonObject = { product_id: vars.product };
        const raw = transferDocument.read("barcode");

        if (raw !== undefined) barcode.barcode = raw;
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
              transferDocument.barcodeAdded();
              setBarcodeAdded(true);
            } catch (reason) {
              console.error(reason);
            }
          })
          .catch((reason: Error) => {
            if (signal.aborted) return;
            endBusy();
            genericError("Error while saving, probably this item already exists", reason);
          });
      }

      const posted = Number(vars.body.amount);

      const quantity = Math.abs(
        posted -
          (product.product.enable_tare_weight_handling === 1
            ? (product.product.tare_weight ?? 0)
            : 0),
      );

      const source = live.current.sources.find((row) => String(row.id) === live.current.from);
      const destination = catalog.locations.find((row) => String(row.id) === live.current.to);

      const message = t(
        "Transfered %1$s of %2$s from %3$s to %4$s",
        `${quantity} ${unitLabel({ ...product.quantity_unit_stock, plural_forms: catalog.units.find((row) => row.name === product.quantity_unit_stock.name)?.plural_forms }, posted, pluralIndex, false)}`,
        product.product.name,
        source?.name ?? "",
        destination?.name ?? "",
      );

      const transaction = bookings[0]?.transaction_id;
      const embedded = transferDocument.read("embedded") !== undefined;

      if (embedded) {
        setFinishedEmbedded(true);

        if (window.parent !== window) {
          const undo = transaction
            ? `<br><a class="btn btn-secondary btn-sm mt-2" href="#" onclick="UndoStockTransaction(${tableAttribute(JSON.stringify(transaction))})"><i class="fa-solid fa-undo"></i> ${tableText(t("Undo"))}</a>`
            : "";

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
      } else endBusy();

      if (!embedded || window.parent === window)
        notify({
          message,
          undo: transaction
            ? async () => {
                await api.undoTransaction(transaction);
                await changed(product.product.id);
              }
            : undefined,
        });

      if (!embedded) {
        if (transferDocument.read("flow") === "InplaceAddBarcodeToExistingProduct") {
          const selected = live.current.productId;
          const raw = transferDocument.read("barcode");
          setAdditionalBarcodes((current) => ({
            ...current,
            [selected]: `${current[selected] ?? ""}${raw},`,
          }));
        }

        transferDocument.finishFlow();

        if (source?.is_freezer === 0 && destination?.is_freezer === 1) {
          notify({ message: t("Frozen"), tone: "info" });

          if (preferenceEnabled(product.product.should_not_be_frozen))
            notify({ message: t("This product shouldn't be frozen"), tone: "warning" });
        }

        if (source?.is_freezer === 1 && destination?.is_freezer === 0)
          notify({ message: t("Thawed"), tone: "info" });
        setEntries([]);
        live.current.entries = [];
        setStockId("");
        const wasSpecific = live.current.specific;
        setSpecific(false);

        if (wasSpecific) refreshSource(live.current.from, { recheck: false });
        setUnits([]);
        live.current.units = [];
        setUnitId("");
        setSources([]);
        live.current.sources = [];
        setFrom("");
        setTo("");
        setMaximum(undefined);
        setAmount(defaultAmount);
        convertAmount();
        setProductId("");
        code.current = undefined;
        lastCommit.current = undefined;
        requestAnimationFrame(() => productField.current?.querySelector("input")?.focus());
      }

      if (alive.current) onClose?.();
      await changed(product.product.id);
    },
    onError: (reason: Error) => {
      if (alive.current) {
        endBusy();
        console.error(reason);
      }
    },
  });

  useEffect(() => onPendingChange?.(saving), [saving, onPendingChange]);
  const busy = saving || finishedEmbedded || pickerBusy;

  const valid =
    !!productId &&
    !!from &&
    !!to &&
    !!unit &&
    !!amount &&
    Number(amount) >= minimum &&
    Number(amount) === Number(Number(amount).toFixed(precision)) &&
    (maximum === undefined || Number.isNaN(Number(maximum)) || Number(amount) <= Number(maximum)) &&
    (!specific || !!stockId);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busy || !valid || !event.currentTarget.reportValidity()) return;
    const body: JsonObject = { amount: postedAmount, location_id_from: from, location_id_to: to };

    if (specific) body.stock_entry_id = stockId;
    save.mutate({ product: productId, body });
  }

  return (
    <div className="transfer-layout">
      <form
        ref={form}
        className="move-form transfer-form"
        aria-label={t("Transfer")}
        onSubmit={submit}
      >
        <fieldset className="picker-form-lock" disabled={externalBusy}>
          <fieldset disabled={saving || finishedEmbedded}>
            <div ref={productField}>
              <ProductPicker
                products={catalog.products}
                barcodes={catalog.products.map((row) => ({
                  product_id: row.id,
                  barcodes: `${catalog.barcodes.find((entry) => entry.product_id === row.id)?.barcodes ?? ""}${additionalBarcodes[String(row.id)] ?? ""}`,
                }))}
                plugin={catalog.barcode_lookup_plugin_name}
                value={productId}
                required
                disabled={busy}
                lookupDisabled={transferDocument.read("flow") !== undefined}
                autoFocus
                allowCreate={false}
                workflowPath={`/transfer${transferDocument.serverEmbedded ? "?embedded" : ""}`}
                onChange={selectProduct}
                onResolved={() =>
                  requestAnimationFrame(() =>
                    form.current?.querySelector<HTMLInputElement>(`[id="${id}-amount"]`)?.focus(),
                  )
                }
                onAssignBarcode={transferDocument.assignBarcode}
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
            <label className="field">
              <span>{t("From location")}</span>
              <select
                required
                disabled={busy}
                value={from}
                onChange={(event) => {
                  changeFrom(event.target.value);
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
                    setAmount(value);
                    convertAmount();
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
                    convertAmount();
                    setMaximum(
                      (
                        (details?.stock_amount ?? NaN) *
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
            {conversionInfo !== undefined ? <p className="field-help">{conversionInfo}</p> : null}
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
                disabled={busy || (!specific && !specificRestored)}
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
          {productError ? <p role="status">{productError}</p> : null}
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {saving ? t("Saving…") : t("OK")}
            </button>
            {onClose ? (
              <button type="button" className="btn" disabled={saving} onClick={onClose}>
                {t("Cancel")}
              </button>
            ) : null}
          </div>
        </fieldset>
      </form>
      {!transferDocument.serverEmbedded && cardProduct !== undefined ? (
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
