import { initialUserfields, saveUserfields, type FieldEdits } from "@/lib/userfields";
import { useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { unitLabel } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useFeatures } from "@/lib/features";
import { usePreferences } from "@/lib/preferences";
import {
  shoppingItemEditor,
  shoppingListsQuery,
  mergedShoppingItem,
  type ShoppingItemOptions,
  type ShoppingItemEditor,
} from "@/lib/shopping-list";
import { useModalDialog } from "@/hooks/useModalDialog";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { UserfieldsEditor } from "./UserfieldsEditor";
import { ShoppingProductPicker } from "./ShoppingProductPicker";

export function ShoppingItemForm({
  itemId,
  listId,
  options,
  onClose,
  onSaved,
}: {
  itemId?: number;
  listId: number;
  options?: ShoppingItemOptions;
  onClose: () => void;
  onSaved: (listId: number) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const title = useId();
  const [pending, setPending] = useState(false);

  const data = useQuery({
    queryKey: ["shopping-item-editor", itemId],
    queryFn: () => shoppingItemEditor(itemId),
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog shopping-list-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();

        if (!pending) onClose();
      }}
    >
      <h2 id={title}>
        {t(itemId === undefined ? "Create shopping list item" : "Edit shopping list item")}
      </h2>
      {data.isLoading ? <LoadingBlock label={t("Loading…")} /> : null}
      {data.isError ? <ErrorBlock message={data.error.message} /> : null}
      {data.isSuccess ? (
        <ItemFields
          data={data.data}
          listId={listId}
          options={options}
          onSaved={onSaved}
          onClose={onClose}
          onPending={setPending}
        />
      ) : (
        <button type="button" className="btn" onClick={onClose}>
          {t("Cancel")}
        </button>
      )}
    </dialog>
  );
}

type UnitChoice = { id: number; name: string; factor: number };

function unitChoices(data: ShoppingItemEditor, productId: string): UnitChoice[] {
  const product = data.products.find((row) => row.id === Number(productId));

  if (!product) return [];
  const found = new Map<number, UnitChoice>();

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
      factor: conversion.to_qu_id === product.qu_id_stock ? 1 : conversion.factor,
    });
  }

  return Array.from(found.values());
}

function ItemFields({
  data,
  listId,
  options,
  onClose,
  onSaved,
  onPending,
}: {
  data: ShoppingItemEditor;
  listId: number;
  options?: ShoppingItemOptions;
  onClose: () => void;
  onSaved: (id: number) => Promise<void> | void;
  onPending: (pending: boolean) => void;
}) {
  const { t, pluralIndex } = useI18n();
  const features = useFeatures();
  const queryClient = useQueryClient();
  const { amountPrecision, formatAmount } = usePreferences();
  const prefillName = options?.productName;

  const barcodeProduct = !prefillName
    ? undefined
    : data.products.find((product) => {
        const barcodes = data.barcodes.find((row) => row.product_id === product.id)?.barcodes;

        return `${barcodes?.toLowerCase() ?? ""},`.includes(prefillName);
      });

  const namedProduct =
    barcodeProduct ?? data.products.find((row) => !!prefillName && row.name.includes(prefillName));

  const initialProduct = data.item
    ? data.products.find((row) => row.id === data.item?.product_id)
    : options?.product !== undefined
      ? data.products.find((row) => row.id === options.product)
      : namedProduct;

  const [productId, setProductId] = useState(initialProduct ? String(initialProduct.id) : "");
  const [unitProductId, setUnitProductId] = useState(productId);

  const initialChoice = unitChoices(data, productId).find(
    (row) => row.id === (data.item ? data.item.qu_id : initialProduct?.qu_id_purchase),
  );

  const requestedAmount =
    options?.amount === undefined ? undefined : Number.parseFloat(options.amount);

  const [amount, setAmount] = useState(() => {
    const initial = data.item
      ? (requestedAmount ?? data.item.amount) * (initialChoice?.factor ?? 1)
      : initialProduct &&
          (options?.merge || options?.flow !== undefined || prefillName !== undefined)
        ? 1
        : (requestedAmount ?? 1);

    return Number.isFinite(initial)
      ? String(data.item ? Number(initial.toFixed(amountPrecision)) : initial)
      : "";
  });

  const [unitId, setUnitId] = useState(initialChoice ? String(initialChoice.id) : "");

  const [selectedList, setSelectedList] = useState(
    options?.list ?? data.item?.shopping_list_id ?? listId,
  );

  const [note, setNote] = useState(data.item?.note ?? "");

  const [values, setValues] = useState<FieldEdits>(() =>
    initialUserfields(data.fields, data.values, !data.item),
  );

  const createdId = useRef<number>(undefined);
  const amountInput = useRef<HTMLInputElement>(null);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [barcodeToLink, setBarcodeToLink] = useState(options?.barcode);
  const mergeSaved = useRef(false);
  const barcodeSaved = useRef(false);
  const [recordSaved, setRecordSaved] = useState(false);
  const [barcodeLinked, setBarcodeLinked] = useState(false);
  const stagedFlow = !!options?.merge || barcodeToLink !== undefined;
  const choices = unitChoices(data, unitProductId);
  const choice = choices.find((row) => row.id === Number(unitId));
  const product = data.products.find((row) => row.id === Number(productId));
  const stockUnit = data.units.find((row) => row.id === product?.qu_id_stock);
  const precision = Math.max(1, amountPrecision);
  const increment = (10 ** -amountPrecision).toFixed(amountPrecision);

  const stockAmount = productId
    ? Number((Number(amount) / (choice?.factor ?? 1)).toFixed(precision))
    : Number(amount);

  const save = useMutation({
    mutationFn: async () => {
      onPending(true);

      const body = {
        shopping_list_id: features.enabled("SHOPPINGLIST_MULTIPLE_LISTS") ? selectedList : 1,
        product_id: productId,
        amount: amount ? stockAmount : "",
        qu_id: unitId,
        note,
      };

      let barcodeFailure: Error | undefined;

      const linkBarcode = async () => {
        if (barcodeToLink === undefined || barcodeSaved.current) return;

        try {
          await api.createObject("product_barcodes", {
            barcode: barcodeToLink,
            product_id: productId,
          });
          barcodeSaved.current = true;
          setBarcodeLinked(true);
        } catch (error) {
          return error instanceof Error ? error : new Error(t("Could not save barcode"));
        }
      };

      const barcodeWrite = linkBarcode();

      try {
        let id = createdId.current ?? data.item?.id;

        if (options?.merge) {
          if (!mergeSaved.current) {
            await api.action("/api/stock/shoppinglist/add-product", {
              product_id: body.product_id,
              product_amount: body.amount,
              qu_id: body.qu_id,
              list_id: body.shopping_list_id,
              note: body.note,
            });
            mergeSaved.current = true;
            setRecordSaved(true);
          }

          if (createdId.current === undefined)
            createdId.current = await mergedShoppingItem(productId, body.shopping_list_id);
          id = createdId.current;
        } else if (!stagedFlow || !recordSaved) {
          if (id === undefined) {
            const result = await api.createObject("shopping_list", body);
            id = Number(result.created_object_id);
            createdId.current = id;
          } else await api.updateObject("shopping_list", id, body);
          setRecordSaved(true);
        }

        if (id === undefined)
          throw new Error(t("Could not load the saved shopping list item. Retry to continue."));
        await saveUserfields("shopping_list", id, data.fields, values, (field, edit) =>
          setValues((current) => ({ ...current, [field]: edit })),
        );
      } finally {
        barcodeFailure = await barcodeWrite;
      }

      if (barcodeFailure) throw barcodeFailure;

      return body.shopping_list_id;
    },
    onSuccess: async (id) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["shopping"] }),
        queryClient.invalidateQueries({ queryKey: shoppingListsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: queryKeys.objects("shopping_list") }),
      ]);
      await onSaved(id);
    },
    onSettled: () => onPending(false),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  const selectProduct = (value: string) => {
    setProductId(value);

    if (!value) return;
    setUnitProductId(value);
    const selected = data.products.find((row) => row.id === Number(value));
    const purchase = unitChoices(data, value).find((row) => row.id === selected?.qu_id_purchase);
    setUnitId(purchase ? String(purchase.id) : "");

    if (!amount) setAmount("1");
  };

  return (
    <form onSubmit={submit}>
      {barcodeToLink !== undefined && !barcodeLinked ? (
        <p className="field-hint">
          <strong>{barcodeToLink}</strong>{" "}
          {t("will be added to the list of barcodes for the selected product on submit")}
        </p>
      ) : null}
      {stagedFlow && recordSaved && save.isError ? (
        <p role="status">{t("The item is saved. Retry to save the remaining changes.")}</p>
      ) : null}
      <fieldset disabled={save.isPending || (stagedFlow && recordSaved)}>
        {features.enabled("SHOPPINGLIST_MULTIPLE_LISTS") ? (
          <label className="field">
            {t("Shopping list")}
            <select
              value={selectedList}
              onChange={(event) => setSelectedList(Number(event.target.value))}
            >
              {data.lists.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <ShoppingProductPicker
          products={data.products}
          barcodes={data.barcodes}
          plugin={data.barcode_lookup_plugin_name}
          value={productId}
          required={!note.length}
          disabled={barcodeLinked}
          autoFocus={!data.item && !initialProduct}
          lookupDisabled={options?.flow !== undefined || barcodeToLink !== undefined}
          listId={features.enabled("SHOPPINGLIST_MULTIPLE_LISTS") ? selectedList : 1}
          itemId={data.item?.id}
          onChange={selectProduct}
          onResolved={() => requestAnimationFrame(() => amountInput.current?.focus())}
          onAssignBarcode={setBarcodeToLink}
          onBusyChange={setPickerBusy}
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
              value={unitId}
              disabled={!choices.length}
              onChange={(event) => setUnitId(event.target.value)}
            >
              <option value="" />
              {choices.map((row) => (
                <option key={row.id} value={row.id}>
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
            rows={10}
            required={!productId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </fieldset>
      <UserfieldsEditor
        fields={data.fields}
        values={values}
        creating={!data.item}
        disabled={save.isPending}
        onChange={(field, edit) => setValues((current) => ({ ...current, [field]: edit }))}
      />
      {save.isError ? <ErrorBlock message={save.error.message} /> : null}
      <div className="actions">
        <button type="button" className="btn" disabled={save.isPending} onClick={onClose}>
          {t("Cancel")}
        </button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending || pickerBusy}>
          {t("Save")}
        </button>
      </div>
    </form>
  );
}
