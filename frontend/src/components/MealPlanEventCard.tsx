import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import type {
  MealPlanCalendar,
  MealPlanEvent,
  MealPlanEntry,
  MealPlanRecipe,
  MealPlanCallbacks,
} from "@/lib/mealplan-calendar";
import {
  mealPlanAction,
  mealPlanConsumedProduct,
  mealPlanTransaction,
} from "@/lib/mealplan-actions";
import { useI18n } from "@/lib/i18n";
import { useFeatures } from "@/lib/features";
import { usePreferences, preferenceEnabled } from "@/lib/preferences";
import { nativeQuantityUnit } from "@/lib/native-quantity-unit";
import { useGenericError } from "@/hooks/useGenericError";
import { useModalDialog } from "@/hooks/useModalDialog";
import { useProductCardMemory } from "@/hooks/useProductCardMemory";
import { EntityPicture } from "./EntityPicture";
import { RichText } from "./RichDescription";
import { ProductOverview } from "./ProductOverview";
import { EmbeddedPageDialog, type EmbeddedPage } from "./EmbeddedPageDialog";
import { useNotify } from "./Toaster";

const saving = "Error while saving, probably this item already exists";
const begin = () => document.body.classList.add("cursor-busy");
const end = () => document.body.classList.remove("cursor-busy");

function useActionSignal(getSignal: MealPlanCallbacks["getSignal"]) {
  const local = useRef<AbortController>(undefined);
  useEffect(() => {
    const scope = new AbortController();
    local.current = scope;

    return () => {
      scope.abort();
      end();
    };
  }, []);

  return () => {
    const page = getSignal();
    const own = local.current?.signal;

    return page && own ? AbortSignal.any([page, own]) : (page ?? own);
  };
}

export function MealPlanEventCard({
  context,
  event,
  onEdit,
  onReload,
  getSignal,
}: {
  context: MealPlanCalendar;
  event: MealPlanEvent;
  onEdit: (entry: MealPlanEntry) => void;
} & MealPlanCallbacks) {
  const { t, n, pluralIndex } = useI18n();
  const features = useFeatures();
  const preferences = usePreferences();
  const genericError = useGenericError();
  const notify = useNotify();
  const client = useQueryClient();
  const router = useRouter();
  const signalForAction = useActionSignal(getSignal);
  const entry = event.entry;
  const done = preferenceEnabled(entry.done);
  const [embedded, setEmbedded] = useState<EmbeddedPage>();
  const readerOpen = embedded?.dialogType.includes("mealplan-recipe-reader") ?? false;
  useEffect(() => {
    if (!readerOpen) return;
    const wasFullscreen = document.body.classList.contains("fullscreen-card");
    document.body.classList.add("fullscreen-card");

    return () => {
      if (!wasFullscreen) document.body.classList.remove("fullscreen-card");
    };
  }, [readerOpen]);
  const [productOpen, setProductOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const memory = useProductCardMemory();
  const recipe = event.recipe;
  const details = event.product_details;
  const shadow = context.internal_recipes.find((row) => row.name === `${entry.day}#${entry.id}`);
  const resolved = context.recipes_resolved.find((row) => row.recipe_id === shadow?.id);

  const name =
    event.type === "recipe"
      ? (recipe?.name ?? "")
      : event.type === "product"
        ? (details?.product.name ?? "")
        : (entry.note ?? "");

  const energy = String(features.query.data?.ENERGY_UNIT ?? "kcal");

  const reloadWrite = async (method: "PUT" | "DELETE", body: { done?: number }) => {
    const signal = signalForAction();

    try {
      await mealPlanAction(client, `/api/objects/meal_plan/${entry.id}`, method, body, signal);

      if (!signal?.aborted) await onReload();
    } catch (error) {
      if (!signal?.aborted) genericError(saving, error instanceof Error ? error : String(error));
    }
  };

  const displayRecipe = async () => {
    if (!recipe) return;
    const signal = signalForAction();

    try {
      await mealPlanAction(
        client,
        `/api/objects/recipes/${recipe.id}`,
        "PUT",
        { desired_servings: String(entry.recipe_servings) },
        signal,
      );

      if (signal?.aborted) return;
      const base = router.buildLocation({ to: "/recipes", search: {} }).publicHref;
      setEmbedded({
        id: Date.now(),
        url: new URL(`${base}?embedded&recipe=${recipe.id}#fullscreen`, window.location.href).href,
        dialogType: "form wider mealplan-recipe-reader",
      });
    } catch (error) {
      if (!signal?.aborted) console.error(error);
    }
  };

  const consumeProduct = async () => {
    if (!details) return;
    const signal = signalForAction();
    begin();
    let transaction: string;

    try {
      transaction = mealPlanTransaction(
        await mealPlanAction(
          client,
          `/api/stock/products/${details.product.id}/consume`,
          "POST",
          { amount: Number.parseFloat(String(entry.product_amount)), spoiled: false },
          signal,
        ),
      );
    } catch (error) {
      if (!signal?.aborted) {
        end();
        console.error(error);
      }

      return;
    }

    let fresh: Awaited<ReturnType<typeof mealPlanConsumedProduct>>;

    try {
      fresh = await mealPlanConsumedProduct(details.product.id, signal);
    } catch (error) {
      if (!signal?.aborted) {
        end();
        console.error(error);
      }

      return;
    }

    try {
      await mealPlanAction(
        client,
        `/api/objects/meal_plan/${entry.id}`,
        "PUT",
        { done: 1 },
        signal,
      );
    } catch (error) {
      if (!signal?.aborted) genericError(saving, error instanceof Error ? error : String(error));

      return;
    }

    if (signal?.aborted) return;
    end();
    const amount = Number.parseFloat(String(entry.product_amount));

    const receipt = t(
      "Removed %1$s of %2$s from stock",
      `${amount} ${nativeQuantityUnit(fresh.quantity_unit_stock, amount, pluralIndex)}`,
      fresh.product.name ?? "",
    );

    notify({
      message: receipt,
      undo: async () => {
        try {
          // Undo is a new user action owned by the retained receipt, after the calendar reload.
          await mealPlanAction(client, `/api/stock/transactions/${transaction}/undo`, "POST", {});
          notify({ message: t("Transaction successfully undone") });
        } catch (error) {
          console.error(error);

          return false;
        }
      },
    });
    await onReload();
  };

  if (event.type === "recipe" && (!recipe || !shadow || !resolved)) return null;

  if (event.type === "product" && !details) return null;
  const productAmount = Number.parseFloat(String(entry.product_amount));
  const productEnough = Number(details?.stock_amount_aggregated) >= productAmount;

  const unit = details
    ? nativeQuantityUnit(details.quantity_unit_stock, productAmount, pluralIndex)
    : "";

  const numeric = (value: number | string | null | undefined) => Number.parseFloat(String(value));

  const picture =
    event.type === "recipe" ? recipe?.picture_file_name : details?.product.picture_file_name;

  return (
    <article className="mealplan-event-card" data-entry-id={entry.id} aria-label={name}>
      {picture ? (
        <EntityPicture
          group={event.type === "recipe" ? "recipepictures" : "productpictures"}
          source={picture}
          label={name}
        />
      ) : null}
      {event.type === "recipe" ? (
        <>
          <h3 className="mealplan-event-title" data-done={done || undefined}>
            <button
              type="button"
              className="btn btn-ghost"
              title={t("Display recipe")}
              aria-label={t("Display recipe")}
              onClick={() => {
                void displayRecipe();
              }}
            >
              {name}
            </button>
          </h3>
          <p>{n(numeric(entry.recipe_servings), "%s serving", "%s servings")}</p>
          {features.enabled("STOCK") ? (
            <p>
              {t(
                Number(resolved?.need_fulfilled) === 1 ? "Enough in stock" : "Not enough in stock",
              )}
            </p>
          ) : null}
          <p>
            {features.enabled("STOCK_PRICE_TRACKING")
              ? `${preferences.formatCurrency(numeric(resolved?.costs), String(features.query.data?.CURRENCY ?? "USD"))} / `
              : ""}
            {(numeric(resolved?.calories) / numeric(entry.recipe_servings)).toLocaleString(
              undefined,
              { maximumFractionDigits: 0 },
            )}{" "}
            {energy} {t("per serving")}
          </p>
        </>
      ) : event.type === "product" ? (
        <>
          <h3 className="mealplan-event-title" data-done={done || undefined}>
            <button
              type="button"
              className="btn btn-ghost"
              title={t("Display product")}
              aria-label={t("Display product")}
              onClick={() => setProductOpen(true)}
            >
              {name}
            </button>
          </h3>
          <p>
            {preferences.formatAmount(productAmount)} {unit}
          </p>
          <p>{t(productEnough ? "Enough in stock" : "Not enough in stock")}</p>
          <p>
            {features.enabled("STOCK_PRICE_TRACKING")
              ? `${preferences.formatCurrency(Number(details?.last_price ?? 0) * productAmount, String(features.query.data?.CURRENCY ?? "USD"))} / `
              : ""}
            {numeric(details?.product.calories).toLocaleString(undefined, {
              maximumFractionDigits: 0,
            })}{" "}
            {energy}
          </p>
        </>
      ) : (
        <div className="mealplan-event-title" data-done={done || undefined}>
          {event.note_html !== undefined ? <RichText html={event.note_html} /> : entry.note}
        </div>
      )}
      <div className="row-actions d-print-none">
        <button className="btn btn-sm" type="button" onClick={() => onEdit(entry)}>
          {t("Edit this item")}
        </button>
        <button
          className="btn btn-sm"
          type="button"
          onClick={() => {
            void reloadWrite("DELETE", {});
          }}
        >
          {t("Delete this item")}
        </button>
        {recipe && event.type === "recipe" ? (
          <MealPlanRecipeActions
            context={context}
            recipe={recipe}
            entry={entry}
            onReload={onReload}
            getSignal={getSignal}
          />
        ) : null}
        {details && event.type === "product" ? (
          <>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!productEnough}
              onClick={() => {
                void consumeProduct();
              }}
            >
              {t("Consume %1$s of %2$s", `${productAmount.toLocaleString()} ${unit}`, name)}
            </button>
            {features.enabled("SHOPPINGLIST") ? (
              <button
                type="button"
                className="btn btn-sm"
                disabled={!(Number(details.stock_amount_aggregated) < productAmount)}
                onClick={() => {
                  const base = router.buildLocation({
                    to: "/shoppinglistitem/$itemId",
                    params: { itemId: "new" },
                    search: {},
                  }).publicHref;

                  setEmbedded({
                    id: Date.now(),
                    url: new URL(
                      `${base}?embedded&updateexistingproduct&list=1&product=${entry.product_id}&amount=${entry.product_amount}`,
                      window.location.href,
                    ).href,
                    dialogType: "form",
                  });
                }}
              >
                {t("Add to shopping list")}
              </button>
            ) : null}
          </>
        ) : null}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            void reloadWrite("PUT", { done: done ? 0 : 1 });
          }}
        >
          {t(done ? "Mark this item as undone" : "Mark this item as done")}
        </button>
      </div>
      {embedded ? (
        <EmbeddedPageDialog page={embedded} onClose={() => setEmbedded(undefined)} />
      ) : null}
      {productOpen && details ? (
        <ProductOverview
          productId={details.product.id}
          memory={memory}
          embedded={false}
          expanded={expanded}
          onExpandedChange={setExpanded}
          onReturn={onReload}
          onClose={() => setProductOpen(false)}
        />
      ) : null}
    </article>
  );
}

export function MealPlanRecipeActions({
  context,
  recipe,
  entry,
  onReload,
  getSignal,
}: {
  context: MealPlanCalendar;
  recipe: MealPlanRecipe;
  entry?: MealPlanEntry;
} & MealPlanCallbacks) {
  const { t } = useI18n();
  const features = useFeatures();
  const genericError = useGenericError();
  const notify = useNotify();
  const client = useQueryClient();
  const signalForAction = useActionSignal(getSignal);

  const shadow = entry
    ? context.internal_recipes.find((row) => row.name === `${entry.day}#${entry.id}`)
    : recipe;

  const resolved = context.recipes_resolved.find((row) => row.recipe_id === shadow?.id);
  const [ordered, setOrdered] = useState(Number(resolved?.need_fulfilled_with_shopping_list) === 1);
  const [confirm, setConfirm] = useState<"shopping" | "consume">();

  const run = async (kind: "shopping" | "consume") => {
    setConfirm(undefined);
    const signal = signalForAction();
    begin();

    if (kind === "shopping") {
      try {
        await mealPlanAction(
          client,
          `/api/objects/recipes/${recipe.id}`,
          "PUT",
          entry ? { desired_servings: String(entry.recipe_servings) } : {},
          signal,
        );
      } catch (error) {
        if (!signal?.aborted) console.error(error);

        return;
      }

      try {
        await mealPlanAction(
          client,
          `/api/recipes/${recipe.id}/add-not-fulfilled-products-to-shoppinglist`,
          "POST",
          {},
          signal,
        );
      } catch (error) {
        if (!signal?.aborted) {
          end();
          console.error(error);
        }

        return;
      }

      if (signal?.aborted) return;

      if (recipe.type === "normal") {
        setOrdered(true);
        end();
      } else await onReload();

      return;
    }

    try {
      await mealPlanAction(
        client,
        `/api/recipes/${shadow?.id ?? recipe.id}/consume`,
        "POST",
        {},
        signal,
      );
    } catch (error) {
      if (!signal?.aborted) {
        end();
        genericError(
          "A server error occured while processing your request",
          error instanceof Error ? error : String(error),
        );
      }

      return;
    }

    try {
      // The native week-summary button has no meal-plan-entry-id attribute.
      await mealPlanAction(
        client,
        `/api/objects/meal_plan/${entry?.id ?? "undefined"}`,
        "PUT",
        { done: 1 },
        signal,
      );
    } catch (error) {
      if (!signal?.aborted) genericError(saving, error instanceof Error ? error : String(error));

      return;
    }

    if (signal?.aborted) return;
    end();
    notify({
      message: t(
        'Removed all in stock ingredients needed by recipe "%s" from stock',
        recipe.name ?? "",
      ),
    });
    await onReload();
  };

  const prompt =
    confirm === "shopping"
      ? t(
          'Are you sure you want to put all missing ingredients for recipe "%s" on the shopping list?',
          recipe.name ?? "",
        )
      : t(
          'Are you sure you want to consume all ingredients needed by recipe "%s" (ingredients marked with "only check if any amount is in stock" will be ignored)?',
          recipe.name ?? "",
        );

  if (!features.enabled("STOCK")) return null;

  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => setConfirm("consume")}>
        {t(
          entry
            ? "Consume all ingredients needed by this recipe"
            : "Consume all ingredients needed by this weeks recipes or products",
        )}
      </button>
      {features.enabled("SHOPPINGLIST") ? (
        <button
          type="button"
          className="btn btn-sm"
          disabled={ordered}
          onClick={() => setConfirm("shopping")}
        >
          {t("Put missing products on shopping list")}
        </button>
      ) : null}
      {confirm ? (
        <MealPlanConfirmation
          message={prompt}
          partial={confirm === "consume"}
          onCancel={() => setConfirm(undefined)}
          onConfirm={() => {
            void run(confirm);
          }}
        />
      ) : null}
    </>
  );
}

function MealPlanConfirmation({
  message,
  partial,
  onCancel,
  onConfirm,
}: {
  message: string;
  partial: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog"
      aria-label={message}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <p>{message}</p>
      {partial ? (
        <p>
          (
          {t(
            "For ingredients that are only partially in stock, the in stock amount will be consumed.",
          )}
          )
        </p>
      ) : null}
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={onConfirm}>
          {t("Yes")}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t("No")}
        </button>
      </div>
    </dialog>
  );
}
