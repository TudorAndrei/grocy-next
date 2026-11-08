import { z } from "zod";
import { request } from "./api";
import type { UserSettings } from "./types";

const choice = z.object({ id: z.number(), name: z.string().nullable() });

const context = z.object({
  locations: z.array(choice),
  quantity_units: z.array(choice),
  product_groups: z.array(choice),
});

export type StockSettingsContext = z.infer<typeof context>;

export async function getStockSettingsContext(signal?: AbortSignal) {
  return context.parse(await request("/api/v2/settings/stock-context", { signal }));
}

export const stockSettingDefaults: UserSettings = {
  product_presets_location_id: -1,
  product_presets_product_group_id: -1,
  product_presets_qu_id: -1,
  product_presets_default_due_days: 0,
  product_presets_treat_opened_as_out_of_stock: true,
  product_presets_default_stock_label_type: 0,
  stock_due_soon_days: 5,
  show_icon_on_stock_overview_page_when_product_is_on_shopping_list: true,
  stock_overview_show_all_out_of_stock_products: false,
  stock_default_purchase_amount: 0,
  show_purchased_date_on_purchase: false,
  show_warning_on_purchase_when_due_date_is_earlier_than_next: true,
  stock_default_consume_amount: 1,
  stock_default_consume_amount_use_quick_consume_amount: false,
  stock_decimal_places_amounts: 4,
  stock_decimal_places_prices_input: 2,
  stock_decimal_places_prices_display: 2,
  stock_auto_decimal_separator_prices: false,
};

// Match the pinned NumberPicker blur, including its decimalPlaces=0 slice(-0) behavior.
export function normalizeCurrencyInput(value: string, decimalPlaces: number, enabled: boolean) {
  if (!enabled || !value || value.includes(".") || value.includes(",")) return value;
  const padded = value.length <= decimalPlaces ? value.padStart(decimalPlaces, "0") : value;

  return String(
    Number.parseFloat(
      padded.substring(0, padded.length - decimalPlaces) + "." + padded.slice(decimalPlaces * -1),
    ),
  );
}
