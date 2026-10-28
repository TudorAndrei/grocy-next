import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useCatalog, useInvalidateStock } from "@/lib/catalog";
import { useFeatures } from "@/lib/features";
import { formatAmount, unitLabel } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import type { RecipeCard, RecipeView } from "@/lib/recipe-view";
import { EntityPicture } from "./EntityPicture";
import { ErrorBlock } from "./ErrorBlock";
import { FullscreenCard, FullscreenPrint, FullscreenToggle } from "./FullscreenCard";
import { Icon } from "./Icon";
import { PageHeader } from "./PageHeader";
import { RichText } from "./RichDescription";
import { useNotify } from "./Toaster";
import { RecipeMealPlanAction } from "./RecipeMealPlan";
import { GrocycodeActions } from "./GrocycodeActions";
import { useModalDialog } from "@/hooks/useModalDialog";

export function RecipeReader({
  view,
  overlay = false,
  onClose,
}: {
  view: RecipeView;
  overlay?: boolean;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const client = useQueryClient();
  const features = useFeatures();
  const preferences = usePreferences();
  const notify = useNotify();
  const invalidateStock = useInvalidateStock();
  const [selected, setSelected] = useState(view.recipe_id);

  const [action, setAction] = useState<{ kind: "cook" | "shopping"; card: RecipeCard } | null>(
    null,
  );

  const card = view.cards.find((item) => item.id === selected) ?? view.cards[0];
  const root = view.cards[0];
  const [draft, setDraft] = useState<string | null>(null);
  const lastSubmitted = useRef<number | null>(null);
  const tabRefs = useRef(new Map<number, HTMLButtonElement>());
  const prefix = useId();
  const servings = draft ?? String(root.desired_servings);
  const valid = Number.isFinite(Number(servings)) && Number(servings) > 0;

  const saveServings = useMutation({
    scope: { id: `recipe-servings-${view.recipe_id}` },
    mutationFn: (value: number) =>
      api.updateObject("recipes", view.recipe_id, { desired_servings: value }),
    onSuccess: async (_data, value) => {
      await client.invalidateQueries();
      setDraft((current) => (current !== null && Number(current) === value ? null : current));
    },
  });

  const save = saveServings.mutate;

  useEffect(() => {
    const value = Number(servings);

    if (!valid || value === root.desired_servings || value === lastSubmitted.current) return;

    const timer = window.setTimeout(() => {
      lastSubmitted.current = value;
      save(value);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [servings, valid, root.desired_servings, save]);

  const changingServings =
    !valid || Number(servings) !== root.desired_servings || saveServings.isPending;

  const cook = useMutation({
    mutationFn: (id: number) => api.action(`/api/recipes/${id}/consume`, {}),
    onSuccess: async () => {
      await invalidateStock();
      notify({ message: t("Ingredients consumed from stock") });
    },
    onError: (error: Error) => notify({ message: error.message, tone: "error" }),
  });

  const shopping = useMutation({
    mutationFn: ({ id, excludedProductIds }: { id: number; excludedProductIds: number[] }) =>
      api.action(`/api/recipes/${id}/add-not-fulfilled-products-to-shoppinglist`, {
        excludedProductIds,
      }),
    onSuccess: async () => {
      await client.invalidateQueries();
      notify({ message: t("Missing ingredients added to the shopping list") });
    },
    onError: (error: Error) => notify({ message: error.message, tone: "error" }),
  });

  const copy = useMutation({
    mutationFn: () => api.copyRecipe(card.id),
    onSuccess: async (id) => {
      await client.invalidateQueries();
      onClose?.();
      await navigate({ to: "/recipes", search: { recipe: id }, hash: "" });
    },
    onError: (error: Error) => notify({ message: error.message, tone: "error" }),
  });

  function onTabKey(event: KeyboardEvent, index: number) {
    let next = index;

    if (event.key === "ArrowRight") next = (index + 1) % view.cards.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + view.cards.length) % view.cards.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = view.cards.length - 1;
    else return;
    event.preventDefault();
    const target = view.cards[next];

    if (target) {
      setSelected(target.id);
      tabRefs.current.get(target.id)?.focus();
    }
  }

  return (
    <FullscreenCard
      className="recipe-reader"
      label={card.name}
      hash={!overlay}
      defaultExpanded={overlay}
      onClose={onClose}
    >
      <PageHeader
        title={card.name}
        lead={`${t("Servings")}: ${card.desired_servings}`}
        back={
          <>
            <Link
              to="/recipes"
              className="back-link"
              onClick={(event) => {
                if (
                  overlay &&
                  onClose &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.shiftKey &&
                  !event.altKey
                ) {
                  event.preventDefault();
                  onClose();
                }
              }}
            >
              <Icon name="back" />
              {t("Recipes")}
            </Link>
            {view.cards.length > 1 ? (
              <div className="tabs recipe-tabs" role="tablist" aria-label={t("Included recipes")}>
                {view.cards.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    id={`${prefix}-tab-${item.id}`}
                    aria-controls={`${prefix}-panel-${item.id}`}
                    aria-selected={item.id === card.id}
                    tabIndex={item.id === card.id ? 0 : -1}
                    ref={(element) => {
                      if (element) tabRefs.current.set(item.id, element);
                      else tabRefs.current.delete(item.id);
                    }}
                    onClick={() => setSelected(item.id)}
                    onKeyDown={(event) => onTabKey(event, index)}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        }
        actions={
          <>
            <FullscreenToggle />
            <FullscreenPrint />
            <RecipeMealPlanAction id={card.id} name={card.name} />
            <GrocycodeActions kind="recipe" id={card.id} name={card.name} />
            {card.id === view.recipe_id ? (
              <label className="field servings-field">
                <span>{t("Desired servings")}</span>
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  value={servings}
                  aria-invalid={!valid}
                  onChange={(event) => {
                    lastSubmitted.current = null;
                    setDraft(event.target.value);
                  }}
                />
              </label>
            ) : null}
            <button
              className="btn btn-ghost"
              disabled={copy.isPending}
              onClick={() => copy.mutate()}
            >
              {t("Copy recipe")}
            </button>
            {features.enabled("SHOPPINGLIST") ? (
              <button
                className="btn"
                disabled={
                  shopping.isPending || changingServings || card.need_fulfilled_with_shopping_list
                }
                onClick={() => setAction({ kind: "shopping", card })}
              >
                {t("Add missing to list")}
              </button>
            ) : null}
            {features.enabled("STOCK") ? (
              <button
                className="btn btn-primary"
                disabled={cook.isPending || changingServings}
                onClick={() => setAction({ kind: "cook", card })}
              >
                {cook.isPending ? t("Cooking…") : t("Cook and consume")}
              </button>
            ) : null}
          </>
        }
      />
      {saveServings.error ? (
        <>
          <ErrorBlock message={saveServings.error.message} />
          <button
            className="btn"
            onClick={() => save(Number(servings))}
            disabled={!valid || saveServings.isPending}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {view.cards.map((item) => (
        <section
          key={item.id}
          className="recipe-card"
          id={`${prefix}-panel-${item.id}`}
          role={view.cards.length > 1 ? "tabpanel" : undefined}
          aria-labelledby={view.cards.length > 1 ? `${prefix}-tab-${item.id}` : undefined}
          hidden={item.id !== card.id}
        >
          <h1 className="recipe-print-title" hidden>
            {item.name}
          </h1>
          {item.picture_file_name ? (
            <EntityPicture
              group="recipepictures"
              source={item.picture_file_name}
              label={t("%s picture", item.name)}
            />
          ) : null}
          <div className="recipe-totals">
            {item.calories > 0 ? (
              <p>
                {String(features.query.data?.ENERGY_UNIT ?? "kcal")}:{" "}
                {item.calories.toLocaleString(undefined, { maximumFractionDigits: 0 })}{" "}
                {t("per serving")}
              </p>
            ) : null}
            {features.enabled("STOCK_PRICE_TRACKING") ? (
              <p>
                {t("Costs")}:{" "}
                {preferences.formatCurrency(
                  item.costs,
                  String(features.query.data?.CURRENCY ?? "USD"),
                )}{" "}
                {item.prices_incomplete ? (
                  <span className="muted">
                    {t("No price information is available for at least one ingredient")}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
          <div className="recipe-content">
            {item.ingredients.length ? <RecipeIngredients card={item} /> : null}
            {item.preparation_html ? (
              <section>
                <h2>{t("Preparation")}</h2>
                <RichText html={item.preparation_html} />
              </section>
            ) : null}
          </div>
        </section>
      ))}
      {action ? (
        <RecipeActionDialog
          kind={action.kind}
          name={action.card.name}
          missingIngredients={view.missing_ingredients}
          onClose={() => setAction(null)}
          onConfirm={(excludedProductIds) => {
            if (action.kind === "cook") cook.mutate(action.card.id);
            else shopping.mutate({ id: action.card.id, excludedProductIds });
            setAction(null);
          }}
        />
      ) : null}
    </FullscreenCard>
  );
}

function RecipeActionDialog({
  kind,
  name,
  missingIngredients,
  onClose,
  onConfirm,
}: {
  kind: "cook" | "shopping";
  name: string;
  missingIngredients: RecipeView["missing_ingredients"];
  onClose: () => void;
  onConfirm: (excludedProductIds: number[]) => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const [excluded, setExcluded] = useState(new Set<number>());
  const prefix = useId();

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog"
      aria-labelledby={`${prefix}-title`}
      aria-describedby={`${prefix}-message`}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={`${prefix}-title`}>
        {t(kind === "cook" ? "Cook and consume" : "Add missing to list")}
      </h2>
      <p id={`${prefix}-message`}>
        {kind === "cook"
          ? t(
              'Are you sure you want to consume all ingredients needed by recipe "%s" (ingredients marked with "only check if any amount is in stock" will be ignored)?',
              name,
            )
          : t(
              'Are you sure you want to put all missing ingredients for recipe "%s" on the shopping list?',
              name,
            )}
      </p>
      {kind === "cook" ? (
        <p>
          {t(
            "For ingredients that are only partially in stock, the in stock amount will be consumed.",
          )}
        </p>
      ) : (
        <fieldset>
          <legend>{t("Uncheck ingredients to not put them on the shopping list")}</legend>
          <ul className="recipe-shopping-choices">
            {missingIngredients.map((ingredient, index) => (
              <li key={index}>
                <label>
                  <input
                    type="checkbox"
                    checked={!excluded.has(index)}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setExcluded((current) => {
                        const next = new Set(current);

                        if (checked) next.delete(index);
                        else next.add(index);

                        return next;
                      });
                    }}
                  />
                  {ingredient.product_name}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <div className="recipe-action-buttons">
        <button className="btn" onClick={onClose}>
          {t("No")}
        </button>
        <button
          className="btn btn-primary"
          onClick={() =>
            onConfirm(
              missingIngredients.flatMap((ingredient, index) =>
                excluded.has(index) ? [ingredient.product_id] : [],
              ),
            )
          }
        >
          {t("Yes")}
        </button>
      </div>
    </dialog>
  );
}

function RecipeIngredients({ card }: { card: RecipeCard }) {
  const { t, pluralIndex } = useI18n();
  const catalog = useCatalog();
  const features = useFeatures();
  const preferences = usePreferences();
  const [done, setDone] = useState(new Set<number>());

  const amountText = (value: number) =>
    value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: preferences.amountPrecision,
    });

  return (
    <section aria-label={`${t("Ingredients")}: ${card.name}`}>
      <h2>{t("Ingredients")}</h2>
      <ul className="recipe-ingredients">
        {card.ingredients.map((ingredient, index) => {
          const previous = card.ingredients[index - 1];

          const ingredientGroup =
            ingredient.ingredient_group &&
            ingredient.ingredient_group !== previous?.ingredient_group;

          const productGroup =
            preferences.groupIngredientsByProductGroup &&
            ingredient.product_group &&
            ingredient.product_group !== previous?.product_group;

          return (
            <Fragment key={ingredient.id}>
              {ingredientGroup ? (
                <li className="recipe-ingredient-group">
                  <h3>{ingredient.ingredient_group}</h3>
                </li>
              ) : null}
              {productGroup ? (
                <li className="recipe-product-group">
                  <h4>{ingredient.product_group}</h4>
                </li>
              ) : null}
              <li className="recipe-ingredient" data-done={done.has(ingredient.id) || undefined}>
                {preferences.showIngredientCheckbox ? (
                  <input
                    type="checkbox"
                    checked={done.has(ingredient.id)}
                    aria-label={`${t("Mark this item as done")}: ${ingredient.product_name}`}
                    onChange={() =>
                      setDone((current) => {
                        const next = new Set(current);

                        if (next.has(ingredient.id)) next.delete(ingredient.id);
                        else next.add(ingredient.id);

                        return next;
                      })
                    }
                  />
                ) : null}
                <div className="recipe-ingredient-body">
                  {!ingredient.active ? <p className="muted">{t("Disabled")}</p> : null}
                  <Link
                    to="/products/$productId"
                    params={{ productId: String(ingredient.product_id) }}
                    data-due-score={ingredient.due_score}
                  >
                    {ingredient.variable_amount ??
                      `${amountText(ingredient.amount)} ${unitLabel(catalog.unit(ingredient.qu_id), ingredient.amount, pluralIndex, false)}`}{" "}
                    {ingredient.product_name}
                  </Link>
                  {features.enabled("STOCK") ? (
                    <p
                      className="muted recipe-stock-status"
                      data-fulfilled={
                        ingredient.fulfilled || ingredient.fulfilled_with_shopping_list
                      }
                    >
                      {ingredient.fulfilled
                        ? t("Enough in stock")
                        : t(
                            "Not enough in stock, %1$s missing, %2$s already on shopping list",
                            formatAmount(ingredient.missing_amount, 2),
                            formatAmount(ingredient.shopping_amount, 2),
                          )}
                      {ingredient.fulfilled
                        ? ` (${amountText(ingredient.stock_amount)} ${unitLabel(catalog.unit(catalog.product(ingredient.product_id)?.qu_id_stock), ingredient.stock_amount, pluralIndex, false)})`
                        : ""}
                    </p>
                  ) : null}
                  {features.enabled("STOCK") &&
                  ingredient.product_id_effective !== ingredient.product_id ? (
                    <p className="muted recipe-stock-status">
                      {catalog.productName(ingredient.product_id_effective)}
                    </p>
                  ) : null}
                  <p className="muted">
                    {features.enabled("STOCK_PRICE_TRACKING")
                      ? `${t("Costs")}: ${preferences.formatCurrency(ingredient.costs, String(features.query.data?.CURRENCY ?? "USD"))} · `
                      : ""}
                    {ingredient.calories.toLocaleString(undefined, { maximumFractionDigits: 0 })}{" "}
                    {t("Calories")}
                  </p>
                  {ingredient.variable_amount ? (
                    <p className="muted">{t("Variable amount")}</p>
                  ) : null}
                  {ingredient.note_html ? <RichText html={ingredient.note_html} /> : null}
                </div>
              </li>
            </Fragment>
          );
        })}
      </ul>
    </section>
  );
}
