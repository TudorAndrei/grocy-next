import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { useRouter } from "@tanstack/react-router";
import { userSettingsQuery } from "@/hooks/queries";
import { nativeCurrencyValue, nativeQuantityValue } from "@/lib/native-quantity";
import { useModalDialog } from "@/hooks/useModalDialog";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useGenericError } from "@/hooks/useGenericError";
import { api, request } from "@/lib/api";
import { getTopmostGrocyWindow } from "@/lib/embedded-window";
import { useInvalidateStock } from "@/lib/catalog";
import { isoDay, unitLabel } from "@/lib/format";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { stockEditorUnits } from "@/lib/stock-editor";
import {
  getInventoryCatalog,
  getInventoryDetails,
  getInventoryBarcode,
  type InventoryCatalog,
  type InventoryDetails,
  type InventoryOptions,
} from "@/lib/inventory";
import { useInventoryDocument, type InventoryDocument } from "@/lib/inventory-document";
import { initialUserfields, userfieldUpload } from "@/lib/userfields";
import { saveCustomObjectFields } from "@/lib/custom-object-form";
import { postLabelWebhook } from "@/lib/printing";
import { DocumentTasksProvider, useDocumentTasks } from "@/lib/document-tasks";
import { NativeScriptBindingsProvider } from "@/lib/native-script-bindings";
import { tableAttribute, tableText } from "@/lib/native-table-cell";
import type { Booking } from "@/lib/types";
import type { JsonObject } from "@/lib/json";
import { ProductPicker, type ProductCode } from "./ProductPicker";
import { ProductCard } from "./ProductOverview";
import { NumberPicker } from "./NumberPicker";
import { NativeMainDateInput, type NativeMainDateHandle } from "./NativeMainDateInput";
import { nativeMainDateFormat } from "@/lib/native-userfield-dates";
import { NativeDateTimeInput } from "./NativeDateTimeInput";
import { UserfieldsEditor, type UserfieldsEditorHandle } from "./UserfieldsEditor";
import { NativeUserfieldsLoad } from "./NativeUserfieldsLoad";
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
      <h2 id={title}>{t("Inventory")}</h2>
      <DocumentTasksProvider identity="inventory-dialog">
        <InventoryForm
          {...props}
          onClose={
            props.onClose
              ? () => {
                  if (dialog.current?.open) props.onClose?.();
                }
              : undefined
          }
        />
      </DocumentTasksProvider>
    </dialog>
  );
}

export function InventoryForm(props: Props) {
  const document = useInventoryDocument(props.options);
  const router = useRouter();
  const physical = router.state.location.pathname.replace(/\/$/, "") === "/inventory";

  return (
    <NativeScriptBindingsProvider key={document.revision} physical={physical}>
      <DocumentTasksProvider identity={`inventory:${document.revision}`}>
        <InventoryDocumentBody {...props} document={document} />
      </DocumentTasksProvider>
    </NativeScriptBindingsProvider>
  );
}

function InventoryDocumentBody({ document, ...props }: Props & { document: InventoryDocument }) {
  const { t } = useI18n();
  const settings = useQuery({ ...userSettingsQuery(), refetchOnMount: "always" });

  const catalog = useQuery({
    queryKey: ["stock", "inventory-editor"],
    queryFn: ({ signal }) => getInventoryCatalog(signal),
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
      <InventoryFields
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

type Receipt = {
  bookings: (Booking & { stock_id: string; best_before_date?: string | null })[];
  details: InventoryDetails;
  body: JsonObject;
  product: string;
  embedded: boolean;
};

type InventorySubmission = {
  product: string;
  amount: string;
  price: string;
  note: string;
  label?: string;
  store?: string;
};

function waitForRetirement(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const stop = () => reject(signal.reason);

    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
}

function InventoryFields({
  catalog,
  options: initialOptions,
  onClose,
  onPendingChange,
  document: inventoryDocument,
}: Props & { catalog: InventoryCatalog; document: InventoryDocument }) {
  const { t, n, pluralIndex } = useI18n();
  const features = useFeatures();
  const preferences = usePreferences();
  const userSettings = useUserSettings();
  const client = useQueryClient();
  const invalidate = useInvalidateStock();
  const notify = useNotify();
  const genericError = useGenericError();
  const documentTasks = useDocumentTasks();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const userfields = useRef<UserfieldsEditorHandle>(null);
  const picker = useRef<HTMLDivElement>(null);
  const dueInput = useRef<HTMLInputElement>(null);
  const purchasedInput = useRef<HTMLInputElement>(null);
  const duePicker = useRef<NativeMainDateHandle>(null);
  const neverInput = useRef<HTMLInputElement>(null);
  const currentCode = useRef<ProductCode>(undefined);
  const lastCommit = useRef<string>(undefined);
  const alive = useRef(true);
  const owner = useRef(new AbortController());
  const estimatedBookingAmount = useRef(NaN);
  const [labelAmount, setLabelAmount] = useState(NaN);
  const [options] = useState(initialOptions);
  const [barcodeAdded, setBarcodeAdded] = useState(false);
  const [additionalBarcodes, setAdditionalBarcodes] = useState<Record<string, string>>({});
  const prefill = options["product-name"];

  const named =
    prefill === undefined || prefill === ""
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
  const [details, setDetails] = useState<InventoryDetails>();
  const [amount, updateAmount] = useState("");
  const [conversion, setConversion] = useState({ amount: "", factor: NaN });
  const hiddenAmount = useRef("NaN");
  const destinationUnitName = useRef<string>(undefined);
  const [unitId, updateUnitId] = useState("");
  const [units, setUnits] = useState<ReturnType<typeof stockEditorUnits>>([]);
  const unitChoices = useRef<ReturnType<typeof stockEditorUnits>>([]);
  const [unitRestored, setUnitRestored] = useState(false);
  const [location, setLocation] = useState("");
  const [store, setStore] = useState("");
  const [due, setDue] = useState("");
  const [purchased, setPurchased] = useState(isoDay);

  const [price, updatePrice] = useState(() =>
    features.enabled("STOCK_PRICE_TRACKING") ? "" : "0",
  );

  const [priceHint, setPriceHint] = useState("");
  const [note, setNote] = useState("");
  const [label, setLabel] = useState("0");
  const [fields, setFields] = useState(() => initialUserfields(catalog.fields, {}, false));
  const [pickerBusy, setPickerBusy] = useState(false);
  const [externalBusy, setExternalBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const editObject = useRef<string>(undefined);
  const [card, setCard] = useState<number>();
  const [expanded, setExpanded] = useState(false);

  const [estimateVisible, setEstimateVisible] = useState(false);
  const [estimateMessage, setEstimateMessage] = useState("");
  const [dueRequired, setDueRequired] = useState(true);
  const [locationRequired, setLocationRequired] = useState(true);

  const priceEnabled = features.enabled("STOCK_PRICE_TRACKING");
  const datesEnabled = features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING");
  const locationsEnabled = features.enabled("STOCK_LOCATION_TRACKING");
  const labelsEnabled = features.enabled("LABEL_PRINTER");
  const precision = preferences.amountPrecision;
  const step = precision > 0 ? 10 ** -precision : 1;
  const unit = units.find((row) => String(row.id) === unitId);
  const factor = unit?.factor ?? NaN;

  const destinationAmount = Number(conversion.amount) / conversion.factor;

  const postedAmount = destinationAmount.toFixed(Math.max(1, precision)).replace(/0*$/g, "");

  const tare = details?.product.enable_tare_weight_handling === 1;
  const tareWeight = tare ? (details.product.tare_weight ?? 0) : 0;
  const live = useRef({ product, amount, factor, unitId, price, due, purchased, store, location });
  useLayoutEffect(() => {
    live.current = { product, amount, factor, unitId, price, due, purchased, store, location };
  });
  const rawPurchasedSetting = userSettings.data?.show_purchased_date_on_purchase;

  const showPurchasedDate =
    rawPurchasedSetting !== undefined &&
    rawPurchasedSetting !== null &&
    rawPurchasedSetting !== false &&
    rawPurchasedSetting !== 0 &&
    rawPurchasedSetting !== "" &&
    rawPurchasedSetting !== "0";

  function setProduct(value: string) {
    live.current.product = value;
    updateProduct(value);
  }

  function setAmount(value: string) {
    live.current.amount = value;
    updateAmount(value);
  }

  function setUnitId(value: string) {
    live.current.factor =
      unitChoices.current.find((row) => String(row.id) === value)?.factor ?? NaN;
    live.current.unitId = value;
    updateUnitId(value);
  }

  function setPrice(value: string) {
    live.current.price = value;
    updatePrice(value);
  }

  function formatPrice() {
    if (priceEnabled)
      setPrice(nativeCurrencyValue(live.current.price, preferences.priceInputPrecision));
    userfields.current?.refreshCurrencyValues(preferences.priceInputPrecision);
  }

  function refreshPriceHint() {
    const selected = unitChoices.current.find((row) => String(row.id) === live.current.unitId);

    if (
      destinationUnitName.current === undefined ||
      Number(hiddenAmount.current) === 0 ||
      Number(live.current.price) === 0 ||
      destinationUnitName.current === (selected?.name ?? "")
    ) {
      setPriceHint("");

      return;
    }

    setPriceHint(
      t(
        "means %1$s per %2$s",
        (Number(live.current.price) * live.current.factor).toFixed(
          preferences.priceDisplayPrecision,
        ),
        String(destinationUnitName.current),
      ),
    );
  }

  function convertAmount() {
    setConversion({ amount: live.current.amount, factor: live.current.factor });
    hiddenAmount.current = (Number(live.current.amount) / live.current.factor)
      .toFixed(Math.max(1, precision))
      .replace(/0*$/g, "");
  }

  function changeAmountGroup() {
    convertAmount();
    const stock = Number.parseFloat(amountInput.current?.getAttribute("data-stock-amount") ?? "");
    amountInput.current?.setAttribute("data-not-equal", String(stock * live.current.factor));
    refreshPriceHint();
  }

  const amountChange = useEffectEvent(() => {
    if (amountInput.current) setAmount(amountInput.current.value);
    convertAmount();
  });

  useEffect(() => {
    const input = amountInput.current;
    input?.addEventListener("change", amountChange);

    return () => input?.removeEventListener("change", amountChange);
  }, []);

  function amountKeyUp(value: string) {
    // NumberPicker owns validity on keyup. Group changes update the forbidden
    // value and conversion without changing an existing custom validity error.
    const forbidden = amountInput.current?.getAttribute("data-not-equal");

    amountInput.current?.setCustomValidity(forbidden && forbidden === value ? "error" : "");
    changeAmountGroup();
    requestEstimate(value);
  }

  function requestEstimate(value: string, selectedProduct = live.current.product) {
    if (!selectedProduct) return;
    const signal = owner.current.signal;

    const current = Number(
      (Number(value) / live.current.factor).toFixed(Math.max(1, precision)).replace(/0*$/g, ""),
    );

    void getInventoryDetails(selectedProduct, signal)
      .then((fresh) => {
        if (signal.aborted) return;
        const stock = fresh.stock_amount || 0;

        const weight =
          fresh.product.enable_tare_weight_handling === 1 ? (fresh.product.tare_weight ?? 0) : 0;

        const signed = Number((current - stock - weight).toFixed(precision));
        estimatedBookingAmount.current = signed;
        setLabelAmount(signed);
        setEstimateVisible(true);

        if (fresh.product.enable_tare_weight_handling === 1 && current < weight)
          setEstimateVisible(false);
        else if (current !== stock + weight && !Number.isNaN(current)) {
          const added = current > stock + weight;
          const amount = Math.abs(signed);

          const stockUnit = {
            ...fresh.quantity_unit_stock,
            plural_forms: catalog.units.find((row) => row.id === fresh.quantity_unit_stock.id)
              ?.plural_forms,
          };

          setEstimateMessage(
            t(
              added
                ? "This means %s will be added to stock"
                : "This means %s will be removed from stock",
              `${amount.toLocaleString()} ${unitLabel(stockUnit, amount, pluralIndex, false)}`,
            ),
          );
          setDueRequired(added);

          if (locationsEnabled) setLocationRequired(added);
        } else if (current === stock) setEstimateVisible(false);

        if (!datesEnabled) setDueRequired(false);
        refreshPriceHint();
      })
      .catch((reason: Error) => {
        if (!signal.aborted) console.error(reason);
      });
  }

  const load = useMutation({
    mutationFn: async (vars: { product: string; signal: AbortSignal }) => ({
      data: await getInventoryDetails(vars.product, vars.signal),
      vars,
    }),
    onSuccess: ({ data: selected, vars }) => {
      if (vars.signal.aborted) return;

      const choices = stockEditorUnits(
        catalog,
        String(selected.product.id),
        selected.quantity_unit_stock.id,
      );

      setDetails(selected);
      amountInput.current?.setAttribute("data-stock-amount", String(selected.stock_amount));
      destinationUnitName.current = selected.quantity_unit_stock.name;
      unitChoices.current = choices;
      setUnits(choices);
      setUnitId(
        choices.some((row) => row.id === selected.quantity_unit_stock.id)
          ? String(selected.quantity_unit_stock.id)
          : "",
      );
      setUnitRestored(false);

      if (locationsEnabled)
        setLocation(
          catalog.locations.some((row) => row.id === selected.location?.id)
            ? String(selected.location!.id)
            : "",
        );

      if (priceEnabled)
        setStore(
          catalog.stores.some((row) => row.id === selected.last_shopping_location_id)
            ? String(selected.last_shopping_location_id)
            : "",
        );
      setPrice(
        selected.last_price
          ? (selected.last_price / live.current.factor).toFixed(preferences.priceDisplayPrecision)
          : "",
      );
      formatPrice();
      const days = selected.product.default_best_before_days;

      if (datesEnabled && days) {
        if (days === -1) {
          if (!neverInput.current?.checked) setDue("2999-12-31");
        } else setDue(nativeMainDateFormat(isoDay(days), t("moment_locale"), false));
      }

      if (labelsEnabled) setLabel(String(selected.product.default_stock_label_type ?? 0));
      const selectedCode = currentCode.current;

      if (selectedCode)
        void getInventoryBarcode(selectedCode.barcode, vars.signal)
          .then((barcode) => {
            if (vars.signal.aborted || !barcode) return;

            if (barcode.amount) setAmount(String(barcode.amount));

            if (barcode.qu_id)
              setUnitId(
                unitChoices.current.some((row) => row.id === barcode.qu_id)
                  ? String(barcode.qu_id)
                  : "",
              );

            if (barcode.note) setNote(barcode.note);

            // Native barcode conversion happens before locale formatting. The
            // formatting step neither converts again nor issues an estimate.
            changeAmountGroup();
            formatPrice();
            setAmount(nativeQuantityValue(live.current.amount, precision));
          })
          .catch((reason: Error) => {
            if (!vars.signal.aborted) console.error(reason);
          });

      formatPrice();
      const nextAmount = nativeQuantityValue(String(selected.stock_amount), precision);
      setAmount(nextAmount);
      changeAmountGroup();
      amountKeyUp(nextAmount);
      refreshPriceHint();
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLInputElement>(`[id="${id}-amount"]`)?.focus(),
      );
    },
    onError: (reason: Error, vars) => {
      if (!vars.signal.aborted) console.error(reason);
    },
  });

  function selectProduct(value: string, selectedCode?: ProductCode) {
    // Deduplicate input/Enter/blur notifications of one ordinary picker commit.
    if (value === live.current.product && !selectedCode && lastCommit.current === value) return;
    lastCommit.current = value;
    setProduct(value);
    currentCode.current = selectedCode;

    if (!value) return;
    setCard(Number(value));
    load.mutate({ product: value, signal: owner.current.signal });
  }

  const start = useEffectEvent(() => {
    const flow = inventoryDocument.read("flow");

    if (
      inventoryDocument.read("embedded") === undefined &&
      flow !== "InplaceNewProductWithName" &&
      flow !== "InplaceAddBarcodeToExistingProduct"
    )
      return;
    selectProduct(initial ? String(initial.id) : "");
  });

  useEffect(() => {
    alive.current = true;
    owner.current = new AbortController();
    // The source document initializes its picker once when the script is installed.
    // eslint-disable-next-line react/set-state-in-effect
    start();

    return () => {
      alive.current = false;
      owner.current.abort();
      document.body.classList.remove("cursor-busy");
    };
  }, []);

  async function changed(identity: number) {
    await invalidate(identity);
    await client.invalidateQueries({ queryKey: ["product-overview", identity] });
  }

  const save = useMutation({
    onMutate: () => {
      setSaving(true);
      document.body.classList.add("cursor-busy");
    },
    mutationFn: async (draft: InventorySubmission) => {
      const signal = owner.current.signal;
      signal.throwIfAborted();
      const printTask = documentTasks.capture();

      const fresh = await getInventoryDetails(draft.product, signal);
      signal.throwIfAborted();

      const body: JsonObject = {
        new_amount: draft.amount,
        best_before_date: dueInput.current?.value ?? live.current.due,
        price: draft.price
          ? (Number(draft.price) * live.current.factor).toFixed(preferences.priceInputPrecision)
          : "",
        note: draft.note,
      };

      if (draft.label !== undefined) body.stock_label_type = draft.label;

      if (priceEnabled) body.shopping_location_id = live.current.store;

      if (locationsEnabled) body.location_id = live.current.location;

      try {
        const date2 = showPurchasedDate
          ? { GetValue: () => purchasedInput.current?.value ?? live.current.purchased }
          : undefined;

        // Native JS truthiness can enter after PHP omitted the date component.
        if (rawPurchasedSetting) body.purchased_date = date2!.GetValue();
      } catch (reason) {
        if (signal.aborted) throw reason;
        console.error(reason);
        await waitForRetirement(signal);
      }

      const bookings = await request<Receipt["bookings"]>(
        `/api/stock/products/${draft.product}/inventory`,
        { method: "POST", body: JSON.stringify(body), signal },
      ).finally(() =>
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

      const saved: Receipt = {
        bookings,
        body,
        product: draft.product,
        details: fresh,
        embedded: false,
      };

      const first = saved.bookings[0]!;

      if (inventoryDocument.read("flow") === "InplaceAddBarcodeToExistingProduct") {
        const barcode: JsonObject = { product_id: saved.product, note: draft.note };
        const rawBarcode = inventoryDocument.read("barcode");

        if (rawBarcode !== undefined) barcode.barcode = rawBarcode;

        if (draft.store !== undefined) barcode.shopping_location_id = draft.store;
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
              inventoryDocument.barcodeAdded();
              setBarcodeAdded(true);
            } catch (reason) {
              console.error(reason);
            }
          })
          .catch((reason: Error) => {
            if (signal.aborted) return;
            setSaving(false);
            setFinished(false);
            setUnitRestored(true);
            document.body.classList.remove("cursor-busy");
            genericError("Error while saving, probably this item already exists", reason);
          });
      }

      const serverLabels = features.query.data?.LABEL_PRINTER_RUN_SERVER;
      const labelType = Number(saved.body.stock_label_type);

      const browserLabels =
        serverLabels === false ||
        serverLabels === 0 ||
        serverLabels === "0" ||
        serverLabels === "" ||
        serverLabels === null;

      if (
        labelsEnabled &&
        browserLabels &&
        (labelType === 1 || labelType === 2) &&
        estimatedBookingAmount.current > 0
      ) {
        // Receipt details are refreshed below; the printer keeps the pre-save name.
        const productName = saved.details.product.name;
        const productId = saved.product;
        const dueDate = first.best_before_date;
        const config = features.query.data ?? {};

        const printEntries = (entries: { stock_id: string }[]) => {
          if (printTask.signal.aborted) return;

          for (const entry of entries) {
            const payload: JsonObject = {
              product: productName,
              grocycode: `grcy:p:${productId}:${entry.stock_id}`,
            };

            if (datesEnabled) payload.due_date = `${t("DD")}: ${dueDate}`;

            void postLabelWebhook(payload, config, printTask.signal).catch(() =>
              printTask.genericError("Error while executing WebHook"),
            );
          }
        };

        if (labelType === 2) {
          void request<{ stock_id: string }[]>(`/api/stock/transactions/${first.transaction_id}`, {
            signal: printTask.signal,
          }).then(printEntries, (reason: Error) => {
            if (!printTask.signal.aborted) console.error(reason);
          });
        } else printEntries([first]);
      }

      editObject.current = first.transaction_id;

      try {
        saved.details = await getInventoryDetails(saved.product, signal);
      } catch (reason) {
        if (signal.aborted) throw reason;
        // Native EndUiBusy() without a form only removes the cursor.
        document.body.classList.remove("cursor-busy");
        console.error(reason);
        await waitForRetirement(signal);
      }

      signal.throwIfAborted();

      saved.embedded = inventoryDocument.read("embedded") !== undefined;

      // The receipt read may settle after an independent callback unlocked the
      // controls. Native field saving reads the live inputs at this stage.
      const edits = Object.fromEntries(
        Object.entries(userfields.current?.snapshot() ?? fields).map(([name, edit]) => {
          const file = edit.readFile ? edit.readFile() : edit.upload?.file;

          return [name, file ? { ...edit, ...userfieldUpload(file) } : edit];
        }),
      );

      // Only the last dirty callback completes the form. Metadata errors are
      // silent; a failed final field keeps the form busy until it is retired.
      await new Promise<void>((resolve, reject) => {
        const stop = () => reject(signal.reason);
        signal.addEventListener("abort", stop, { once: true });
        void saveCustomObjectFields(
          "stock",
          editObject.current,
          catalog.fields,
          edits,
          () => {},
          (error) => genericError("Error while saving, probably this item already exists", error),
          signal,
        ).then(
          () => {
            signal.removeEventListener("abort", stop);
            resolve();
          },
          () => {},
        );
      });

      signal.throwIfAborted();

      return saved;
    },
    onSuccess: async (saved) => {
      if (!alive.current) return;

      if (!saved.embedded) {
        // EndUiBusy enables controls before the source picker's synchronous Clear/click callbacks.
        flushSync(() => {
          setSaving(false);
          setUnitRestored(true);
        });
        document.body.classList.remove("cursor-busy");
      }

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

      if (!saved.embedded || window.parent === window)
        notify({
          message,
          undo: async () => {
            await api.undoTransaction(first.transaction_id);
            await changed(saved.details.product.id);
          },
        });

      if (saved.embedded) {
        setFinished(true);

        if (window.parent !== window) {
          const transaction = JSON.stringify(first.transaction_id)
            .slice(1, -1)
            .replaceAll("'", "\\'");

          const undo = `<br><a class="btn btn-secondary btn-sm mt-2" href="#" onclick="UndoStockTransaction('${tableAttribute(transaction)}')"><i class="fa-solid fa-undo"></i> ${tableText(t("Undo"))}</a>`;
          getTopmostGrocyWindow().postMessage(
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
        if (inventoryDocument.read("flow") === "InplaceAddBarcodeToExistingProduct") {
          const selected = live.current.product;
          const rawBarcode = inventoryDocument.read("barcode");
          setAdditionalBarcodes((current) => ({
            ...current,
            [selected]: `${current[selected] ?? ""}${rawBarcode},`,
          }));
        }

        inventoryDocument.finishFlow();
        setProduct("");
        setDetails(undefined);
        setEstimateVisible(false);
        currentCode.current = undefined;
        lastCommit.current = undefined;
        setUnits([]);
        unitChoices.current = [];
        setUnitId("");
        setAmount("");
        changeAmountGroup();
        setPrice("");
        setPriceHint("");
        setDue("");
        duePicker.current?.Clear();
        setStore("");
        setNote("");
        setLabel("0");
        const signal = owner.current.signal;
        void userfields.current?.clear("stock", signal).catch((reason) => {
          if (!signal.aborted) console.error(reason);
        });
        requestAnimationFrame(() => picker.current?.querySelector("input")?.focus());
      }

      await changed(saved.details.product.id);

      if (alive.current) onClose?.();
    },
    onError: (reason: Error) => {
      if (!alive.current) return;
      setSaving(false);
      setUnitRestored(true);
      document.body.classList.remove("cursor-busy");
      console.error(reason);
    },
  });

  const locked = saving || finished;

  const busy = saving || pickerBusy || finished;

  const validAmount =
    amount !== "" &&
    Number(amount) >= tareWeight &&
    Number(amount) === Number(Number(amount).toFixed(precision));

  useEffect(() => onPendingChange?.(saving), [saving, onPendingChange]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busy || !details || !unit || !validAmount || !event.currentTarget.reportValidity()) return;

    const draft: InventorySubmission = {
      product,
      amount: postedAmount,
      price,
      note,
    };

    if (priceEnabled) draft.store = store;

    if (labelsEnabled) draft.label = label;
    save.mutate(draft);
  }

  const stockUnit = details
    ? {
        ...details.quantity_unit_stock,
        plural_forms: catalog.units.find((row) => row.id === details.quantity_unit_stock.id)
          ?.plural_forms,
      }
    : undefined;

  return (
    <div className="transfer-layout">
      <form
        ref={form}
        className="move-form transfer-form"
        aria-label={t("Inventory")}
        onSubmit={submit}
      >
        <fieldset className="picker-form-lock" disabled={externalBusy}>
          <fieldset disabled={locked}>
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
                lookupDisabled={inventoryDocument.read("flow") !== undefined}
                autoFocus
                workflowPath={`/inventory${inventoryDocument.serverEmbedded ? "?embedded" : ""}`}
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
                onAssignBarcode={inventoryDocument.assignBarcode}
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
            <div className="field-row">
              <div className="field">
                <label htmlFor={`${id}-amount`}>{t("New stock amount")}</label>
                <NumberPicker
                  inputRef={amountInput}
                  id={`${id}-amount`}
                  label={t("New stock amount")}
                  value={amount}
                  required
                  min={tareWeight}
                  step={String(step)}
                  disabled={busy}
                  onChange={setAmount}
                  onKeyUp={amountKeyUp}
                  onStep={amountKeyUp}
                />
              </div>
              <label className="field">
                <span>{t("Quantity unit")}</span>
                <select
                  required
                  disabled={busy || (units.length === 1 && !unitRestored)}
                  value={unitId}
                  onChange={(event) => {
                    setUnitId(event.target.value);
                    changeAmountGroup();
                  }}
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
            {conversion.amount && stockUnit && unit && unit.name !== stockUnit.name ? (
              <p className="field-help">
                {t(
                  "This equals %1$s %2$s",
                  destinationAmount.toLocaleString(),
                  unitLabel(stockUnit, destinationAmount, pluralIndex, false),
                )}
              </p>
            ) : null}
            <p role="status" hidden={!estimateVisible}>
              {estimateMessage}
            </p>
            {tare ? (
              <p role="status">
                {t(
                  "Tare weight handling enabled - please weigh the whole container, the amount to be posted will be automatically calculcated",
                )}
              </p>
            ) : null}
            <p className="field-help">{t("This will apply to added products")}</p>
            {showPurchasedDate ? (
              <NativeDateTimeInput
                inputRef={purchasedInput}
                id={`${id}-purchased-date`}
                caption={t("Purchased date")}
                required
                numeric={features.enabled("STOCK_BEST_BEFORE_DATE_FIELD_NUMBER_PAD")}
                initWithNow
                nextInputSelector={`[id="${id}-due-date"]`}
                value={purchased}
                onChange={setPurchased}
              />
            ) : null}
            <div hidden={!datesEnabled}>
              <div className="field">
                <NativeMainDateInput
                  ref={duePicker}
                  inputRef={dueInput}
                  id={`${id}-due-date`}
                  caption={t("Due date")}
                  datetime={false}
                  syncValue="set"
                  required={dueRequired}
                  numeric={features.enabled("STOCK_BEST_BEFORE_DATE_FIELD_NUMBER_PAD")}
                  value={due}
                  onChange={setDue}
                />
              </div>
              <label className="check-field">
                <input
                  type="checkbox"
                  ref={neverInput}
                  data-native-date-shortcut="1"
                  data-datetimepicker-shortcut-value="2999-12-31"
                  tabIndex={-1}
                  defaultChecked={false}
                />
                {t("Never overdue")}
              </label>
              {due && due < isoDay() ? (
                <p className="field-help">
                  {t("The given date is earlier than today, are you sure?")}
                </p>
              ) : null}
            </div>
            {priceEnabled ? (
              <>
                <div className="field">
                  <label htmlFor={`${id}-price`}>{t("Price")}</label>
                  <NumberPicker
                    id={`${id}-price`}
                    label={t("Price")}
                    currency
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
            ) : (
              <input type="hidden" name="price" value={price} />
            )}
            {locationsEnabled ? (
              <label className="field">
                <span>{t("Location")}</span>
                <select
                  required={locationRequired}
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
                {label === "2" && labelAmount > 0 ? (
                  <small>
                    {n(
                      labelAmount,
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
              ref={userfields}
              nativeFiles
              nativeDirty
              nativeLoadPending
              fields={catalog.fields}
              values={fields}
              creating
              disabled={locked}
              onChange={(name, value) => setFields((current) => ({ ...current, [name]: value }))}
            />
            <NativeUserfieldsLoad
              namespace={"stock"}
              objectId={null}
              fieldCount={catalog.fields.length}
              editor={userfields}
            />
          </fieldset>
          {load.isPending ? <LoadingBlock /> : null}
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
      {!inventoryDocument.serverEmbedded && card !== undefined ? (
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
