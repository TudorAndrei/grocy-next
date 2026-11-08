import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { request } from "@/lib/api";
import {
  getProductBarcodeForm,
  saveBarcodeUserfield,
  type ProductBarcodeForm,
} from "@/lib/product-barcode-form";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { userSettingsQuery } from "@/hooks/queries";
import { usePreferences } from "@/lib/preferences";
import { compareSqliteNames } from "@/lib/collation";
import { nativeQuantityUnit } from "@/lib/native-quantity-unit";
import { useGenericError } from "@/hooks/useGenericError";
import {
  initialUserfields,
  userfieldUpload,
  userfieldsQuery,
  type UserfieldDefinition,
} from "@/lib/userfields";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { NumberPicker } from "./NumberPicker";
import { CameraScanner } from "./CameraScanner";
import { UserfieldsEditor, type UserfieldsEditorHandle } from "./UserfieldsEditor";
import { NativeUserfieldsLoad } from "./NativeUserfieldsLoad";

export function ProductBarcodeEditor({
  recordId,
  productId,
}: {
  recordId: number | null;
  productId: number;
}) {
  const { t } = useI18n();
  const features = useFeatures();

  const valid =
    Number.isInteger(productId) &&
    productId > 0 &&
    (recordId === null || (Number.isInteger(recordId) && recordId > 0));

  const prices = features.enabled("STOCK_PRICE_TRACKING");
  const definitions = useQuery(userfieldsQuery);
  const settings = useQuery(userSettingsQuery());
  const fields = definitions.data?.filter((field) => field.entity === "product_barcodes") ?? [];

  const data = useQuery({
    queryKey: ["product-barcode-form", recordId, productId, prices],
    queryFn: ({ signal }) => getProductBarcodeForm(recordId, productId, prices, signal),
    enabled: valid && features.query.isSuccess,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const error = data.error ?? definitions.error ?? features.query.error ?? settings.error;

  const ready = data.data && definitions.isSuccess && settings.isSuccess;

  return (
    <>
      <PageHeader
        title={t(recordId === null ? "Create Barcode" : "Edit Barcode")}
        lead={
          data.data ? (
            <>
              {t("Barcode for product")} <strong>{data.data.product.name}</strong>
            </>
          ) : undefined
        }
      />
      {!valid ? <ErrorBlock message={t("Object not found")} /> : null}
      {error ? (
        <>
          <ErrorBlock message={error.message} />
          <button
            className="btn"
            type="button"
            onClick={() => {
              void data.refetch();
              void definitions.refetch();
              void settings.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {valid && !ready && !error ? <LoadingBlock /> : null}
      {ready && data.data ? (
        <BarcodeFields data={data.data} fields={fields} prices={prices} />
      ) : null}
    </>
  );
}

function BarcodeFields({
  data,
  fields,
  prices,
}: {
  data: ProductBarcodeForm;
  fields: UserfieldDefinition[];
  prices: boolean;
}) {
  const { t, pluralIndex } = useI18n();
  const preferences = usePreferences();
  const genericError = useGenericError();
  const client = useQueryClient();
  const id = useId();
  const controller = useRef<AbortController>(undefined);
  const [barcode, setBarcode] = useState(data.barcode?.barcode ?? "");

  const [amount, setAmount] = useState(() =>
    data.barcode?.amount == null || data.barcode.amount === ""
      ? ""
      : Number.parseFloat(String(data.barcode.amount)).toLocaleString("en", {
          minimumFractionDigits: 0,
          maximumFractionDigits: preferences.amountPrecision,
          useGrouping: false,
        }),
  );

  const [unit, setUnit] = useState<string | null>(data.initialUnit);

  const [store, setStore] = useState(
    data.stores.some((row) => row.id === data.barcode?.shopping_location_id)
      ? String(data.barcode?.shopping_location_id)
      : "",
  );

  const [note, setNote] = useState(data.barcode?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [unitRestored, setUnitRestored] = useState(false);

  const [edits, setEdits] = useState(() => initialUserfields(fields, {}, false));

  const barcodeInput = useRef<HTMLInputElement>(null);
  const noteInput = useRef<HTMLInputElement>(null);
  const userfields = useRef<UserfieldsEditorHandle>(null);
  useEffect(() => {
    const scope = new AbortController();
    controller.current = scope;
    const focus = window.setTimeout(() => barcodeInput.current?.focus(), 500);

    return () => {
      scope.abort();
      window.clearTimeout(focus);
      document.body.classList.remove("cursor-busy");
    };
  }, []);

  const saveFields = (recordId: number, signal?: AbortSignal) => {
    signal?.throwIfAborted();

    // Native UserfieldsForm.Save starts each dirty field independently.
    const snapshot = userfields.current?.snapshot() ?? edits;

    for (const field of fields) {
      const edit = snapshot[field.name];
      const file = edit?.readFile ? edit.readFile() : edit?.upload?.file;

      // Native dirty markers and the selected file survive callbacks. Each Save
      // fixes fresh metadata, while its later upload reads the live picker.
      const attempt = file && edit ? { ...edit, ...userfieldUpload(file) } : edit;

      void saveBarcodeUserfield(
        recordId,
        field.name,
        attempt,
        (error) => genericError("Error while saving, probably this item already exists", error),
        signal,
      );
    }
  };

  const save = useMutation({
    onMutate: () => {
      setBusy(true);
      document.body.classList.add("cursor-busy");
    },
    mutationFn: async () => {
      const signal = controller.current?.signal;
      signal?.throwIfAborted();

      const body = {
        product_id: String(data.product.id),
        barcode: barcodeInput.current?.value ?? barcode,
        amount,
        qu_id: unit,
        shopping_location_id: prices ? store : "1",
        note: noteInput.current?.value ?? note,
      };

      if (data.barcode) saveFields(data.barcode.id, signal);

      const result = await request(
        data.barcode
          ? `/api/objects/product_barcodes/${data.barcode.id}`
          : "/api/objects/product_barcodes",
        {
          method: data.barcode ? "PUT" : "POST",
          signal,
          body: JSON.stringify(body),
        },
      );

      signal?.throwIfAborted();

      if (!data.barcode)
        saveFields(
          z.object({ created_object_id: z.coerce.number().int() }).parse(result).created_object_id,
          signal,
        );

      return signal;
    },
    onSuccess: (signal) => {
      if (!signal || signal.aborted) return;
      void Promise.all([
        client.invalidateQueries({ queryKey: ["product-related", data.product.id] }),
        client.invalidateQueries({ queryKey: ["objects", "product_barcodes"] }),
      ]);
      window.parent.postMessage(
        { Message: "ProductBarcodesChanged", Payload: null },
        window.location.origin,
      );
      window.parent.postMessage(
        { Message: "CloseLastModal", Payload: null },
        window.location.origin,
      );
    },
    onError: (error) => {
      if (!controller.current?.signal.aborted) {
        setBusy(false);
        setUnitRestored(true);
        document.body.classList.remove("cursor-busy");
        genericError("Error while saving, probably this item already exists", error);
      }
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      busy ||
      save.isPending ||
      !event.currentTarget.reportValidity() ||
      document.querySelector(".combobox-menu-visible")
    )
      return;
    save.mutate();
  };

  const selected = data.units.find((row) => String(row.id) === unit);
  const converted = Number(amount) / (selected?.factor ?? 1);

  const hint =
    amount && selected && data.purchaseUnit && selected.name !== data.purchaseUnit.name
      ? t(
          "This equals %1$s %2$s",
          preferences.formatAmount(converted),
          nativeQuantityUnit(data.purchaseUnit, converted, pluralIndex),
        )
      : null;

  const step =
    preferences.amountPrecision === 0 ? "1" : `0.${"0".repeat(preferences.amountPrecision - 1)}1`;

  return (
    <form className="move-form household-editor" onSubmit={submit}>
      <fieldset className="picker-form-lock" disabled={busy}>
        <label className="field">
          {t("Barcode")}
          <input
            ref={barcodeInput}
            required
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
          />
        </label>
        <CameraScanner onScan={setBarcode} />
        <div className="field">
          <label htmlFor={`${id}-amount`}>{t("Amount")}</label>
          <NumberPicker
            id={`${id}-amount`}
            label={t("Amount")}
            value={amount}
            min={step}
            step={step}
            onChange={setAmount}
          />
        </div>
        <label className="field">
          {t("Quantity unit")}
          <select
            value={unit ?? ""}
            disabled={data.units.length === 0 && !unitRestored}
            onChange={(event) => setUnit(event.target.value)}
          >
            <option value="" />
            {data.units.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        {hint ? <p className="field-hint">{hint}</p> : null}
        {prices ? (
          <label className="field">
            {t("Store")}
            <select value={store} onChange={(event) => setStore(event.target.value)}>
              <option value="" />
              {[...data.stores]
                .sort((a, b) => compareSqliteNames(a.name, b.name))
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        <label className="field">
          {t("Note")}
          <input ref={noteInput} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <UserfieldsEditor
          ref={userfields}
          fields={fields}
          values={edits}
          creating={data.barcode === null}
          nativeFiles
          nativeDirty
          nativeLoadPending
          disabled={busy}
          onChange={(name, value) => setEdits((current) => ({ ...current, [name]: value }))}
        />
        <NativeUserfieldsLoad
          namespace="product_barcodes"
          objectId={data.barcode?.id ?? null}
          fieldCount={fields.length}
          editor={userfields}
        />
        <button className="btn btn-primary" type="submit">
          {t("Save")}
        </button>
      </fieldset>
    </form>
  );
}
