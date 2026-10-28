import { useQuery } from "@tanstack/react-query";
import { userSettingsQuery } from "@/hooks/queries";
import { formatAmount } from "./format";
import type { UserSettings } from "./types";

export function preferenceEnabled(value: UserSettings[string] | undefined): boolean {
  const text = String(value ?? "").toLowerCase();

  return text === "true" || text === "1" || text === "on";
}

export function usePreferences() {
  const settings = useQuery(userSettingsQuery());

  const number = (key: string, fallback: number) => {
    const value = settings.data?.[key];
    const parsed = value == null ? fallback : Number(value);

    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const enabled = (key: string) => {
    const value = settings.data?.[key];

    return preferenceEnabled(value);
  };

  const amountPrecision = Math.max(
    0,
    Math.min(20, Math.trunc(number("stock_decimal_places_amounts", 4))),
  );

  const priceDisplayPrecision = Math.max(
    0,
    Math.min(20, Math.trunc(number("stock_decimal_places_prices_display", 2))),
  );

  return {
    amountPrecision,
    priceInputPrecision: Math.max(
      0,
      Math.min(20, Math.trunc(number("stock_decimal_places_prices_input", 2))),
    ),
    priceDisplayPrecision,
    showPurchaseDate: enabled("show_purchased_date_on_purchase"),
    dueSoonDays: Math.max(0, Math.trunc(number("stock_due_soon_days", 5))),
    purchaseAmount: number("stock_default_purchase_amount", 0),
    consumeAmount: number("stock_default_consume_amount", 1),
    useQuickConsumeAmount: enabled("stock_default_consume_amount_use_quick_consume_amount"),
    scanPurchase: enabled("scan_mode_purchase_enabled"),
    scanConsume: enabled("scan_mode_consume_enabled"),
    autoReload: enabled("auto_reload_on_db_change"),
    showClock: enabled("show_clock_in_header"),
    keepScreenOn: enabled("keep_screen_on"),
    keepScreenOnWhenFullscreen: enabled("keep_screen_on_when_fullscreen_card"),
    showIngredientCheckbox: enabled("recipes_show_ingredient_checkbox"),
    groupIngredientsByProductGroup: enabled("recipe_ingredients_group_by_product_group"),
    recipesSideBySide:
      settings.data?.recipes_show_list_side_by_side === undefined ||
      enabled("recipes_show_list_side_by_side"),
    formatAmount: (value: number | string | null | undefined) =>
      formatAmount(value, amountPrecision),
    formatPrice: (value: number) =>
      value.toLocaleString(undefined, {
        minimumFractionDigits: priceDisplayPrecision,
        maximumFractionDigits: priceDisplayPrecision,
      }),
    formatCurrency: (value: number, currency: string) =>
      value.toLocaleString(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: priceDisplayPrecision,
        maximumFractionDigits: priceDisplayPrecision,
      }),
  };
}
