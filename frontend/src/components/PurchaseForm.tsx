import { useEffect, useEffectEvent, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userSettingsQuery } from "@/hooks/queries";
import { useModalDialog } from "@/hooks/useModalDialog";
import { api, request } from "@/lib/api";
import { useInvalidateStock } from "@/lib/catalog";
import { isoDay, unitLabel } from "@/lib/format";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { stockEditorUnits } from "@/lib/stock-editor";
import {
  getPurchaseCatalog,
  getPurchaseDetails,
  getPurchaseSelection,
  type PurchaseCatalog,
  type PurchaseDetails,
  type PurchaseOptions,
} from "@/lib/purchase";
import { initialUserfields, saveUserfields } from "@/lib/userfields";
import { printLabel } from "@/lib/printing";
import { tableText, tableAttribute } from "@/lib/native-table-cell";
import type { JsonObject } from "@/lib/json";
import type { Booking } from "@/lib/types";
import { ProductPicker, type ProductCode } from "./ProductPicker";
import { ProductCard } from "./ProductOverview";
import { NumberPicker } from "./NumberPicker";
import { BookingDateInput } from "./BookingDateInput";
import { UserfieldsEditor } from "./UserfieldsEditor";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { useNotify } from "./Toaster";

type Props = {
  options: PurchaseOptions;
  onClose?: () => void;
  onPendingChange?: (pending: boolean) => void;
  onOptionsChange?: (options: PurchaseOptions) => void;
};

export function PurchaseDialog(props: Omit<Props, "onPendingChange">) {
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
      <h2 id={title}>{t("Purchase")}</h2>
      <PurchaseForm {...props} onPendingChange={setPending} />
    </dialog>
  );
}

export function PurchaseForm(props: Props) {
  const { t } = useI18n();
  const settings = useQuery(userSettingsQuery());

  const catalog = useQuery({
    queryKey: ["stock", "purchase-editor"],
    queryFn: ({ signal }) => getPurchaseCatalog(signal),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (catalog.isSuccess && catalog.isFetchedAfterMount && settings.isSuccess)
    return <PurchaseFields {...props} catalog={catalog.data} />;

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

type Receipt = {
  bookings: (Booking & { stock_id: string })[];
  details: PurchaseDetails;
  body: JsonObject;
  product: string;
  amount: string;
};

function PurchaseFields({
  catalog,
  options: initialOptions,
  onClose,
  onPendingChange,
  onOptionsChange,
}: Props & { catalog: PurchaseCatalog }) {
  const { t, pluralIndex } = useI18n();
  const features = useFeatures();
  const preferences = usePreferences();
  const client = useQueryClient();
  const invalidate = useInvalidateStock();
  const notify = useNotify();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const dueInput = useRef<HTMLInputElement>(null);
  const read = useRef<AbortController>(undefined);
  const version = useRef(0);
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
  const [details, setDetails] = useState<PurchaseDetails>();
  const [code, setCode] = useState<ProductCode>();
  const [amount, setAmount] = useState(String(preferences.purchaseAmount));
  const [unitId, setUnitId] = useState("");
  const [location, setLocation] = useState("");
  const [store, setStore] = useState("");
  const [due, setDue] = useState("");
  const [purchased, setPurchased] = useState(isoDay);
  const [price, setPrice] = useState("");
  const [totalPrice, setTotalPrice] = useState(false);
  const [note, setNote] = useState("");
  const [label, setLabel] = useState("0");
  const [usedBarcode, setUsedBarcode] = useState<number>();
  const [fields, setFields] = useState(() => initialUserfields(catalog.fields, {}, true));
  const [error, setError] = useState<{ message: string; retry?: boolean }>();
  const [pickerBusy, setPickerBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [receipt, setReceipt] = useState<Receipt>();
  const booked = useRef<Receipt>(undefined);
  const labelsStarted = useRef(false);
  const barcodeSaved = useRef(false);
  const [card, setCard] = useState(initial?.id);
  const [expanded, setExpanded] = useState(false);
  const priceEnabled = features.enabled("STOCK_PRICE_TRACKING");
  const datesEnabled = features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING");
  const locationsEnabled = features.enabled("STOCK_LOCATION_TRACKING");
  const labelsEnabled = features.enabled("LABEL_PRINTER");
  const scanEnabled = options.embedded === undefined && preferences.scanPurchase;
  const precision = preferences.amountPrecision;
  const minimum = precision > 0 ? 10 ** -precision : 1;
  const units = details ? stockEditorUnits(catalog, product, details.quantity_unit_stock.id) : [];
  const unit = units.find((row) => String(row.id) === unitId);
  const factor = unit?.factor ?? NaN;

  const postedAmount = (Number(amount) / factor)
    .toFixed(Math.max(1, precision))
    .replace(/0*$/g, "");

  const tare = details?.product.enable_tare_weight_handling === 1;
  const tareWeight = details?.product.tare_weight ?? 0;
  const minimumAmount = tare ? tareWeight / factor + (details?.stock_amount ?? 0) : minimum;

  function fillDate(data: PurchaseDetails, selected: { is_freezer: number } | null | undefined) {
    if (!datesEnabled) return;

    const days =
      features.enabled("STOCK_PRODUCT_FREEZING") && selected?.is_freezer
        ? data.product.default_best_before_days_after_freezing
        : data.product.default_best_before_days;

    if (days != null && days !== 0) setDue(days === -1 ? "2999-12-31" : isoDay(days));
  }

  const load = useMutation({
    mutationFn: async (vars: {
      product: string;
      code?: ProductCode;
      version: number;
      signal: AbortSignal;
    }) => ({
      data: await getPurchaseSelection(vars.product, vars.signal, vars.code?.barcode),
      vars,
    }),
    onSuccess: ({ data, vars }) => {
      if (vars.version !== version.current || vars.signal.aborted) return;
      const selected = data.details;
      const choices = stockEditorUnits(catalog, vars.product, selected.quantity_unit_stock.id);

      const defaultUnit =
        selected.product.enable_tare_weight_handling === 1
          ? selected.quantity_unit_stock.id
          : selected.default_quantity_unit_purchase?.id;

      const defaultFactor = choices.find((row) => row.id === defaultUnit)?.factor ?? NaN;
      let nextUnit = defaultUnit;
      let nextAmount = String(preferences.purchaseAmount);

      if (options.flow === "shoppinglistitemtostock") {
        nextUnit = Number(options.quId);
        nextAmount = String(
          Number.parseFloat(options.amount ?? "") *
            (choices.find((row) => row.id === nextUnit)?.factor ?? NaN),
        );
      }

      const barcode = data.barcode;

      if (barcode?.qu_id) nextUnit = barcode.qu_id;

      if (barcode?.amount) nextAmount = String(barcode.amount);

      if (scanEnabled && !vars.code) nextAmount = "1";
      setDetails(selected);
      setUnitId(choices.some((row) => row.id === nextUnit) ? String(nextUnit) : "");
      setAmount(nextAmount);
      setLocation(
        catalog.locations.some((row) => row.id === selected.location?.id)
          ? String(selected.location!.id)
          : "",
      );

      const selectedStore =
        priceEnabled && barcode?.shopping_location_id != null
          ? barcode.shopping_location_id
          : (selected.last_shopping_location_id ?? selected.default_shopping_location_id);

      setStore(catalog.stores.some((row) => row.id === selectedStore) ? String(selectedStore) : "");
      setPrice(
        barcode?.last_price
          ? String(barcode.last_price)
          : selected.last_price
            ? (selected.last_price / defaultFactor).toFixed(preferences.priceDisplayPrecision)
            : "",
      );

      if (barcode?.last_price) setTotalPrice(true);
      else if (
        selected.product.default_purchase_price_type === 2 ||
        selected.product.default_purchase_price_type === 3
      )
        setTotalPrice(selected.product.default_purchase_price_type === 3);

      if (barcode?.note) setNote(barcode.note);
      setUsedBarcode(barcode?.id);
      setLabel(String(selected.product.default_stock_label_type ?? 0));
      fillDate(selected, selected.location);
      autoSubmit.current =
        scanEnabled ||
        (options.flow === "shoppinglistitemtostock" && preferences.shoppingPurchaseAutoSubmit);
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLInputElement>(`[id="${id}-amount"]`)?.focus(),
      );
    },
    onError: (reason: Error, vars) => {
      if (vars.version === version.current && !vars.signal.aborted)
        setError({ message: reason.message, retry: true });
    },
  });

  function selectProduct(value: string, selectedCode?: ProductCode) {
    if (product === value && !selectedCode && (details || load.isPending)) return;
    read.current?.abort();
    const current = ++version.current;
    setProduct(value);
    setCode(selectedCode);
    setDetails(undefined);
    setError(undefined);
    booked.current = undefined;
    setReceipt(undefined);
    labelsStarted.current = false;
    barcodeSaved.current = false;

    if (!value) return;
    setCard(Number(value));
    read.current = new AbortController();
    load.mutate({
      product: value,
      code: selectedCode,
      version: current,
      signal: read.current.signal,
    });
  }

  const start = useEffectEvent(() => {
    if (!initial) return;

    // Native product-link events run before the purchase handler is installed.
    // The page triggers a second event only for embedded or creation workflows.
    if (
      options.embedded === undefined &&
      options.flow !== "InplaceNewProductWithName" &&
      options.flow !== "InplaceAddBarcodeToExistingProduct"
    )
      return;
    read.current = new AbortController();
    load.mutate({
      product: String(initial.id),
      version: ++version.current,
      signal: read.current.signal,
    });
  });

  useEffect(() => {
    alive.current = true;
    start();

    return () => {
      alive.current = false;
      read.current?.abort();
    };
  }, []);

  async function changed(identity: number) {
    await invalidate();
    await client.invalidateQueries({ queryKey: ["product-overview", identity] });
  }

  const save = useMutation({
    mutationFn: async (body: JsonObject) => {
      if (!booked.current) {
        const fresh = await getPurchaseDetails(product);

        const bookings = await request<Receipt["bookings"]>(`/api/stock/products/${product}/add`, {
          method: "POST",
          body: JSON.stringify(body),
        });

        if (!bookings[0]) throw new Error(t("The stock booking could not be read."));
        booked.current = { details: fresh, bookings, body, product, amount };
        setReceipt(booked.current);
      }

      const saved = booked.current;
      const first = saved.bookings[0]!;

      if (!barcodeSaved.current) {
        if (usedBarcode !== undefined) {
          void request(`/api/objects/product_barcodes/${usedBarcode}`, {
            method: "PUT",
            body: JSON.stringify({ last_price: priceEnabled ? price : "0" }),
          }).catch((reason: Error) => notify({ message: reason.message, tone: "error" }));
        }

        if (
          options.flow === "InplaceAddBarcodeToExistingProduct" &&
          options.barcode !== undefined
        ) {
          const barcode: JsonObject = {
            barcode: options.barcode,
            product_id: saved.product,
            qu_id: unitId,
            amount: saved.amount,
            note,
          };

          if (priceEnabled) barcode.shopping_location_id = store;
          void api
            .action("/api/objects/product_barcodes", barcode)
            .then(() => {
              if (options.embedded !== undefined || !alive.current) return;
              setOptions({});
              onOptionsChange?.({});
            })
            .catch((reason: Error) => notify({ message: reason.message, tone: "error" }));
        }

        barcodeSaved.current = true;
      }

      const serverLabels = features.query.data?.LABEL_PRINTER_RUN_SERVER;

      const browserLabels =
        serverLabels === false ||
        serverLabels === 0 ||
        serverLabels === "0" ||
        serverLabels === "" ||
        serverLabels === null;

      if (labelsEnabled && browserLabels && Number(label) > 0 && !labelsStarted.current) {
        labelsStarted.current = true;

        const entries =
          label === "2"
            ? await request<{ stock_id: string }[]>(
                `/api/stock/transactions/${first.transaction_id}`,
              )
            : [first];

        for (const entry of entries) {
          void printLabel(
            `/api/stock/entry/${encodeURIComponent(entry.stock_id)}/printlabel`,
            features.query.data ?? {},
          ).catch((reason: Error) => notify({ message: reason.message, tone: "error" }));
        }
      }

      await saveUserfields("stock", first.transaction_id, catalog.fields, fields, (name, value) =>
        setFields((current) => ({ ...current, [name]: value })),
      );

      return saved;
    },
    onSuccess: async (saved) => {
      const first = saved.bookings[0]!;

      const added =
        Number(saved.body.amount) -
        (saved.details.product.enable_tare_weight_handling === 1
          ? saved.details.stock_amount + (saved.details.product.tare_weight ?? 0)
          : 0);

      const unit = {
        ...saved.details.quantity_unit_stock,
        plural_forms: catalog.units.find((row) => row.id === saved.details.quantity_unit_stock.id)
          ?.plural_forms,
      };

      const message = t(
        "Added %1$s of %2$s to stock",
        `${added.toLocaleString()} ${unitLabel(unit, added, pluralIndex, false)}`,
        saved.details.product.name,
      );

      notify({
        message,
        undo: async () => {
          await api.undoTransaction(first.transaction_id);
          await changed(saved.details.product.id);
        },
      });

      if (options.embedded !== undefined) {
        setFinished(true);

        if (window.parent !== window) {
          const undo = `<br><a class="btn btn-secondary btn-sm mt-2" href="#" onclick="UndoStockTransaction(${tableAttribute(JSON.stringify(first.transaction_id))})"><i class="fa-solid fa-undo"></i> ${tableText(t("Undo"))}</a>`;
          window.top?.postMessage(
            {
              Message: "BroadcastMessage",
              Payload: { Message: "ProductChanged", Payload: saved.product },
            },
            window.location.origin,
          );
          window.parent.postMessage(
            { Message: "AfterItemAdded", Payload: options.listitemid ?? null },
            window.location.origin,
          );
          window.parent.postMessage(
            { Message: "ShowSuccessMessage", Payload: tableText(message) + undo },
            window.location.origin,
          );
          window.parent.postMessage({ Message: "Ready", Payload: null }, window.location.origin);
          window.parent.postMessage(
            { Message: "CloseLastModal", Payload: null },
            window.location.origin,
          );
        }
      } else {
        if (
          preferences.warnEarlierPurchase &&
          datesEnabled &&
          saved.details.next_due_date &&
          String(saved.body.best_before_date) < saved.details.next_due_date
        )
          notify({ message: t("This is due earlier than already in stock items"), tone: "error" });
        selectProduct("");
        setAmount(String(preferences.purchaseAmount));
        setUnitId("");
        setDue("");
        setPrice("");
        setStore("");
        setLocation("");
        setNote("");
        setLabel("0");
        setUsedBarcode(undefined);
        setFields(initialUserfields(catalog.fields, {}, true));

        if (options.flow !== undefined) {
          const next: PurchaseOptions = { ...options };
          delete next.flow;
          delete next.barcode;
          delete next["product-name"];
          setOptions(next);
          onOptionsChange?.(next);
        }

        requestAnimationFrame(() => picker.current?.querySelector("input")?.focus());
      }

      await changed(saved.details.product.id);
      onClose?.();
    },
    onError: (reason: Error) => setError({ message: reason.message }),
  });

  const busy =
    load.isPending ||
    save.isPending ||
    pickerBusy ||
    finished ||
    (receipt !== undefined && save.isError);

  const locked = save.isPending || receipt !== undefined || finished;

  const validAmount =
    !!amount &&
    Number(amount) >= minimumAmount &&
    Number(amount) === Number(Number(amount).toFixed(precision));

  useEffect(() => onPendingChange?.(save.isPending), [save.isPending, onPendingChange]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      busy ||
      (!receipt && (!details || !unit || !validAmount)) ||
      !event.currentTarget.reportValidity()
    )
      return;
    setError(undefined);
    let cost = (Number(price) * factor).toFixed(preferences.priceInputPrecision);

    if (totalPrice)
      cost = (Number(cost) / (Number(amount) - (tare ? tareWeight : 0))).toFixed(
        preferences.priceInputPrecision,
      );

    const body: JsonObject = {
      amount: postedAmount,
      price: priceEnabled ? cost : 0,
      best_before_date: datesEnabled ? due : null,
      note,
    };

    if (preferences.showPurchaseDate) body.purchased_date = purchased;

    if (priceEnabled) body.shopping_location_id = store;

    if (locationsEnabled) body.location_id = location;

    if (labelsEnabled) body.stock_label_type = label;
    save.mutate(body);
  }

  const scan = useMutation({
    mutationFn: () => api.putUserSetting("scan_mode_purchase_enabled", !preferences.scanPurchase),
    onSuccess: () => client.invalidateQueries({ queryKey: userSettingsQuery().queryKey }),
  });

  const scanReady = useEffectEvent(() => {
    if (!autoSubmit.current || busy || !details || !form.current) return;
    autoSubmit.current = false;

    if (validAmount && unit && form.current.checkValidity()) form.current.requestSubmit();
    else if (scanEnabled)
      notify({
        message: t("Scan mode is on but not all required fields could be populated automatically"),
        tone: "error",
      });
  });

  useEffect(() => {
    scanReady();
  }, [busy, details]);

  const displayCost = (Number(price) * factor).toFixed(preferences.priceDisplayPrecision);

  const displayUnitCost = totalPrice
    ? (Number(displayCost) / (Number(amount) - (tare ? tareWeight : 0))).toFixed(
        preferences.priceDisplayPrecision,
      )
    : displayCost;

  const priceHint =
    price &&
    Number(price) !== 0 &&
    Number(postedAmount) !== 0 &&
    details &&
    (totalPrice || unit?.name !== details.quantity_unit_stock.name)
      ? t("means %1$s per %2$s", displayUnitCost, details.quantity_unit_stock.name)
      : "";

  return (
    <div className="transfer-layout">
      <form
        ref={form}
        className="move-form transfer-form"
        aria-label={t("Purchase")}
        onSubmit={submit}
      >
        {options.embedded === undefined ? (
          <button
            type="button"
            className="btn"
            aria-pressed={scanEnabled}
            disabled={scan.isPending || locked}
            onClick={() => scan.mutate()}
          >
            {t("Scan mode")} {t(scanEnabled ? "on" : "off")}
          </button>
        ) : null}
        {scan.error ? <ErrorBlock message={scan.error.message} /> : null}
        <fieldset disabled={locked}>
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
              workflowPath={`/purchase${options.embedded === undefined ? "" : "?embedded"}`}
              onChange={selectProduct}
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
                const next: PurchaseOptions = {
                  flow: "InplaceAddBarcodeToExistingProduct",
                  barcode,
                };

                if (options.embedded !== undefined) next.embedded = options.embedded;
                setOptions(next);
                onOptionsChange?.(next);
                selectProduct("");
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
          <div className="field-row">
            <div className="field">
              <label htmlFor={`${id}-amount`}>{t("Amount")}</label>
              <NumberPicker
                id={`${id}-amount`}
                label={t("Amount")}
                value={amount}
                required
                min={minimumAmount}
                step={String(minimum)}
                disabled={busy}
                onChange={setAmount}
              />
            </div>
            <label className="field">
              <span>{t("Quantity unit")}</span>
              <select
                required
                disabled={busy || units.length === 1 || tare}
                value={unitId}
                onChange={(event) => setUnitId(event.target.value)}
              >
                {!units.length ? <option value="" /> : null}
                {units.map((row) => (
                  <option key={String(row.id)} value={String(row.id)}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <input type="hidden" name="amount" value={postedAmount} />
          {amount && details && unit && unit.name !== details.quantity_unit_stock.name ? (
            <p className="field-help">
              {t(
                "This equals %1$s %2$s",
                (Number(amount) / factor).toLocaleString(),
                unitLabel(
                  {
                    ...details.quantity_unit_stock,
                    plural_forms: catalog.units.find(
                      (row) => row.id === details.quantity_unit_stock.id,
                    )?.plural_forms,
                  },
                  Number(amount) / factor,
                  pluralIndex,
                  false,
                ),
              )}
            </p>
          ) : null}
          {tare ? (
            <p role="status">
              {t("This product has tare weight enabled")}: {tareWeight}
            </p>
          ) : null}
          {preferences.showPurchaseDate ? (
            <div className="field">
              <label htmlFor={`${id}-purchased-date`}>{t("Purchased date")}</label>
              <BookingDateInput
                id={`${id}-purchased-date`}
                label={t("Purchased date")}
                required
                numeric={features.enabled("STOCK_BEST_BEFORE_DATE_FIELD_NUMBER_PAD")}
                firstDayOfWeek={features.query.data?.CALENDAR_FIRST_DAY_OF_WEEK}
                weekNumbers={features.query.data?.CALENDAR_SHOW_WEEK_OF_YEAR !== false}
                initialCalendarValue={purchased}
                value={purchased}
                onChange={setPurchased}
              />
            </div>
          ) : null}
          {datesEnabled ? (
            <div>
              <div className="field">
                <label htmlFor={`${id}-due-date`}>{t("Due date")}</label>
                <BookingDateInput
                  inputRef={dueInput}
                  id={`${id}-due-date`}
                  label={t("Due date")}
                  required
                  numeric={features.enabled("STOCK_BEST_BEFORE_DATE_FIELD_NUMBER_PAD")}
                  firstDayOfWeek={features.query.data?.CALENDAR_FIRST_DAY_OF_WEEK}
                  weekNumbers={features.query.data?.CALENDAR_SHOW_WEEK_OF_YEAR !== false}
                  readOnly={due === "2999-12-31"}
                  value={due}
                  onChange={setDue}
                  onShortcut={() =>
                    form.current?.querySelector<HTMLInputElement>(`[id="${id}-price"]`)?.focus()
                  }
                />
              </div>
              <label className="check-field">
                <input
                  type="checkbox"
                  tabIndex={-1}
                  checked={due === "2999-12-31"}
                  onChange={(event) => {
                    setDue(event.target.checked ? "2999-12-31" : "");

                    if (event.target.checked)
                      form.current?.querySelector<HTMLInputElement>(`[id="${id}-price"]`)?.focus();
                    else dueInput.current?.focus();
                  }}
                />
                {t("Never overdue")}
              </label>
              {due && due < isoDay() ? (
                <p className="field-help">
                  {t("The given date is earlier than today, are you sure?")}
                </p>
              ) : null}
            </div>
          ) : null}
          {priceEnabled ? (
            <>
              <div className="field">
                <label htmlFor={`${id}-price`}>{t("Price")}</label>
                <NumberPicker
                  id={`${id}-price`}
                  label={t("Price")}
                  value={price}
                  min={0}
                  step={String(10 ** -preferences.priceInputPrecision)}
                  onChange={setPrice}
                />
              </div>
              <div className="field-row">
                <label className="check-field">
                  <input
                    type="radio"
                    name={`${id}-price-type`}
                    checked={!totalPrice}
                    onChange={() => setTotalPrice(false)}
                  />
                  {unit ? `${unit.name} ${t("price")}` : t("Unit price")}
                </label>
                <label className="check-field">
                  <input
                    type="radio"
                    name={`${id}-price-type`}
                    checked={totalPrice}
                    onChange={() => setTotalPrice(true)}
                  />
                  {t("Total price")}
                </label>
              </div>
              {priceHint ? <p className="field-help">{priceHint}</p> : null}
              <label className="field">
                <span>{t("Store")}</span>
                <select value={store} onChange={(event) => setStore(event.target.value)}>
                  <option value="" />
                  {catalog.stores.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          {locationsEnabled ? (
            <label className="field">
              <span>{t("Location")}</span>
              <select
                value={location}
                onChange={(event) => {
                  const value = event.target.value;
                  setLocation(value);

                  if (details && features.enabled("STOCK_PRODUCT_FREEZING") && value)
                    fillDate(
                      details,
                      catalog.locations.find((row) => String(row.id) === value),
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
            </label>
          ) : null}
          {labelsEnabled ? (
            <label className="field">
              <span>{t("Stock entry label")}</span>
              <select value={label} onChange={(event) => setLabel(event.target.value)}>
                <option value="0">{t("No label")}</option>
                <option value="1">{t("Single label")}</option>
                <option value="2">{t("Label per unit")}</option>
              </select>
            </label>
          ) : null}
          <label className="field">
            <span>{t("Note")}</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <UserfieldsEditor
            fields={catalog.fields}
            values={fields}
            creating
            disabled={locked}
            onChange={(name, value) => setFields((current) => ({ ...current, [name]: value }))}
          />
        </fieldset>
        {load.isPending ? <LoadingBlock /> : null}
        {error ? (
          <>
            <ErrorBlock message={error.message} />
            {error.retry ? (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => selectProduct(product, code)}
              >
                {t("Retry")}
              </button>
            ) : null}
          </>
        ) : null}
        {receipt && error ? <p role="status">{t("Stock entry saved.")}</p> : null}
        <div className="actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || (!receipt && (!details || !unit || !validAmount))}
          >
            {save.isPending ? t("Saving…") : t("OK")}
          </button>
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
