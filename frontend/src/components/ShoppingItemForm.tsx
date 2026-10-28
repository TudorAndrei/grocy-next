import { useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { unitLabel } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useFeatures } from "@/lib/features";
import { usePreferences } from "@/lib/preferences";
import {
  initialUserfields,
  saveUserfields,
  shoppingItemEditor,
  shoppingListsQuery,
  type ShoppingItemEditor,
  type FieldEdits,
} from "@/lib/shopping-list";
import { useModalDialog } from "@/hooks/useModalDialog";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { UserfieldsEditor } from "./UserfieldsEditor";

export function ShoppingItemForm({
  itemId,
  listId,
  onClose,
  onSaved,
}: {
  itemId?: number;
  listId: number;
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
  onClose,
  onSaved,
  onPending,
}: {
  data: ShoppingItemEditor;
  listId: number;
  onClose: () => void;
  onSaved: (id: number) => Promise<void> | void;
  onPending: (pending: boolean) => void;
}) {
  const { t, pluralIndex } = useI18n();
  const features = useFeatures();
  const queryClient = useQueryClient();
  const { amountPrecision, formatAmount } = usePreferences();
  const initialProduct = data.products.find((row) => row.id === data.item?.product_id);
  const [productId, setProductId] = useState(initialProduct ? String(initialProduct.id) : "");
  const [unitProductId, setUnitProductId] = useState(productId);
  const initialChoice = unitChoices(data, productId).find((row) => row.id === data.item?.qu_id);

  const [amount, setAmount] = useState(() =>
    data.item
      ? String(Number((data.item.amount * (initialChoice?.factor ?? 1)).toFixed(amountPrecision)))
      : "1",
  );

  const [unitId, setUnitId] = useState(initialChoice ? String(initialChoice.id) : "");
  const [selectedList, setSelectedList] = useState(data.item?.shopping_list_id ?? listId);
  const [note, setNote] = useState(data.item?.note ?? "");

  const [values, setValues] = useState<FieldEdits>(() =>
    initialUserfields(data.fields, data.values, !data.item),
  );

  const createdId = useRef<number>(undefined);
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

      let id = data.item?.id ?? createdId.current;

      if (id === undefined) {
        const result = await api.createObject("shopping_list", body);
        id = Number(result.created_object_id);
        createdId.current = id;
      } else await api.updateObject("shopping_list", id, body);
      await saveUserfields("shopping_list", id, data.fields, values, (field, edit) =>
        setValues((current) => ({ ...current, [field]: edit })),
      );

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
      <fieldset disabled={save.isPending}>
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
        <label className="field">
          {t("Product")}
          <select
            autoFocus={!data.item}
            value={productId}
            required={!note.length}
            onChange={(event) => selectProduct(event.target.value)}
          >
            <option value="">{t("None")}</option>
            {data.products.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label className="field">
            {t("Amount")}
            <input
              type="number"
              autoFocus={!!data.item}
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
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {t("Save")}
        </button>
      </div>
    </form>
  );
}
