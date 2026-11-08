import { useEffect, useEffectEvent, useId, useRef, useState, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { request } from "@/lib/api";
import { mealPlanAction } from "@/lib/mealplan-actions";
import type { JsonObject } from "@/lib/json";
import type {
  MealPlanCalendar,
  MealPlanEditorRequest,
  MealPlanCallbacks,
} from "@/lib/mealplan-calendar";
import {
  mealPlanAmountUnits,
  mealPlanProductUnit,
  mealPlanRecipeServings,
} from "@/lib/mealplan-entry-form";
import { ingredientNumber, ingredientStockAmount } from "@/lib/recipe-ingredient-form";
import { usePreferences } from "@/lib/preferences";
import { useI18n } from "@/lib/i18n";
import { nativeQuantityUnit } from "@/lib/native-quantity-unit";
import { useGenericError } from "@/hooks/useGenericError";
import { useModalDialog } from "@/hooks/useModalDialog";
import { NativeScriptBindingsProvider } from "@/lib/native-script-bindings";
import { NativeMainDateInput } from "./NativeMainDateInput";
import { NativeDateTimeInput } from "./NativeDateTimeInput";
import type { NativeDateTimeHandle } from "@/lib/native-userfield-dates";
import { RecipePicker } from "./RecipePicker";
import { ProductPicker } from "./ProductPicker";
import { NumberPicker } from "./NumberPicker";

type Props = MealPlanCallbacks & {
  context: MealPlanCalendar;
  request: MealPlanEditorRequest | null;
  onClose: () => void;
};

export function MealPlanEntryDialogs(props: Props) {
  return (
    <NativeScriptBindingsProvider physical>
      <MealPlanDateDialogs {...props} />
    </NativeScriptBindingsProvider>
  );
}

function MealPlanDateDialogs({ context, request: opening, onClose, onReload, getSignal }: Props) {
  const { t, pluralIndex } = useI18n();
  const client = useQueryClient();
  const { amountPrecision } = usePreferences();
  const genericError = useGenericError();
  const prefix = useId();
  const copyDate = useRef<NativeDateTimeHandle>(null);
  const mainDate = useRef<NativeDateTimeHandle>(null);
  const owner = useRef<AbortController | null>(null);
  const current = useRef<MealPlanEditorRequest | null>(null);
  const [lastOpen, setLastOpen] = useState<number>();
  const copies = useRef({ expected: 0, completed: 0 });
  const [day, setDay] = useState("");
  const [copyTo, setCopyTo] = useState("");
  const [recipe, setRecipe] = useState("");
  const [recipeText, setRecipeText] = useState("");
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [servings, setServings] = useState("1");
  const [note, setNote] = useState("");
  const [product, setProduct] = useState("");
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState("");
  const [units, setUnits] = useState<ReturnType<typeof mealPlanAmountUnits>>([]);
  const [stockUnit, setStockUnit] = useState<number>();
  const firstSection = String(context.sections[0]?.id ?? "");
  const [recipeSection, setRecipeSection] = useState(firstSection);
  const [noteSection, setNoteSection] = useState(firstSection);
  const [productSection, setProductSection] = useState(firstSection);

  useEffect(() => {
    const scope = new AbortController();
    owner.current = scope;

    return () => scope.abort();
  }, []);

  const signal = () => {
    const page = getSignal();
    const own = owner.current?.signal;

    return page && own ? AbortSignal.any([page, own]) : (page ?? own);
  };

  const selectRecipe = (value: string, text: string) => {
    setRecipe(value);
    setRecipeText(text);

    if (!value) return;
    const scope = signal();
    void mealPlanRecipeServings(value, scope)
      .then((value) => {
        if (scope?.aborted) return;
        setServings(String(value ?? ""));
        const input = document.getElementById(`${prefix}-servings`);

        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        }
      })
      .catch((error) => {
        if (!scope?.aborted) console.error(error);
      });
  };

  const loadProduct = (value: string) => {
    if (!value) return;
    const scope = signal();
    void mealPlanProductUnit(value, scope)
      .then((details) => {
        if (scope?.aborted) return;

        const choices = mealPlanAmountUnits(
          context,
          details.product.id,
          details.quantity_unit_stock.id,
        );

        setUnits(choices);
        setStockUnit(details.quantity_unit_stock.id);
        setUnit(
          choices.some((row) => row.id === details.quantity_unit_stock.id)
            ? String(details.quantity_unit_stock.id)
            : "",
        );
        setAmount(
          ingredientNumber(
            current.current?.entry ? current.current.entry.product_amount : 1,
            amountPrecision,
          ),
        );
        const input = document.getElementById(`${prefix}-amount`);

        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        }
      })
      .catch((error) => {
        if (!scope?.aborted) console.error(error);
      });
  };

  const selectProduct = (value: string) => {
    setProduct(value);
    loadProduct(value);
  };

  if (opening && lastOpen !== opening.version) {
    setLastOpen(opening.version);
    setDay(opening.entry?.day ?? opening.day);
    setRecipeOpen(false);
    const entry = opening.entry;

    if (opening.kind === "copy") setCopyTo("");
    else if (entry) {
      if (opening.kind === "recipe") {
        const selected = context.recipes.find((row) => row.id === Number(entry.recipe_id));
        // SetId refreshes the text field; it does not dispatch the select's change event.
        setRecipe(selected ? String(selected.id) : "");
        setRecipeText(selected?.name ?? "");
        setServings(String(entry.recipe_servings ?? ""));
        setRecipeSection(
          context.sections.some((row) => row.id === Number(entry.section_id))
            ? String(entry.section_id)
            : "",
        );
      } else if (opening.kind === "product") {
        setProduct(entry.product_id === null ? "" : String(entry.product_id));
        setProductSection(
          context.sections.some((row) => row.id === Number(entry.section_id))
            ? String(entry.section_id)
            : "",
        );
      } else {
        setNote(entry.note ?? "");
        setNoteSection(
          context.sections.some((row) => row.id === Number(entry.section_id))
            ? String(entry.section_id)
            : "",
        );
      }
    } else {
      // All three native Add handlers clear the NOTE section, including the other forms.
      setNoteSection(context.sections.some((row) => row.id === -1) ? "-1" : "");

      if (opening.kind === "recipe") {
        setRecipe("");
        setRecipeText("");
      } else if (opening.kind === "product") setProduct("");
      else setNote("");
    }
  }

  const beginProductEdit = useEffectEvent(() => {
    if (opening) current.current = opening;

    if (opening?.kind === "product" && opening.entry)
      loadProduct(opening.entry.product_id === null ? "" : String(opening.entry.product_id));
  });

  useEffect(() => beginProductEdit(), [opening?.version]);
  useEffect(() => {
    if (opening?.kind === "copy") copyDate.current?.Clear();
  }, [opening?.version, opening?.kind]);

  const saved = async (scope?: AbortSignal) => {
    if (!scope?.aborted) await onReload();
  };

  const failed = (error: Error, scope?: AbortSignal) => {
    if (!scope?.aborted)
      genericError(
        "Error while saving, probably this item already exists",
        error instanceof Error ? error : String(error),
      );
  };

  const save = () => {
    if (!opening) return;
    const scope = signal();
    const currentDay = mainDate.current?.GetValue() ?? day;

    if (opening.kind === "copy") {
      const target = copyDate.current?.GetValue() ?? copyTo;
      void request<JsonObject[]>(`/api/objects/meal_plan?query[]=day=${currentDay}`, {
        signal: scope,
      })
        .then((rows) => {
          if (scope?.aborted) return;
          copies.current.expected = rows.length;

          for (const row of rows) {
            const body: JsonObject = { ...row, day: target, done: 0 };
            delete body.id;
            delete body.row_created_timestamp;
            void mealPlanAction(client, "/api/objects/meal_plan", "POST", body, scope)
              .then(async () => {
                if (scope?.aborted) return;
                copies.current.completed++;

                if (copies.current.completed === copies.current.expected) await saved(scope);
              })
              .catch((error) => failed(error, scope));
          }
        })
        .catch((error) => {
          if (!scope?.aborted) console.error(error);
        });

      return;
    }

    const type = opening.kind;

    const body: JsonObject =
      type === "recipe"
        ? {
            type,
            day: currentDay,
            recipe_id: recipe,
            recipe_servings: servings,
            section_id: recipeSection,
          }
        : type === "note"
          ? { type, day: currentDay, note, section_id: noteSection }
          : {
              type,
              day: currentDay,
              product_id: product,
              product_amount: ingredientStockAmount(
                amount,
                units.find((row) => String(row.id) === unit)?.factor ?? Number.NaN,
                amountPrecision,
              ),
              product_qu_id: unit || null,
              section_id: productSection,
            };

    void mealPlanAction(
      client,
      opening.entry ? `/api/objects/meal_plan/${opening.entry.id}` : "/api/objects/meal_plan",
      opening.entry ? "PUT" : "POST",
      body,
      scope,
    )
      .then(() => saved(scope))
      .catch((error) => failed(error, scope));
  };

  if (!opening) return null;
  const kind = opening.kind;

  const title =
    kind === "copy"
      ? t("Copy all meal plan entries of %s", opening.day)
      : t(opening.entry ? "Edit meal plan entry" : "Add meal plan entry");

  const step = amountPrecision <= 0 ? "1" : `0.${"0".repeat(amountPrecision - 1)}1`;
  const selected = units.find((row) => String(row.id) === unit);
  const destinationAmount = Number(amount) / (selected?.factor ?? Number.NaN);
  const stock = context.units.find((row) => row.id === stockUnit);

  const sections = (
    <label className="field">
      {t("Section")}
      <select
        required
        value={kind === "recipe" ? recipeSection : kind === "note" ? noteSection : productSection}
        onChange={(event) =>
          (kind === "recipe"
            ? setRecipeSection
            : kind === "note"
              ? setNoteSection
              : setProductSection)(event.target.value)
        }
      >
        <option value="" hidden disabled />
        {context.sections.map((section) => (
          <option key={section.id} value={section.id}>
            {section.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <EntryDialog
      key={opening.version}
      title={title}
      kind={kind}
      onClose={onClose}
      onSave={save}
      pickerOpen={recipeOpen}
    >
      {kind === "copy" ? (
        <NativeDateTimeInput
          ref={copyDate}
          id={`${prefix}-day-${opening.version}`}
          caption={t("Day")}
          value={copyTo}
          required
          onChange={setCopyTo}
        />
      ) : (
        <NativeMainDateInput
          ref={mainDate}
          id={`${prefix}-day-${opening.version}`}
          caption={t("Day")}
          datetime={false}
          syncValue="set"
          value={day}
          required
          onChange={setDay}
        />
      )}
      {kind === "recipe" ? (
        <>
          <RecipePicker
            recipes={context.recipes.map((row) => ({ id: row.id, name: row.name ?? "" }))}
            value={recipe}
            text={recipeText}
            disabled={false}
            open={recipeOpen}
            required
            hint=""
            chooseOnEnter
            onOpenChange={setRecipeOpen}
            onChange={selectRecipe}
          />
          <label className="field" htmlFor={`${prefix}-servings`}>
            {t("Servings")}
          </label>
          <NumberPicker
            id={`${prefix}-servings`}
            label="Servings"
            value={servings}
            required
            min={step}
            step={step}
            onChange={setServings}
          />
          {sections}
        </>
      ) : kind === "note" ? (
        <>
          <label className="field">
            {t("Note")}
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
          </label>
          {sections}
        </>
      ) : kind === "product" ? (
        <>
          <ProductPicker
            products={context.products.map((row) => ({ id: row.id, name: row.name ?? "" }))}
            barcodes={[]}
            plugin=""
            value={product}
            required
            disabled={false}
            lookupDisabled={false}
            autoFocus={false}
            onChange={selectProduct}
            onResolved={() => {}}
            onAssignBarcode={() => {}}
            onBusyChange={() => {}}
            onFormBusyChange={() => {}}
          />
          <label className="field" htmlFor={`${prefix}-amount`}>
            {t("Amount")}
          </label>
          <NumberPicker
            id={`${prefix}-amount`}
            label="Amount"
            value={amount}
            required
            min={step}
            step={step}
            onChange={setAmount}
          />
          <label className="field">
            {t("Quantity unit")}
            <select
              required
              value={unit}
              disabled={units.length === 1}
              onChange={(event) => setUnit(event.target.value)}
            >
              <option value="" hidden disabled />
              {units.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          {selected && selected.id !== stockUnit && amount ? (
            <p className="field-hint">
              {t(
                "This equals %1$s %2$s",
                destinationAmount.toLocaleString(),
                stock ? nativeQuantityUnit(stock, destinationAmount, pluralIndex) : "",
              )}
            </p>
          ) : null}
          {sections}
        </>
      ) : null}
    </EntryDialog>
  );
}

function EntryDialog({
  title,
  kind,
  children,
  onClose,
  onSave,
  pickerOpen,
}: {
  title: string;
  kind: MealPlanEditorRequest["kind"];
  children: React.ReactNode;
  onClose: () => void;
  onSave: () => void;
  pickerOpen: boolean;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const input =
      kind === "note"
        ? form.current?.querySelector("textarea")
        : kind === "recipe"
          ? form.current?.querySelector('[role="combobox"]')
          : kind === "product"
            ? form.current?.querySelector("input[list]")
            : form.current?.querySelector("input");

    if (input instanceof HTMLElement) input.focus();
  }, [kind]);

  const submit = () => {
    if (form.current?.reportValidity() && !pickerOpen) onSave();
  };

  const enter = (event: KeyboardEvent<HTMLFormElement>) => {
    if (
      event.key !== "Enter" ||
      event.defaultPrevented ||
      !(event.target instanceof HTMLInputElement) ||
      (kind !== "recipe" && kind !== "product")
    )
      return;
    event.preventDefault();
    submit();
  };

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2>{title}</h2>
      {kind !== "copy" ? (
        <p className="muted">
          {t(kind === "recipe" ? "Recipe" : kind === "note" ? "Note" : "Product")}
        </p>
      ) : null}
      <form ref={form} onSubmit={(event) => event.preventDefault()} onKeyDown={enter}>
        {children}
      </form>
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>
          {t("Cancel")}
        </button>
        <button type="button" className="btn btn-primary" onClick={submit}>
          {t(kind === "copy" ? "Copy" : "Save")}
        </button>
      </div>
    </dialog>
  );
}
