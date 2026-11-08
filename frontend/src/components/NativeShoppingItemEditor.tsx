import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { request } from "@/lib/api";
import { useDocumentTasks } from "@/lib/document-tasks";
import { useFeatures } from "@/lib/features";
import { unitLabel } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { nativeQueryParameter } from "@/lib/native-query-flag";
import { saveNativeObjectFields } from "@/lib/native-object-fields";
import {
  invalidateNativeShoppingItem,
  nativeShoppingReceiptUnit,
} from "@/lib/native-shopping-item-form";
import { usePreferences } from "@/lib/preferences";
import {
  shoppingItemEditor,
  type ShoppingItemEditor,
  type ShoppingItemOptions,
} from "@/lib/shopping-list";
import { initialUserfields } from "@/lib/userfields";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { ProductPicker } from "./ProductPicker";
import { UserfieldsEditor, type UserfieldsEditorHandle } from "./UserfieldsEditor";
import { NativeUserfieldsLoad } from "./NativeUserfieldsLoad";

type Props = {
  recordId: number | null;
  initialOptions: ShoppingItemOptions;
  readSearch: () => string;
  onAssignBarcode: (barcode: string) => void;
  onSaved: (listId: string, embedded: boolean) => Promise<void> | void;
};

const createdIdentity = z.object({
  created_object_id: z.union([z.number(), z.string()]).optional(),
});

const receiptProduct = z.object({ product: z.object({ name: z.string().nullable() }) });

export function NativeShoppingItemEditor(props: Props) {
  const { t } = useI18n();
  const title = props.recordId === null ? "Create shopping list item" : "Edit shopping list item";

  const data = useQuery({
    queryKey: ["shopping-item-editor", props.recordId ?? undefined],
    queryFn: ({ signal }) => shoppingItemEditor(props.recordId ?? undefined, signal),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const [initialContext, setInitialContext] = useState<ShoppingItemEditor>();

  if (!initialContext && data.isSuccess && !data.isFetching) setInitialContext(data.data);

  return (
    <>
      <PageHeader title={t(title)} />
      {!initialContext && !data.error ? <LoadingBlock /> : null}
      {data.error ? <ErrorBlock message={data.error.message} /> : null}
      {initialContext ? <NativeItemFields {...props} data={initialContext} title={title} /> : null}
    </>
  );
}

function unitChoices(data: ShoppingItemEditor, productId: string) {
  const product = data.products.find((row) => row.id === Number(productId));

  const found = new Map<
    number,
    { id: number; name: string; namePlural: string | null; factor: number }
  >();

  if (!product) return [];

  for (const conversion of data.conversions) {
    if (conversion.product_id !== product.id || found.has(conversion.to_qu_id)) continue;

    if (
      conversion.from_qu_id !== product.qu_id_stock &&
      conversion.to_qu_id !== product.qu_id_stock
    )
      continue;
    found.set(conversion.to_qu_id, {
      id: conversion.to_qu_id,
      name: conversion.to_qu_name,
      namePlural: conversion.to_qu_name_plural,
      factor: conversion.to_qu_id === product.qu_id_stock ? 1 : conversion.factor,
    });
  }

  return Array.from(found.values());
}

function NativeItemFields({
  data,
  title,
  recordId,
  initialOptions,
  readSearch,
  onSaved,
  onAssignBarcode,
}: Props & { data: ShoppingItemEditor; title: string }) {
  const { t, pluralIndex } = useI18n();
  const features = useFeatures();
  const client = useQueryClient();
  const documentTasks = useDocumentTasks();
  const { amountPrecision, formatAmount } = usePreferences();
  const prefillName = initialOptions.productName;

  const namedProduct =
    data.products.find((product) => {
      if (!prefillName) return false;
      const barcodes = data.barcodes.find((row) => row.product_id === product.id)?.barcodes;

      return `${barcodes?.toLowerCase() ?? ""},`.includes(prefillName);
    }) ?? data.products.find((row) => !!prefillName && row.name.includes(prefillName));

  const initialProduct = data.item
    ? data.products.find((row) => row.id === data.item?.product_id)
    : initialOptions.product !== undefined
      ? data.products.find((row) => row.id === initialOptions.product)
      : namedProduct;

  const [productId, setProductId] = useState(initialProduct ? String(initialProduct.id) : "");
  const [unitProductId, setUnitProductId] = useState(productId);

  const initialChoice = unitChoices(data, productId).find(
    (row) => row.id === (data.item ? data.item.qu_id : initialProduct?.qu_id_purchase),
  );

  const requestedAmount =
    initialOptions.amount === undefined ? undefined : Number.parseFloat(initialOptions.amount);

  const [amount, setAmount] = useState(() => {
    const initial = data.item
      ? (requestedAmount ?? data.item.amount) * (initialChoice?.factor ?? 1)
      : initialProduct &&
          (initialOptions.merge || initialOptions.flow !== undefined || prefillName !== undefined)
        ? 1
        : (requestedAmount ?? 1);

    return Number.isFinite(initial)
      ? String(data.item ? Number(initial.toFixed(amountPrecision)) : initial)
      : "";
  });

  const [unitId, setUnitId] = useState(initialChoice ? String(initialChoice.id) : "");

  const [selectedList, setSelectedList] = useState(
    String(
      initialOptions.list ??
        (features.enabled("SHOPPINGLIST_MULTIPLE_LISTS")
          ? (data.item?.shopping_list_id ?? data.lists[0]?.id ?? 1)
          : 1),
    ),
  );

  const [note, setNote] = useState(data.item?.note ?? "");

  const [edits, setEdits] = useState(() => initialUserfields(data.fields, {}, false));

  const [busy, setBusy] = useState(false);
  const [externalBusy, setExternalBusy] = useState(false);
  const [unitRestored, setUnitRestored] = useState(false);
  const [barcodeHint, setBarcodeHint] = useState(initialOptions.barcode);
  const [pickerBusy, setPickerBusy] = useState(false);
  const amountInput = useRef<HTMLInputElement>(null);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const listInput = useRef<HTMLSelectElement | HTMLInputElement>(null);
  const unitInput = useRef<HTMLSelectElement>(null);
  const userfields = useRef<UserfieldsEditorHandle>(null);
  const scope = useRef<AbortController>(undefined);
  const saving = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;

    return () => {
      controller.abort();
      document.body.classList.remove("cursor-busy");
    };
  }, []);

  const read = (name: string) => nativeQueryParameter(readSearch(), name);
  const choices = unitChoices(data, unitProductId);
  const choice = choices.find((row) => row.id === Number(unitId));
  const product = data.products.find((row) => row.id === Number(productId));
  const stockUnit = data.units.find((row) => row.id === product?.qu_id_stock);
  const stockAmount = Number(amount) / (choice?.factor ?? 1);
  const increment = (10 ** -amountPrecision).toFixed(amountPrecision);
  const settle = () => invalidateNativeShoppingItem(client);

  const endBusy = () => {
    saving.current = false;
    setBusy(false);
    setExternalBusy(false);
    setUnitRestored(true);
    document.body.classList.remove("cursor-busy");
  };

  const save = async () => {
    const owner = scope.current;

    if (!owner || saving.current) return;
    const task = documentTasks.capture();
    const signal = AbortSignal.any([task.signal, owner.signal]);
    signal.throwIfAborted();
    const display = amountInput.current?.value ?? amount;

    const body = {
      shopping_list_id: listInput.current?.value ?? selectedList,
      product_id: productId,
      amount: productId
        ? (Number(display) / Number(choice?.factor))
            .toFixed(Math.max(1, amountPrecision))
            .replace(/0*$/g, "")
        : display,
      qu_id: unitInput.current?.selectedIndex === -1 ? null : (unitInput.current?.value ?? unitId),
      note: (noteInput.current?.value ?? note).replace(/\r?\n/g, "\r\n"),
    };

    const displayAmount = Number.parseFloat(display);
    saving.current = true;
    setBusy(true);
    document.body.classList.add("cursor-busy");

    if (read("flow") === "InplaceAddBarcodeToExistingProduct") {
      void request("/api/objects/product_barcodes", {
        method: "POST",
        signal,
        body: JSON.stringify({ barcode: read("barcode"), product_id: body.product_id }),
      })
        .then(() => {
          if (!signal.aborted) setBarcodeHint(undefined);
        })
        .catch((error: Error) => {
          if (signal.aborted) return;
          endBusy();
          task.genericError("Error while saving, probably this item already exists", error);
        })
        .finally(settle);
    }

    const merge = read("updateexistingproduct") !== undefined;
    let identity: number | string | undefined = recordId ?? undefined;

    try {
      const result = await request<unknown>(
        merge
          ? "/api/stock/shoppinglist/add-product"
          : recordId === null
            ? "/api/objects/shopping_list"
            : `/api/objects/shopping_list/${recordId}`,
        {
          method: merge || recordId === null ? "POST" : "PUT",
          signal,
          body: JSON.stringify(
            merge
              ? {
                  product_id: body.product_id,
                  product_amount: body.amount,
                  qu_id: body.qu_id,
                  list_id: body.shopping_list_id,
                  note: body.note,
                }
              : body,
          ),
        },
      );

      if (signal.aborted) return;
      // Native add-product returns204: its success({}) leaves EditObjectId undefined.

      if (merge || recordId === null)
        identity = createdIdentity.parse(result ?? {}).created_object_id;
    } catch (error) {
      if (!signal.aborted) {
        endBusy();
        console.error(error);
      }

      return;
    } finally {
      settle();
    }

    if (signal.aborted) return;
    void saveNativeObjectFields({
      namespace: "shopping_list",
      id: identity,
      fields: data.fields,
      readEdits: () => userfields.current?.snapshot() ?? edits,
      fileError: (error) =>
        task.genericError("Error while saving, probably this item already exists", error),
      signal,
      settled: settle,
    }).catch(() => {});

    const embedded = read("embedded") !== undefined;

    if (embedded && (merge || body.product_id)) {
      try {
        const details = receiptProduct.parse(
          await request(`/api/stock/products/${body.product_id}`, { signal }),
        );

        if (signal.aborted) return;

        if (read("product") !== undefined) {
          const currentOption = unitInput.current?.selectedOptions[0];

          const currentList =
            listInput.current instanceof HTMLSelectElement
              ? (listInput.current.selectedOptions[0]?.textContent ?? "")
              : "";

          const message = t(
            'Added %1$s of %2$s to the shopping list "%3$s"',
            `${displayAmount.toLocaleString()} ${nativeShoppingReceiptUnit(
              data.units,
              currentOption?.textContent ?? "",
              currentOption?.getAttribute("data-qu-name-plural") ?? "",
              displayAmount,
              pluralIndex,
            )}`,
            String(details.product.name),
            currentList,
          );

          window.parent.postMessage(
            { Message: "ShowSuccessMessage", Payload: message },
            window.location.origin,
          );
        }
      } catch (error) {
        if (!signal.aborted) console.error(error);

        return;
      }
    }

    if (!signal.aborted) await onSaved(listInput.current?.value ?? selectedList, embedded);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      saving.current ||
      !event.currentTarget.reportValidity() ||
      document.querySelector(".combobox-menu-visible")
    )
      return;
    void save();
  };

  const selectProduct = (value: string) => {
    setProductId(value);

    if (!value) return;
    setUnitProductId(value);
    setUnitRestored(false);
    const selected = data.products.find((row) => row.id === Number(value));
    const purchase = unitChoices(data, value).find((row) => row.id === selected?.qu_id_purchase);
    setUnitId(purchase ? String(purchase.id) : "");

    if (!amount) setAmount("1");
  };

  return (
    <form
      className="move-form household-editor"
      aria-label={t(title)}
      noValidate
      onSubmit={submit}
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          event.key !== "Enter" ||
          !(event.target instanceof HTMLInputElement)
        )
          return;
        event.preventDefault();

        if (
          event.currentTarget.reportValidity() &&
          !document.querySelector(".combobox-menu-visible")
        )
          void save();
      }}
    >
      <fieldset className="picker-form-lock" disabled={busy || externalBusy}>
        {barcodeHint !== undefined ? (
          <p className="field-hint">
            <strong>{barcodeHint}</strong>{" "}
            {t("will be added to the list of barcodes for the selected product on submit")}
          </p>
        ) : null}
        {features.enabled("SHOPPINGLIST_MULTIPLE_LISTS") ? (
          <label className="field">
            {t("Shopping list")}
            <select
              ref={(node) => {
                listInput.current = node;
              }}
              value={selectedList}
              onChange={(event) => setSelectedList(event.target.value)}
            >
              {data.lists.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <input
            ref={(node) => {
              listInput.current = node;
            }}
            type="hidden"
            value={selectedList}
          />
        )}
        <ProductPicker
          products={data.products}
          barcodes={data.barcodes}
          plugin={data.barcode_lookup_plugin_name}
          value={productId}
          required={!note.length}
          disabled={false}
          lookupDisabled={read("flow") !== undefined}
          autoFocus={!data.item && !initialProduct}
          listId={Number(selectedList)}
          itemId={data.item?.id}
          onChange={selectProduct}
          onResolved={() => requestAnimationFrame(() => amountInput.current?.focus())}
          onAssignBarcode={onAssignBarcode}
          onBusyChange={setPickerBusy}
          onFormBusyChange={setExternalBusy}
        />
        <div className="form-grid">
          <label className="field">
            {t("Amount")}
            <input
              ref={amountInput}
              type="number"
              autoFocus={!!data.item || !!initialProduct}
              required
              min={increment}
              step={increment}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <label className="field">
            {t("Quantity unit")}
            <select
              ref={unitInput}
              value={unitId}
              disabled={!choices.length && !unitRestored}
              onChange={(event) => setUnitId(event.target.value)}
            >
              <option value="" />
              {choices.map((row) => (
                <option key={row.id} value={row.id} data-qu-name-plural={String(row.namePlural)}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {product && choice && choice.id !== product.qu_id_stock && amount ? (
          <p className="field-hint">
            {t(
              "This equals %1$s %2$s",
              formatAmount(stockAmount),
              unitLabel(stockUnit, stockAmount, pluralIndex, false),
            )}
          </p>
        ) : null}
        <label className="field">
          {t("Note")}
          <textarea
            ref={noteInput}
            rows={10}
            required={!productId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <UserfieldsEditor
          ref={userfields}
          fields={data.fields}
          values={edits}
          creating={recordId === null}
          nativeFiles
          nativeDirty
          nativeLoadPending
          disabled={busy || externalBusy}
          onChange={(name, edit) => setEdits((current) => ({ ...current, [name]: edit }))}
        />
        <NativeUserfieldsLoad
          namespace="shopping_list"
          objectId={recordId}
          fieldCount={data.fields.length}
          editor={userfields}
        />
        <button className="btn btn-primary" type="submit" disabled={pickerBusy}>
          {t("Save")}
        </button>
      </fieldset>
    </form>
  );
}
