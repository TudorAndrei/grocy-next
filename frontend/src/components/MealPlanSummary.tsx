import type { MealPlanCalendar, MealPlanCallbacks } from "@/lib/mealplan-calendar";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { MealPlanRecipeActions } from "./MealPlanEventCard";

export function MealPlanWeekSummary({
  context,
  onReload,
  getSignal,
}: { context: MealPlanCalendar } & MealPlanCallbacks) {
  const { t } = useI18n();
  const features = useFeatures();
  const preferences = usePreferences();
  const recipe = context.week_recipe;
  const resolved = context.recipes_resolved.find((row) => row.recipe_id === recipe?.id);

  if (!recipe || !resolved) return null;

  return (
    <div className="mealplan-week-summary">
      {features.enabled("STOCK_PRICE_TRACKING") ? (
        <span>
          {t("Week costs")}:{" "}
          {preferences.formatCurrency(
            Number.parseFloat(String(resolved.costs)),
            String(features.query.data?.CURRENCY ?? "USD"),
          )}
        </span>
      ) : null}
      {features.enabled("STOCK") ? (
        <MealPlanRecipeActions
          context={context}
          recipe={recipe}
          onReload={onReload}
          getSignal={getSignal}
        />
      ) : null}
    </div>
  );
}

export function MealPlanDaySummary({ context, day }: { context: MealPlanCalendar; day: string }) {
  const { t } = useI18n();
  const features = useFeatures();
  const preferences = usePreferences();
  const recipe = context.internal_recipes.find((row) => row.name === day);
  const resolved = context.recipes_resolved.find((row) => row.recipe_id === recipe?.id);

  if (!recipe || !resolved) return null;

  const calories = Number.parseFloat(String(resolved.calories)).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  return (
    <span id={`day-summary-${day}`} className="mealplan-day-summary">
      {features.enabled("STOCK_PRICE_TRACKING") ? (
        <>
          {preferences.formatCurrency(
            Number.parseFloat(String(resolved.costs)),
            String(features.query.data?.CURRENCY ?? "USD"),
          )}{" "}
          /{" "}
        </>
      ) : null}
      {calories} {String(features.query.data?.ENERGY_UNIT ?? "kcal")} {t("per day")}
    </span>
  );
}
