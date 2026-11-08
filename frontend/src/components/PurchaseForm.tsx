import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import moment from "moment";
import { flushSync } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { userSettingsQuery } from "@/hooks/queries";
import { useModalDialog } from "@/hooks/useModalDialog";
import { useGenericError } from "@/hooks/useGenericError";
import { api, request } from "@/lib/api";
import { getTopmostGrocyWindow } from "@/lib/embedded-window";
import { useInvalidateStock } from "@/lib/catalog";
import { isoDay, unitLabel } from "@/lib/format";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { stockEditorUnits } from "@/lib/stock-editor";
import { nativeCurrencyValue, nativeQuantityValue } from "@/lib/native-quantity";
import {
  getPurchaseCatalog,
  getPurchaseDetails,
  getPurchaseBarcode,
  type PurchaseCatalog,
  type PurchaseDetails,
  type PurchaseOptions,
} from "@/lib/purchase";
import { initialUserfields, userfieldUpload } from "@/lib/userfields";
import { saveCustomObjectFields } from "@/lib/custom-object-form";
import { postLabelWebhook } from "@/lib/printing";
import { DocumentTasksProvider, useDocumentTasks } from "@/lib/document-tasks";
import { usePurchaseDocument, type PurchaseDocument } from "@/lib/purchase-document";
import { NativeScriptBindingsProvider } from "@/lib/native-script-bindings";
import { tableText, tableAttribute } from "@/lib/native-table-cell";
import type { JsonObject } from "@/lib/json";
import type { Booking } from "@/lib/types";
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
  options: PurchaseOptions;
  onClose?: () => void;
  onPendingChange?: (pending: boolean) => void;
  onOptionsChange?: (options: PurchaseOptions) => void;
};

export function PurchaseDialog(props: Omit<Props, "onPendingChange">) {
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
      <h2 id={title}>{t("Purchase")}</h2>
      <DocumentTasksProvider identity="purchase-dialog">
        <PurchaseForm
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

export function PurchaseForm(props: Props) {
  const document = usePurchaseDocument(props.options);
  const router = useRouter();
  const physical = router.state.location.pathname.replace(/\/$/, "") === "/purchase";

  return (
    <NativeScriptBindingsProvider key={document.revision} physical={physical}>
      <DocumentTasksProvider identity={`purchase:${document.revision}`}>
        <PurchaseDocumentBody {...props} document={document} />
      </DocumentTasksProvider>
    </NativeScriptBindingsProvider>
  );
}

function PurchaseDocumentBody({ document, ...props }: Props & { document: PurchaseDocument }) {
  const { t } = useI18n();
  const settings = useQuery({ ...userSettingsQuery(), refetchOnMount: "always" });

  const catalog = useQuery({
    queryKey: ["stock", "purchase-editor"],
    queryFn: ({ signal }) => getPurchaseCatalog(signal),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });

  let content: ReactNode;

  if (
    catalog.isSuccess &&
    catalog.isFetchedAfterMount &&
    settings.isSuccess &&
    settings.isFetchedAfterMount
  )
    content = (
      <PurchaseFields
        key={document.revision}
        {...props}
        options={document.initialOptions}
        document={document}
        catalog={catalog.data}
      />
    );
  else
    content = (
      <>
        {catalog.isPending || catalog.isFetching || settings.isPending || settings.isFetching ? (
          <LoadingBlock />
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

  return content;
}

type PurchaseSubmission = {
  product: string;
  amount: string;
  displayAmount: string;
  price: string;
  note: string;
  label?: string;
  unitId?: string;
  store?: string;
};

type Receipt = {
  bookings: (Booking & { stock_id: string; best_before_date?: string | null })[];
  details: PurchaseDetails;
  body: JsonObject;
  product: string;
  embedded: boolean;
  bestBefore: string | null;
};

function PurchaseFields({
  catalog,
  options: initialOptions,
  onClose,
  onPendingChange,
  document: purchaseDocument,
}: Props & { catalog: PurchaseCatalog; document: PurchaseDocument }) {
  const { t, pluralIndex } = useI18n();
  const features = useFeatures();
  const preferences = usePreferences();
  const client = useQueryClient();
  const invalidate = useInvalidateStock();
  const notify = useNotify();
  const genericError = useGenericError();
  const documentTasks = useDocumentTasks();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const userfields = useRef<UserfieldsEditorHandle>(null);
  const picker = useRef<HTMLDivElement>(null);
  const dueInput = useRef<HTMLInputElement>(null);
  const purchasedInput = useRef<HTMLInputElement>(null);
  const duePicker = useRef<NativeMainDateHandle>(null);
  const neverInput = useRef<HTMLInputElement>(null);
  const quantityInput = useRef<HTMLSelectElement>(null);
  const selectedDetails = useRef<PurchaseDetails>(undefined);
  const currentCode = useRef<ProductCode>(undefined);
  const lastCommit = useRef<string>(undefined);
  const alive = useRef(true);
  const owner = useRef(new AbortController());
  const options = initialOptions;
  const [flowFinished, setFlowFinished] = useState(false);
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

  const [product, setProduct] = useState(initial ? String(initial.id) : "");
  const [details, setDetails] = useState<PurchaseDetails>();

  const [amount, setAmount] = useState(() =>
    nativeQuantityValue(String(preferences.purchaseAmount), preferences.amountPrecision),
  );

  const [conversionAmount, setConversionAmount] = useState(() =>
    nativeQuantityValue(String(preferences.purchaseAmount), preferences.amountPrecision),
  );

  const [hintAmount, setHintAmount] = useState(conversionAmount);
  const [hintPrice, setHintPrice] = useState("");
  const [units, setUnits] = useState<ReturnType<typeof stockEditorUnits>>([]);
  const unitChoices = useRef<ReturnType<typeof stockEditorUnits>>([]);
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
  const [fields, setFields] = useState(() => initialUserfields(catalog.fields, {}, false));
  const [pickerBusy, setPickerBusy] = useState(false);
  const [externalBusy, setExternalBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [card, setCard] = useState<number>();
  const [expanded, setExpanded] = useState(false);
  const priceEnabled = features.enabled("STOCK_PRICE_TRACKING");
  const datesEnabled = features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING");
  const locationsEnabled = features.enabled("STOCK_LOCATION_TRACKING");
  const labelsEnabled = features.enabled("LABEL_PRINTER");
  const scanEnabled = options.embedded === undefined && preferences.scanPurchase;
  const precision = preferences.amountPrecision;
  const minimum = precision > 0 ? 10 ** -precision : 1;
  const unit = units.find((row) => String(row.id) === unitId);
  const factor = unit?.factor ?? NaN;

  const postedAmount = (Number(conversionAmount) / factor)
    .toFixed(Math.max(1, precision))
    .replace(/0*$/g, "");

  const tare = details?.product.enable_tare_weight_handling === 1;
  const tareWeight = details?.product.tare_weight ?? 0;
  const minimumAmount = tare ? tareWeight / factor + (details?.stock_amount ?? 0) : minimum;

  const live = useRef({
    product,
    factor,
    totalPrice,
    location,
    store,
    due,
    purchased,
    price,
    usedBarcode,
  });

  useLayoutEffect(() => {
    live.current = {
      product,
      factor,
      totalPrice,
      location,
      store,
      due,
      purchased,
      price,
      usedBarcode,
    };
  }, [product, factor, totalPrice, location, store, due, purchased, price, usedBarcode]);

  function captureAmountGroup(value: string) {
    setConversionAmount(value);
    setHintAmount(value);
    setHintPrice(live.current.price);
  }

  function fillDate(data: PurchaseDetails, selected: { is_freezer: number } | null | undefined) {
    if (!datesEnabled) return;

    const days =
      features.enabled("STOCK_PRODUCT_FREEZING") && selected?.is_freezer
        ? data.product.default_best_before_days_after_freezing
        : data.product.default_best_before_days;

    if (days === -1) {
      if (!neverInput.current?.checked) setDue("2999-12-31");
    } else if (days != null && days !== 0)
      setDue(nativeMainDateFormat(isoDay(days), t("moment_locale"), false));
  }

  function attemptScan(singleUnit = true) {
    if (!scanEnabled || owner.current.signal.aborted) return;

    if (singleUnit)
      flushSync(() => {
        setAmount("1");
        captureAmountGroup("1");
      });

    if (form.current?.checkValidity()) form.current.requestSubmit();
    else
      notify({
        message: t("Scan mode is on but not all required fields could be populated automatically"),
        tone: "warning",
      });
  }

  const load = useMutation({
    mutationFn: async (vars: { product: string; signal: AbortSignal }) => ({
      data: await getPurchaseDetails(vars.product, vars.signal),
      vars,
    }),
    onSuccess: ({ data: selected, vars }) => {
      if (vars.signal.aborted) return;
      selectedDetails.current = selected;

      const choices = stockEditorUnits(
        catalog,
        String(selected.product.id),
        selected.quantity_unit_stock.id,
      );

      const defaultUnit =
        selected.product.enable_tare_weight_handling === 1
          ? selected.quantity_unit_stock.id
          : selected.default_quantity_unit_purchase?.id;

      let nextUnit = defaultUnit === undefined ? "" : String(defaultUnit);
      let nextAmount = String(preferences.purchaseAmount);

      if (purchaseDocument.read("flow") === "shoppinglistitemtostock") {
        const requested = purchaseDocument.read("quId");
        nextUnit = choices.some((row) => String(row.id) === String(requested))
          ? String(requested)
          : "";
        nextAmount = String(
          Number(purchaseDocument.read("amount")) *
            (choices.find((row) => String(row.id) === nextUnit)?.factor ?? NaN),
        );
      }

      const selectedFactor = choices.find((row) => String(row.id) === nextUnit)?.factor ?? NaN;

      if (!Number.isFinite(Number(nextAmount))) nextAmount = "";

      const selectedStore =
        selected.last_shopping_location_id ?? selected.default_shopping_location_id;

      unitChoices.current = choices;
      flushSync(() => {
        setUnlocked(false);
        setDetails(selected);
        setUnits(choices);
        setUnitId(choices.some((row) => String(row.id) === nextUnit) ? nextUnit : "");
        setAmount(nextAmount);
        captureAmountGroup(nextAmount);

        if (locationsEnabled)
          setLocation(
            catalog.locations.some((row) => row.id === selected.location?.id)
              ? String(selected.location!.id)
              : "",
          );

        if (priceEnabled)
          setStore(
            catalog.stores.some((row) => row.id === selectedStore) ? String(selectedStore) : "",
          );

        const nextPrice = selected.last_price
          ? (selected.last_price / selectedFactor).toFixed(preferences.priceDisplayPrecision)
          : "";

        setPrice(nextPrice);
        setHintPrice(nextPrice);

        if (
          selected.product.default_purchase_price_type === 2 ||
          selected.product.default_purchase_price_type === 3
        )
          setTotalPrice(selected.product.default_purchase_price_type === 3);

        if (labelsEnabled) setLabel(String(selected.product.default_stock_label_type ?? 0));
        fillDate(selected, selected.location);
      });

      // The shopping action validates and serializes before the later locale refresh.
      if (
        purchaseDocument.read("flow") === "shoppinglistitemtostock" &&
        preferences.shoppingPurchaseAutoSubmit &&
        form.current?.checkValidity()
      )
        form.current.requestSubmit();
      flushSync(() => {
        setAmount(nativeQuantityValue(nextAmount, precision));

        if (priceEnabled)
          setPrice(nativeCurrencyValue(live.current.price, preferences.priceInputPrecision));
        userfields.current?.refreshCurrencyValues(preferences.priceInputPrecision);
      });
      const selectedCode = currentCode.current;

      if (selectedCode) {
        void getPurchaseBarcode(selectedCode.barcode, vars.signal)
          .then((barcode) => {
            if (vars.signal.aborted) return;

            if (barcode) {
              let rawAmount =
                form.current?.querySelector<HTMLInputElement>(`[id="${id}-amount"]`)?.value ?? "";

              if (barcode.amount) rawAmount = String(barcode.amount);
              flushSync(() => {
                setUsedBarcode(barcode.id);
                setAmount(rawAmount);
                captureAmountGroup(rawAmount);

                if (barcode.qu_id)
                  setUnitId(
                    unitChoices.current.some((row) => row.id === barcode.qu_id)
                      ? String(barcode.qu_id)
                      : "",
                  );

                if (priceEnabled && barcode.shopping_location_id !== null)
                  setStore(
                    catalog.stores.some((row) => row.id === barcode.shopping_location_id)
                      ? String(barcode.shopping_location_id)
                      : "",
                  );

                if (barcode.last_price) {
                  setPrice(String(barcode.last_price));
                  setHintPrice(String(barcode.last_price));
                  setTotalPrice(true);
                }

                if (barcode.note) setNote(barcode.note);
              });
              flushSync(() => {
                setAmount(nativeQuantityValue(rawAmount, precision));

                if (priceEnabled)
                  setPrice(
                    nativeCurrencyValue(live.current.price, preferences.priceInputPrecision),
                  );
                userfields.current?.refreshCurrencyValues(preferences.priceInputPrecision);
              });
            }

            attemptScan(false);
          })
          .catch((reason: Error) => {
            if (!vars.signal.aborted) console.error(reason);
          });
      } else {
        flushSync(() => setUsedBarcode(undefined));
        attemptScan();
      }

      // Native keyup runs after the details callback's refresh and scan attempt.
      const formatted =
        form.current?.querySelector<HTMLInputElement>(`[id="${id}-amount"]`)?.value ?? "";

      flushSync(() => captureAmountGroup(formatted));
      requestAnimationFrame(() =>
        form.current?.querySelector<HTMLInputElement>(`[id="${id}-amount"]`)?.focus(),
      );
    },
    onError: (reason: Error, vars) => {
      if (!vars.signal.aborted) console.error(reason);
    },
  });

  function selectProduct(value: string, selectedCode?: ProductCode) {
    if (value === product && !selectedCode && lastCommit.current === value) return;
    lastCommit.current = value;
    setProduct(value);
    currentCode.current = selectedCode;

    if (!value) return;
    setCard(Number(value));
    load.mutate({ product: value, signal: owner.current.signal });
  }

  const start = useEffectEvent(() => {
    const flow = purchaseDocument.read("flow");

    if (
      purchaseDocument.read("embedded") === undefined &&
      flow !== "InplaceNewProductWithName" &&
      flow !== "InplaceAddBarcodeToExistingProduct"
    )
      return;
    selectProduct(initial ? String(initial.id) : "");
  });

  useEffect(() => {
    alive.current = true;
    owner.current = new AbortController();
    // Install the native document's initial picker event once.
    // eslint-disable-next-line react/set-state-in-effect
    start();

    return () => {
      alive.current = false;
      owner.current.abort();
      window.document.body.classList.remove("cursor-busy");
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
    mutationFn: async (draft: PurchaseSubmission) => {
      const signal = owner.current.signal;
      signal.throwIfAborted();

      const printTask = documentTasks.capture();

      const fresh = await getPurchaseDetails(draft.product, signal);
      signal.throwIfAborted();

      const current = live.current;
      let cost = (Number(draft.price) * current.factor).toFixed(preferences.priceInputPrecision);

      if (current.totalPrice) {
        const weight =
          fresh.product.enable_tare_weight_handling === 1 ? (fresh.product.tare_weight ?? 0) : 0;

        cost = (Number(cost) / (Number.parseFloat(draft.displayAmount) - weight)).toFixed(
          preferences.priceInputPrecision,
        );
      }

      const body: JsonObject = {
        amount: draft.amount,
        price: priceEnabled ? cost : 0,
        best_before_date: datesEnabled ? (dueInput.current?.value ?? current.due) : null,
        note: draft.note,
      };

      if (preferences.showPurchaseDate)
        body.purchased_date = purchasedInput.current?.value ?? current.purchased;

      if (priceEnabled) body.shopping_location_id = current.store;

      if (locationsEnabled) body.location_id = current.location;

      if (draft.label !== undefined) body.stock_label_type = draft.label;

      const bookings = await request<Receipt["bookings"]>(
        `/api/stock/products/${draft.product}/add`,
        {
          method: "POST",
          body: JSON.stringify(body),
          signal,
        },
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
        details: fresh,
        bookings,
        body,
        product: draft.product,
        embedded: false,
        bestBefore: datesEnabled ? current.due : null,
      };

      const first = saved.bookings[0]!;

      const barcodeValues = live.current;

      if (barcodeValues.usedBarcode !== undefined) {
        void request(`/api/objects/product_barcodes/${barcodeValues.usedBarcode}`, {
          method: "PUT",
          body: JSON.stringify({ last_price: barcodeValues.price }),
          signal,
        })
          .finally(() => {
            void client.invalidateQueries({ queryKey: ["stock"], refetchType: "none" });
            void client.invalidateQueries({ queryKey: ["product-related"], refetchType: "none" });
          })
          .catch(() => {});
      }

      if (purchaseDocument.read("flow") === "InplaceAddBarcodeToExistingProduct") {
        const barcode: JsonObject = {
          product_id: saved.product,
          amount: draft.displayAmount,
          note: draft.note,
        };

        const code = purchaseDocument.read("barcode");

        if (code !== undefined) barcode.barcode = code;

        if (draft.unitId !== undefined) barcode.qu_id = draft.unitId;

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
            purchaseDocument.barcodeAdded();
            setFlowFinished(true);
          })
          .catch((reason: Error) => {
            if (signal.aborted) return;
            setSaving(false);
            setUnlocked(true);
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

      if (labelsEnabled && browserLabels && (labelType === 1 || labelType === 2)) {
        const printEntries = (entries: { stock_id: string }[]) => {
          if (printTask.signal.aborted) return;

          for (const entry of entries) {
            const payload: JsonObject = {
              product: saved.details.product.name,
              grocycode: `grcy:p:${saved.product}:${entry.stock_id}`,
            };

            if (datesEnabled) payload.due_date = `${t("DD")}: ${first.best_before_date}`;

            void postLabelWebhook(payload, features.query.data ?? {}, printTask.signal).catch(() =>
              printTask.genericError("Error while executing WebHook"),
            );
          }
        };

        // Native printing runs beside field writes and keeps its callback after reset.
        if (labelType === 2) {
          void request<{ stock_id: string }[]>(`/api/stock/transactions/${first.transaction_id}`, {
            signal: printTask.signal,
          }).then(printEntries, (reason: Error) => {
            if (!printTask.signal.aborted) console.error(reason);
          });
        } else printEntries([first]);
      }

      signal.throwIfAborted();
      saved.embedded = purchaseDocument.read("embedded") !== undefined;

      const edits = Object.fromEntries(
        Object.entries(userfields.current?.snapshot() ?? fields).map(([name, edit]) => {
          const file = edit.readFile ? edit.readFile() : edit.upload?.file;

          return [name, file ? { ...edit, ...userfieldUpload(file) } : edit];
        }),
      );

      // Native Save dispatches fields in parallel and advances on the last dirty callback.
      // Purchase supplies no error callback: a failed last field leaves this stage busy.
      await new Promise<void>((resolve, reject) => {
        const stop = () => reject(signal.reason);
        signal.addEventListener("abort", stop, { once: true });
        void saveCustomObjectFields(
          "stock",
          first.transaction_id,
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
          setUnlocked(true);
        });
        document.body.classList.remove("cursor-busy");
      }

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
            { Message: "AfterItemAdded", Payload: purchaseDocument.read("listitemid") ?? null },
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
        if (purchaseDocument.read("flow") === "InplaceAddBarcodeToExistingProduct") {
          const selected = live.current.product;
          const code = purchaseDocument.read("barcode");
          setAdditionalBarcodes((current) => ({
            ...current,
            [selected]: `${current[selected] ?? ""}${code},`,
          }));
        }

        purchaseDocument.finishFlow();
        setFlowFinished(true);
        const warningDate = saved.bestBefore;
        const nextDue = selectedDetails.current?.next_due_date;

        if (
          preferences.warnEarlierPurchase &&
          datesEnabled &&
          warningDate !== null &&
          nextDue !== null &&
          moment(warningDate).isBefore(nextDue)
        )
          notify({
            message: t("This is due earlier than already in stock items"),
            tone: "warning",
          });
        selectProduct("");
        setAmount(String(preferences.purchaseAmount));
        captureAmountGroup(String(preferences.purchaseAmount));
        setUnits([]);
        unitChoices.current = [];
        currentCode.current = undefined;
        lastCommit.current = undefined;
        setUnitId("");
        setDue("");

        if (datesEnabled) duePicker.current?.Clear();
        setPrice("");
        setHintPrice("");
        setStore("");
        setLocation("");
        setNote("");
        setLabel("0");
        setUsedBarcode(undefined);
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
      setUnlocked(true);
      document.body.classList.remove("cursor-busy");
      console.error(reason);
    },
  });

  const busy = saving || pickerBusy || finished;

  const locked = saving || finished;

  const validAmount =
    !!amount &&
    Number(amount) >= minimumAmount &&
    Number(amount) === Number(Number(amount).toFixed(precision));

  useEffect(() => onPendingChange?.(saving), [saving, onPendingChange]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busy || !details || !unit || !validAmount || !event.currentTarget.reportValidity()) return;

    const draft: PurchaseSubmission = {
      product,
      amount: postedAmount,
      displayAmount: amount,
      price,
      note,
    };

    if (!quantityInput.current?.matches(":disabled")) draft.unitId = unitId;

    if (priceEnabled) draft.store = store;

    if (labelsEnabled) draft.label = label;
    save.mutate(draft);
  }

  const scan = useMutation({
    mutationFn: () => api.putUserSetting("scan_mode_purchase_enabled", !preferences.scanPurchase),
    onSuccess: () => client.invalidateQueries({ queryKey: userSettingsQuery().queryKey }),
  });

  const displayCost = (Number(hintPrice) * factor).toFixed(preferences.priceDisplayPrecision);

  const displayUnitCost = totalPrice
    ? (Number(displayCost) / (Number(hintAmount) - (tare ? tareWeight : 0))).toFixed(
        preferences.priceDisplayPrecision,
      )
    : displayCost;

  const priceHint =
    hintPrice &&
    Number(hintPrice) !== 0 &&
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
        <fieldset className="picker-form-lock" disabled={externalBusy}>
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
                barcodes={catalog.products.map((row) => ({
                  product_id: row.id,
                  barcodes: `${catalog.barcodes.find((entry) => entry.product_id === row.id)?.barcodes ?? ""}${additionalBarcodes[String(row.id)] ?? ""}`,
                }))}
                plugin={catalog.barcode_lookup_plugin_name}
                value={product}
                required
                disabled={busy}
                lookupDisabled={purchaseDocument.read("flow") !== undefined}
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
                  purchaseDocument.assignBarcode(barcode);
                }}
                onBusyChange={setPickerBusy}
                onFormBusyChange={setExternalBusy}
              />
            </div>
            {!flowFinished && options.flow === "InplaceAddBarcodeToExistingProduct" ? (
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
                  onChange={(value) => {
                    setAmount(value);
                    captureAmountGroup(value);
                  }}
                />
              </div>
              <label className="field">
                <span>{t("Quantity unit")}</span>
                <select
                  ref={quantityInput}
                  required
                  disabled={busy || (!unlocked && (units.length === 1 || tare))}
                  value={unitId}
                  onChange={(event) => {
                    setUnitId(event.target.value);
                    captureAmountGroup(amount);
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
            {amount && details && unit && unit.name !== details.quantity_unit_stock.name ? (
              <p className="field-help">
                {t(
                  "This equals %1$s %2$s",
                  (Number(conversionAmount) / factor).toLocaleString(),
                  unitLabel(
                    {
                      ...details.quantity_unit_stock,
                      plural_forms: catalog.units.find(
                        (row) => row.id === details.quantity_unit_stock.id,
                      )?.plural_forms,
                    },
                    Number(conversionAmount) / factor,
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
              <NativeDateTimeInput
                inputRef={purchasedInput}
                id={`${id}-purchased-date`}
                caption={t("Purchased date")}
                required
                numeric={features.enabled("STOCK_BEST_BEFORE_DATE_FIELD_NUMBER_PAD")}
                initWithNow
                showInitialContext
                nextInputSelector={`[id="${id}-due-date"]`}
                value={purchased}
                onChange={setPurchased}
              />
            ) : null}
            {datesEnabled ? (
              <div>
                <div className="field">
                  <NativeMainDateInput
                    ref={duePicker}
                    inputRef={dueInput}
                    id={`${id}-due-date`}
                    caption={t("Due date")}
                    datetime={false}
                    syncValue="set"
                    required
                    numeric={features.enabled("STOCK_BEST_BEFORE_DATE_FIELD_NUMBER_PAD")}
                    value={due}
                    onChange={setDue}
                    nextInputSelector={`[id="${id}-price"]`}
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
            ) : null}
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
                    onChange={(value) => {
                      setHintAmount(amount);
                      setHintPrice(value);
                      setPrice(value);
                    }}
                  />
                </div>
                <div className="field-row">
                  <label className="check-field">
                    <input
                      type="radio"
                      name={`${id}-price-type`}
                      checked={!totalPrice}
                      onChange={() => {
                        setHintAmount(amount);
                        setHintPrice(price);
                        setTotalPrice(false);
                      }}
                    />
                    {unit ? `${unit.name} ${t("price")}` : t("Unit price")}
                  </label>
                  <label className="check-field">
                    <input
                      type="radio"
                      name={`${id}-price-type`}
                      checked={totalPrice}
                      onChange={() => {
                        setHintAmount(amount);
                        setHintPrice(price);
                        setTotalPrice(true);
                      }}
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
