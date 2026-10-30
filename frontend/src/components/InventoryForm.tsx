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
  getInventoryCatalog,
  getInventoryDetails,
  getInventorySelection,
  type InventoryCatalog,
  type InventoryDetails,
  type InventoryOptions,
} from "@/lib/inventory";
import { initialUserfields, saveUserfields } from "@/lib/userfields";
import { printLabel } from "@/lib/printing";
import { tableAttribute, tableText } from "@/lib/native-table-cell";
import type { Booking } from "@/lib/types";
import type { JsonObject } from "@/lib/json";
import { ProductPicker, type ProductCode } from "./ProductPicker";
import { ProductCard } from "./ProductOverview";
import { NumberPicker } from "./NumberPicker";
import { UserfieldsEditor } from "./UserfieldsEditor";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { useNotify } from "./Toaster";

type Props = {
  options: InventoryOptions;
  onClose?: () => void;
  onPendingChange?: (pending: boolean) => void;
  onOptionsChange?: (options: InventoryOptions) => void;
};

export function InventoryDialog(props: Omit<Props, "onPendingChange">) {
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
      <h2 id={title}>{t("Inventory")}</h2>
      <InventoryForm {...props} onPendingChange={setPending} />
    </dialog>
  );
}

export function InventoryForm(props: Props) {
  const { t } = useI18n();
  const settings = useQuery(userSettingsQuery());

  const catalog = useQuery({
    queryKey: ["stock", "inventory-editor"],
    queryFn: ({ signal }) => getInventoryCatalog(signal),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (catalog.isSuccess && catalog.isFetchedAfterMount && settings.isSuccess)
    return <InventoryFields {...props} catalog={catalog.data} />;

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
  details: InventoryDetails;
  body: JsonObject;
  product: string;
  delta: number;
};

function InventoryFields({
  catalog,
  options: initialOptions,
  onClose,
  onPendingChange,
  onOptionsChange,
}: Props & { catalog: InventoryCatalog }) {
  const { t, n, pluralIndex } = useI18n();
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
  const [details, setDetails] = useState<InventoryDetails>();
  const [code, setCode] = useState<ProductCode>();
  const [amount, setAmount] = useState("");
  const [unitId, setUnitId] = useState("");
  const [location, setLocation] = useState("");
  const [store, setStore] = useState("");
  const [due, setDue] = useState("");
  const [purchased, setPurchased] = useState(isoDay);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [label, setLabel] = useState("0");
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

  const [estimate, setEstimate] = useState<{
    amount: number;
    delta: number;
    details: InventoryDetails;
  }>();

  const priceEnabled = features.enabled("STOCK_PRICE_TRACKING");
  const datesEnabled = features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING");
  const locationsEnabled = features.enabled("STOCK_LOCATION_TRACKING");
  const labelsEnabled = features.enabled("LABEL_PRINTER");
  const precision = preferences.amountPrecision;
  const step = precision > 0 ? 10 ** -precision : 1;
  const units = details ? stockEditorUnits(catalog, product, details.quantity_unit_stock.id) : [];
  const unit = units.find((row) => String(row.id) === unitId);
  const factor = unit?.factor ?? NaN;

  const postedAmount = (Number(amount) / factor)
    .toFixed(Math.max(1, precision))
    .replace(/0*$/g, "");

  const tare = details?.product.enable_tare_weight_handling === 1;
  const tareWeight = tare ? (details.product.tare_weight ?? 0) : 0;
  const unchanged = !!details && amount !== "" && amount === String(details.stock_amount * factor);
  const delta = estimate?.delta ?? 0;

  const adding =
    estimate !== undefined && estimate.amount > estimate.details.stock_amount + tareWeight;

  useEffect(() => {
    form.current
      ?.querySelector<HTMLInputElement>(`[id="${id}-amount"]`)
      ?.setCustomValidity(unchanged ? "error" : "");
  }, [id, unchanged]);

  const load = useMutation({
    mutationFn: async (vars: {
      product: string;
      code?: ProductCode;
      version: number;
      signal: AbortSignal;
    }) => ({
      data: await getInventorySelection(vars.product, vars.signal, vars.code?.barcode),
      vars,
    }),
    onSuccess: ({ data, vars }) => {
      if (vars.version !== version.current || vars.signal.aborted) return;
      const selected = data.details;
      const choices = stockEditorUnits(catalog, vars.product, selected.quantity_unit_stock.id);
      const barcode = data.barcode;
      const selectedUnit = barcode?.qu_id || selected.quantity_unit_stock.id;
      setDetails(selected);
      setUnitId(choices.some((row) => row.id === selectedUnit) ? String(selectedUnit) : "");
      setAmount(String(barcode?.amount || selected.stock_amount));
      setLocation(
        catalog.locations.some((row) => row.id === selected.location?.id)
          ? String(selected.location!.id)
          : "",
      );
      setStore(
        catalog.stores.some((row) => row.id === selected.last_shopping_location_id)
          ? String(selected.last_shopping_location_id)
          : "",
      );
      setPrice(
        selected.last_price ? selected.last_price.toFixed(preferences.priceDisplayPrecision) : "",
      );

      if (barcode?.note) setNote(barcode.note);

      const days = selected.product.default_best_before_days;

      if (datesEnabled && days) setDue(days === -1 ? "2999-12-31" : isoDay(days));
      setLabel(String(selected.product.default_stock_label_type ?? 0));
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
    setEstimate(undefined);
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
    if (
      !initial ||
      (options.embedded === undefined &&
        options.flow !== "InplaceNewProductWithName" &&
        options.flow !== "InplaceAddBarcodeToExistingProduct")
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

  useEffect(() => {
    if (!details || !Number.isFinite(factor) || !amount) return;
    const controller = new AbortController();
    const current = Number(postedAmount);
    void getInventoryDetails(product, controller.signal)
      .then((fresh) => {
        if (controller.signal.aborted) return;

        const weight =
          fresh.product.enable_tare_weight_handling === 1 ? (fresh.product.tare_weight ?? 0) : 0;

        setEstimate({
          amount: current,
          delta: Number((current - fresh.stock_amount - weight).toFixed(precision)),
          details: fresh,
        });
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted) console.error(reason);
      });

    return () => controller.abort();
  }, [amount, details, factor, postedAmount, precision, product]);

  async function changed(identity: number) {
    await invalidate();
    await client.invalidateQueries({ queryKey: ["product-overview", identity] });
  }

  const save = useMutation({
    mutationFn: async (body: JsonObject) => {
      if (!booked.current) {
        const fresh = await getInventoryDetails(product);

        const bookings = await request<Receipt["bookings"]>(
          `/api/stock/products/${product}/inventory`,
          { method: "POST", body: JSON.stringify(body) },
        );

        if (!bookings[0]) throw new Error(t("The stock booking could not be read."));

        const weight =
          fresh.product.enable_tare_weight_handling === 1 ? (fresh.product.tare_weight ?? 0) : 0;

        booked.current = {
          bookings,
          body,
          product,
          details: fresh,
          delta: Number((Number(body.new_amount) - fresh.stock_amount - weight).toFixed(precision)),
        };
        setReceipt(booked.current);
      }

      const saved = booked.current;
      const first = saved.bookings[0]!;

      if (!barcodeSaved.current) {
        if (
          options.flow === "InplaceAddBarcodeToExistingProduct" &&
          options.barcode !== undefined
        ) {
          const barcode: JsonObject = { barcode: options.barcode, product_id: saved.product, note };

          if (priceEnabled) barcode.shopping_location_id = store;
          void api
            .action("/api/objects/product_barcodes", barcode)
            .then(() => {
              if (!alive.current || options.embedded !== undefined) return;
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

      if (
        labelsEnabled &&
        browserLabels &&
        Number(label) > 0 &&
        saved.delta > 0 &&
        !labelsStarted.current
      ) {
        labelsStarted.current = true;

        const entries =
          label === "2"
            ? await request<{ stock_id: string }[]>(
                `/api/stock/transactions/${first.transaction_id}`,
              )
            : [first];

        for (const entry of entries)
          void printLabel(
            `/api/stock/entry/${encodeURIComponent(entry.stock_id)}/printlabel`,
            features.query.data ?? {},
          ).catch((reason: Error) => notify({ message: reason.message, tone: "error" }));
      }

      saved.details = await getInventoryDetails(saved.product);
      await saveUserfields("stock", first.transaction_id, catalog.fields, fields, (name, value) =>
        setFields((current) => ({ ...current, [name]: value })),
      );

      return saved;
    },
    onSuccess: async (saved) => {
      const first = saved.bookings[0]!;
      const quantity = saved.details.stock_amount;

      const stockUnit = {
        ...saved.details.quantity_unit_stock,
        plural_forms: catalog.units.find((row) => row.id === saved.details.quantity_unit_stock.id)
          ?.plural_forms,
      };

      const message = t(
        "Stock amount of %1$s is now %2$s",
        saved.details.product.name,
        `${quantity} ${unitLabel(stockUnit, quantity, pluralIndex, false)}`,
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
        setDetails(undefined);
        setEstimate(undefined);
        setCode(undefined);
        setUnitId("");
        setAmount("");
        setPrice("");
        setDue("");
        setStore("");
        setNote("");
        setLabel("0");
        setFields(initialUserfields(catalog.fields, {}, true));
        booked.current = undefined;
        setReceipt(undefined);
        const next: InventoryOptions = { ...options };
        delete next.flow;
        delete next.barcode;
        delete next["product-name"];
        setOptions(next);
        onOptionsChange?.(next);
        requestAnimationFrame(() => picker.current?.querySelector("input")?.focus());
      }

      await changed(saved.details.product.id);
      onClose?.();
    },
    onError: (reason: Error) => setError({ message: reason.message }),
  });

  const locked = save.isPending || receipt !== undefined || finished;

  const busy =
    load.isPending ||
    save.isPending ||
    pickerBusy ||
    finished ||
    (receipt !== undefined && save.isError);

  const validAmount =
    amount !== "" &&
    Number(amount) >= tareWeight &&
    Number(amount) === Number(Number(amount).toFixed(precision));

  useEffect(() => onPendingChange?.(save.isPending), [save.isPending, onPendingChange]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      busy ||
      !details ||
      !unit ||
      !validAmount ||
      unchanged ||
      !event.currentTarget.reportValidity()
    )
      return;
    setError(undefined);
    const rawPrice = priceEnabled ? price : "0";

    const body: JsonObject = {
      new_amount: postedAmount,
      best_before_date: due,
      price: rawPrice ? (Number(rawPrice) * factor).toFixed(preferences.priceInputPrecision) : "",
      note,
    };

    if (preferences.showPurchaseDate) body.purchased_date = purchased;

    if (priceEnabled) body.shopping_location_id = store;

    if (locationsEnabled) body.location_id = location;

    if (labelsEnabled) body.stock_label_type = label;
    save.mutate(body);
  }

  const stockUnit = details
    ? {
        ...details.quantity_unit_stock,
        plural_forms: catalog.units.find((row) => row.id === details.quantity_unit_stock.id)
          ?.plural_forms,
      }
    : undefined;

  const estimateVisible =
    amount !== "" && estimate && estimate.amount >= tareWeight && estimate.delta !== 0;

  const priceHint =
    price &&
    Number(price) !== 0 &&
    Number(postedAmount) !== 0 &&
    details &&
    unit?.name !== details.quantity_unit_stock.name
      ? t(
          "means %1$s per %2$s",
          (Number(price) * factor).toFixed(preferences.priceDisplayPrecision),
          details.quantity_unit_stock.name,
        )
      : "";

  return (
    <div className="transfer-layout">
      <form
        ref={form}
        className="move-form transfer-form"
        aria-label={t("Inventory")}
        onSubmit={submit}
      >
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
              workflowPath={`/inventory${options.embedded === undefined ? "" : "?embedded"}`}
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
                const next: InventoryOptions = {
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
              <label htmlFor={`${id}-amount`}>{t("New stock amount")}</label>
              <NumberPicker
                id={`${id}-amount`}
                label={t("New stock amount")}
                value={amount}
                required
                min={tareWeight}
                step={String(step)}
                disabled={busy}
                onChange={setAmount}
              />
            </div>
            <label className="field">
              <span>{t("Quantity unit")}</span>
              <select
                required
                disabled={busy || units.length === 1}
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
          {amount && stockUnit && unit && unit.name !== stockUnit.name ? (
            <p className="field-help">
              {t(
                "This equals %1$s %2$s",
                (Number(amount) / factor).toLocaleString(),
                unitLabel(stockUnit, Number(amount) / factor, pluralIndex, false),
              )}
            </p>
          ) : null}
          {estimateVisible && stockUnit ? (
            <p role="status">
              {t(
                delta > 0
                  ? "This means %s will be added to stock"
                  : "This means %s will be removed from stock",
                `${Math.abs(delta).toLocaleString()} ${unitLabel(stockUnit, Math.abs(delta), pluralIndex, false)}`,
              )}
            </p>
          ) : null}
          {tare ? (
            <p role="status">
              {t(
                "Tare weight handling enabled - please weigh the whole container, the amount to be posted will be automatically calculcated",
              )}
            </p>
          ) : null}
          <p className="field-help">{t("This will apply to added products")}</p>
          {preferences.showPurchaseDate ? (
            <label className="field">
              <span>{t("Purchased date")}</span>
              <input
                type="date"
                required
                value={purchased}
                onChange={(event) => setPurchased(event.target.value)}
              />
            </label>
          ) : null}
          {datesEnabled ? (
            <div>
              <label className="field">
                <span>{t("Due date")}</span>
                <input
                  ref={dueInput}
                  type="date"
                  required={adding}
                  readOnly={due === "2999-12-31"}
                  value={due}
                  onChange={(event) => setDue(event.target.value)}
                />
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={due === "2999-12-31"}
                  onChange={(event) => {
                    setDue(event.target.checked ? "2999-12-31" : "");

                    if (!event.target.checked) dueInput.current?.focus();
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
                required
                value={location}
                onChange={(event) => setLocation(event.target.value)}
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
              {label === "2" && delta > 0 ? (
                <small>
                  {n(
                    delta,
                    "This means 1 label will be printed",
                    "This means %1$s labels will be printed",
                  )}
                </small>
              ) : null}
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
                onClick={() => {
                  setDetails(undefined);
                  selectProduct(product, code);
                }}
              >
                {t("Retry")}
              </button>
            ) : null}
          </>
        ) : null}
        {receipt && error ? (
          <>
            <p role="status">{t("Stock entry saved.")}</p>
            <button
              type="button"
              className="btn"
              disabled={save.isPending}
              onClick={() => {
                setError(undefined);
                save.mutate(receipt.body);
              }}
            >
              {t("Retry")}
            </button>
          </>
        ) : null}
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
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
