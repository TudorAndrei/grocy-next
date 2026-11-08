import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { userSettingsQuery } from "@/hooks/queries";
import { useGenericError } from "@/hooks/useGenericError";
import { request } from "@/lib/api";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { nativeQueryParameter } from "@/lib/native-query-flag";
import { usePreferences } from "@/lib/preferences";
import { nativeQuantityUnit } from "@/lib/native-quantity-unit";
import {
  getRecipeIngredientContext,
  type RecipeIngredientContext,
} from "@/lib/recipe-form-context";
import {
  getIngredientProduct,
  ingredientNumber,
  ingredientStockAmount,
  ingredientUnits,
  initialIngredientProduct,
  type IngredientUnit,
} from "@/lib/recipe-ingredient-form";
import type { JsonObject } from "@/lib/json";
import { PageHeader } from "./PageHeader";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";
import { NumberPicker } from "./NumberPicker";
import { ProductPicker } from "./ProductPicker";

export function RecipeIngredientEditor({
  recipeId,
  positionId,
  search,
}: {
  recipeId: number;
  positionId: number | null;
  search: string;
}) {
  const { t } = useI18n();

  const valid =
    Number.isInteger(recipeId) &&
    recipeId > 0 &&
    (positionId === null || (Number.isInteger(positionId) && positionId > 0));

  const settings = useQuery({ ...userSettingsQuery(), refetchOnMount: "always" });

  const context = useQuery({
    queryKey: ["recipe-ingredient-editor", recipeId, positionId],
    queryFn: ({ signal }) => getRecipeIngredientContext(recipeId, positionId, signal),
    enabled: valid,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const [initial, setInitial] = useState<RecipeIngredientContext>();

  if (
    !initial &&
    context.isSuccess &&
    !context.isFetching &&
    settings.isSuccess &&
    !settings.isFetching
  )
    setInitial(context.data);
  const error = context.error ?? settings.error;
  const title = positionId === null ? "Add recipe ingredient" : "Edit recipe ingredient";

  return (
    <>
      <PageHeader title={t(title)} />
      {!valid ? <ErrorBlock message={t("Object not found")} /> : null}
      {error ? (
        <>
          <ErrorBlock message={error.message} />
          <button
            className="btn"
            onClick={() => {
              void context.refetch();
              void settings.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {valid && !initial && !error ? <LoadingBlock /> : null}
      {initial ? <IngredientFields data={initial} search={search} title={title} /> : null}
    </>
  );
}

function IngredientFields({
  data,
  search,
  title,
}: {
  data: RecipeIngredientContext;
  search: string;
  title: string;
}) {
  const { t, pluralIndex } = useI18n();
  const features = useFeatures();
  const navigate = useNavigate();
  const genericError = useGenericError();
  const client = useQueryClient();
  const { amountPrecision: preferencePrecision } = usePreferences();
  const [amountPrecision] = useState(preferencePrecision);
  const id = useId();
  const record = data.position;
  const step = amountPrecision <= 0 ? "1" : `0.${"0".repeat(amountPrecision - 1)}1`;
  const initialQu = String(record?.qu_id || -1);
  const initialAny = record?.only_check_single_unit_in_stock === 1;

  const allUnits = useMemo(
    () => data.units.map((unit) => ({ id: unit.id, name: unit.name ?? "", factor: 1 })),
    [data],
  );

  const initialProduct = useMemo(() => initialIngredientProduct(data, search), [data, search]);
  const [product, setProduct] = useState(initialProduct);

  const [amount, setAmount] = useState(() =>
    ingredientNumber(record ? record.amount : 1, amountPrecision),
  );

  const [units, setUnits] = useState<IngredientUnit[]>(initialAny ? allUnits : []);
  const [unitDisabled, setUnitDisabled] = useState(false);

  const [unit, setUnit] = useState(
    initialAny && allUnits.some((row) => String(row.id) === initialQu) ? initialQu : "",
  );

  const [stockAmount, setStockAmount] = useState(() =>
    initialAny
      ? ingredientStockAmount(
          ingredientNumber(record ? record.amount : 1, amountPrecision),
          1,
          amountPrecision,
        )
      : "",
  );

  const [any, setAny] = useState(initialAny);
  const [minimum, setMinimum] = useState(step);

  const [skip, setSkip] = useState(
    record?.not_check_stock_fulfillment === 1 ||
      data.products.find((row) => row.id === record?.product_id)
        ?.not_check_stock_fulfillment_for_recipes === 1,
  );

  const [round, setRound] = useState(record?.round_up === 1);
  const [variable, setVariable] = useState(record?.variable_amount ?? "");
  const [group, setGroup] = useState(record?.ingredient_group ?? "");
  const [note, setNote] = useState(record?.note ?? "");

  const [price, setPrice] = useState(() =>
    ingredientNumber(record ? record.price_factor : 1, amountPrecision),
  );

  const [busy, setBusy] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [externalBusy, setExternalBusy] = useState(false);
  const [flow] = useState(() => nativeQueryParameter(search, "flow"));
  const [barcode] = useState(() => nativeQueryParameter(search, "barcode"));
  const [barcodeAdded, setBarcodeAdded] = useState(false);
  const [stockUnitName, setStockUnitName] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const owner = useRef<AbortController>(undefined);
  const initialDone = useRef(record === null);
  const valueSet = useRef(false);
  const current = useRef({ amount, unit, units, any });
  const focusTimer = useRef<number>(undefined);

  const focusAmount = useCallback(() => {
    if (focusTimer.current !== undefined) window.clearTimeout(focusTimer.current);
    focusTimer.current = window.setTimeout(
      () => document.getElementById(`${id}-amount`)?.focus(),
      0,
    );
  }, [id]);

  const loadProduct = useCallback(
    (productId: string) => {
      if (!productId) return;
      const signal = owner.current?.signal;
      void getIngredientProduct(productId, signal)
        .then((details) => {
          if (signal?.aborted) return;
          const state = current.current;
          const force = !initialDone.current;

          const available = ingredientUnits(
            data,
            details.product.id,
            details.quantity_unit_stock.id,
          );

          const nextUnits = state.any ? allUnits : available.units;
          let nextUnit = state.any ? state.unit : String(nextUnits[0]?.id ?? "");
          let nextAmount = state.amount;

          if (!valueSet.current || force)
            nextUnit = nextUnits.some((row) => String(row.id) === initialQu) ? initialQu : "";

          if (!valueSet.current) {
            const converted =
              Number(nextAmount) *
              (nextUnits.find((row) => String(row.id) === nextUnit)?.factor ?? Number.NaN);

            // The pinned first conversion passes its options as the locale argument.
            const rendered = converted.toLocaleString();
            nextAmount = Number.isFinite(Number(rendered)) ? rendered : "";
            valueSet.current = true;
          }

          if (available.conversionCount === 1 && !force) nextUnit = String(nextUnits[0]?.id ?? "");

          const nextStock = ingredientStockAmount(
            nextAmount,
            nextUnits.find((row) => String(row.id) === nextUnit)?.factor ?? Number.NaN,
            amountPrecision,
          );

          if (!state.any && initialDone.current)
            nextUnit = nextUnits.some((row) => row.id === details.quantity_unit_stock.id)
              ? String(details.quantity_unit_stock.id)
              : "";
          current.current = {
            amount: nextAmount,
            unit: nextUnit,
            units: nextUnits,
            any: state.any,
          };
          setUnits(nextUnits);
          setUnitDisabled(nextUnits.length === 1);
          setUnit(nextUnit);
          setAmount(nextAmount);
          setStockAmount(nextStock);
          setStockUnitName(details.quantity_unit_stock.name ?? "");
          initialDone.current = true;
          focusAmount();
        })
        .catch((error) => {
          if (!signal?.aborted) console.error(error);
        });
    },
    [data, allUnits, initialQu, amountPrecision, focusAmount],
  );

  useEffect(() => {
    const controller = new AbortController();
    owner.current = controller;
    loadProduct(initialProduct);

    return () => {
      controller.abort();

      if (focusTimer.current !== undefined) window.clearTimeout(focusTimer.current);
      document.body.classList.remove("cursor-busy");
    };
  }, [loadProduct, initialProduct]);
  useEffect(() => {
    document.body.classList.toggle("cursor-busy", busy || externalBusy);

    return () => document.body.classList.remove("cursor-busy");
  }, [busy, externalBusy]);

  const updateAmount = (value: string, selected = unit, choices = units) => {
    current.current = { ...current.current, amount: value, unit: selected, units: choices };
    setAmount(value);
    setStockAmount(
      ingredientStockAmount(
        value,
        choices.find((row) => String(row.id) === selected)?.factor ?? Number.NaN,
        amountPrecision,
      ),
    );
  };

  const selectProduct = (value: string) => {
    setProduct(value);
    loadProduct(value);
  };

  const save = useMutation({
    onMutate: () => setBusy(true),
    mutationFn: async (body: JsonObject) => {
      const signal = owner.current?.signal;
      signal?.throwIfAborted();

      if (flow === "InplaceAddBarcodeToExistingProduct") {
        void request("/api/objects/product_barcodes", {
          method: "POST",
          body: JSON.stringify({
            barcode: barcode === undefined ? undefined : String(barcode),
            product_id: product,
          }),
          signal,
        })
          .then(() => {
            if (!signal?.aborted) {
              setBarcodeAdded(true);
            }
          })
          .catch((error) => {
            if (!signal?.aborted) {
              // Native ends the wrong (inventory) form's busy state here.
              document.body.classList.remove("cursor-busy");
              genericError("Error while saving, probably this item already exists", error);
            }
          });
      }

      await request(record ? `/api/objects/recipes_pos/${record.id}` : "/api/objects/recipes_pos", {
        method: record ? "PUT" : "POST",
        body: JSON.stringify(body),
        signal,
      });
      void client.invalidateQueries({
        queryKey: ["recipe-ingredient-editor"],
        refetchType: "none",
      });
      void client.invalidateQueries({ queryKey: ["recipes"], refetchType: "none" });
      void client.invalidateQueries({ queryKey: ["recipe-overview"], refetchType: "none" });
      void client.invalidateQueries({ queryKey: ["recipe-view"], refetchType: "none" });
      signal?.throwIfAborted();
    },
    onSuccess: () => {
      if (owner.current?.signal.aborted) return;
      window.parent.postMessage(
        { Message: "IngredientsChanged", Payload: null },
        window.location.origin,
      );
      window.parent.postMessage(
        { Message: "CloseLastModal", Payload: null },
        window.location.origin,
      );
    },
    onError: (error) => {
      if (!owner.current?.signal.aborted) {
        setBusy(false);
        setUnitDisabled(false);
        genericError("Error while saving, probably this item already exists", error);
      }
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      busy ||
      externalBusy ||
      pickerBusy ||
      !product ||
      document.querySelector(".combobox-menu-visible") ||
      !event.currentTarget.reportValidity()
    )
      return;

    const body: JsonObject = {
      recipe_id: data.recipe.id,
      product_id: product,
      amount: stockAmount,
      variable_amount: variable,
      round_up: round ? "1" : "0",
      only_check_single_unit_in_stock: any ? "1" : "0",
      not_check_stock_fulfillment: skip ? "1" : "0",
      ingredient_group: group,
      note,
      price_factor: features.enabled("STOCK_PRICE_TRACKING") ? price : "1",
    };

    if (!unitDisabled) body.qu_id = unit;
    save.mutate(body);
  };

  const assignBarcode = (value: string) => {
    const next = {
      flow: "InplaceAddBarcodeToExistingProduct",
      barcode: value,
      embedded: nativeQueryParameter(search, "embedded") !== undefined ? "" : undefined,
    };

    void navigate({
      to: "/recipe/$recipeId/pos/$positionId",
      params: { recipeId: String(data.recipe.id), positionId: String(record?.id ?? "new") },
      search: next,
    });
  };

  const selected = units.find((row) => String(row.id) === unit);
  const destinationAmount = Number(amount) / (selected?.factor ?? Number.NaN);
  const stock = data.units.find((row) => row.name === stockUnitName);

  const stockLabel = stock
    ? nativeQuantityUnit(stock, destinationAmount, pluralIndex)
    : stockUnitName;

  return (
    <>
      <p>
        {t("Recipe")} <strong>{data.recipe.name}</strong>
      </p>
      <form
        ref={form}
        className="move-form household-editor recipe-ingredient-editor"
        aria-label={t(title)}
        onSubmit={submit}
      >
        <fieldset disabled={busy || externalBusy}>
          {flow === "InplaceAddBarcodeToExistingProduct" && !barcodeAdded ? (
            <p>
              <strong>{String(barcode ?? "")}</strong>{" "}
              {t("will be added to the list of barcodes for the selected product on submit")}
            </p>
          ) : null}
          <ProductPicker
            products={data.products.map((row) => ({ id: row.id, name: row.name ?? "" }))}
            barcodes={data.barcodes}
            plugin={data.barcode_lookup_plugin_name}
            value={product}
            required
            disabled={busy || externalBusy}
            lookupDisabled={flow !== undefined}
            autoFocus={!product}
            workflowPath={`/recipe/${data.recipe.id}/pos/${record?.id ?? "new"}${nativeQueryParameter(search, "embedded") !== undefined ? "?embedded" : ""}`}
            onChange={selectProduct}
            onResolved={focusAmount}
            onAssignBarcode={assignBarcode}
            onBusyChange={setPickerBusy}
            onFormBusyChange={setExternalBusy}
          />
          <label className="check" hidden={!features.enabled("STOCK")}>
            <input
              type="checkbox"
              checked={any}
              onChange={(event) => {
                const checked = event.target.checked;
                setAny(checked);
                setMinimum(checked ? step : "0");

                if (checked) {
                  const next = allUnits.some((row) => String(row.id) === initialQu)
                    ? initialQu
                    : "";

                  setUnits(allUnits);
                  setUnitDisabled(false);
                  setUnit(next);
                  updateAmount(amount, next, allUnits);
                  current.current = { amount, unit: next, units: allUnits, any: true };
                } else {
                  current.current.any = false;
                  loadProduct(product);
                }
              }}
            />
            {t("Only check if any amount is in stock")}
          </label>
          <label className="field" htmlFor={`${id}-amount`}>
            {t("Amount")}
          </label>
          <NumberPicker
            id={`${id}-amount`}
            label="Amount"
            value={amount}
            required
            min={minimum}
            step={step}
            onChange={updateAmount}
            onFocus={() => {
              if (!product) form.current?.querySelector<HTMLInputElement>("input[list]")?.focus();
              else {
                const input = document.getElementById(`${id}-amount`);

                if (input instanceof HTMLInputElement) input.select();
              }
            }}
          />
          <label className="field">
            {t("Quantity unit")}
            <select
              required
              value={unit}
              disabled={unitDisabled}
              onChange={(event) => {
                setUnit(event.target.value);
                updateAmount(amount, event.target.value);
              }}
            >
              <option value="" hidden disabled />
              {units.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          {!any && amount && selected && selected.name !== stockUnitName ? (
            <p className="field-hint">
              {t(
                "This equals %1$s %2$s",
                Number.isFinite(destinationAmount) ? destinationAmount.toLocaleString() : "NaN",
                stockLabel ?? "",
              )}
            </p>
          ) : null}
          <label className="field">
            {t("Variable amount")}
            <input value={variable} onChange={(event) => setVariable(event.target.value)} />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={round}
              onChange={(event) => setRound(event.target.checked)}
            />
            {t("Round up quantity amounts to the nearest whole number")}
          </label>
          <label className="check" hidden={!features.enabled("STOCK")}>
            <input
              type="checkbox"
              checked={skip}
              onChange={(event) => setSkip(event.target.checked)}
            />
            {t("Disable stock fulfillment checking for this ingredient")}
          </label>
          <label className="field">
            {t("Group")}
            <input value={group} onChange={(event) => setGroup(event.target.value)} />
          </label>
          <label className="field">
            {t("Note")}
            <textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          {features.enabled("STOCK_PRICE_TRACKING") ? (
            <>
              <label className="field" htmlFor={`${id}-price`}>
                {t("Price factor")}
              </label>
              <NumberPicker
                id={`${id}-price`}
                label="Price factor"
                value={price}
                onChange={setPrice}
                required
                min={step}
                step={step}
              />
            </>
          ) : null}
          <button className="btn btn-primary" type="submit">
            {t("Save")}
          </button>
        </fieldset>
      </form>
    </>
  );
}
