import { z } from "zod";
import { request } from "./api";

const choice = z.object({ id: z.number(), name: z.string().nullable() });

const schema = z.object({
  rows: z.array(
    z.object({
      product_id: z.number(),
      product_name: z.string().nullable(),
      amount: z.number(),
      amount_opened: z.number(),
      amount_aggregated: z.number(),
      amount_opened_aggregated: z.number(),
      is_aggregated_amount: z.number(),
      min_stock_amount: z.union([z.number(), z.string()]),
      product_missing: z.number(),
      best_before_date: z.string(),
      due_type: z.number(),
      product_group_name: z.string().nullable(),
      product_default_location_name: z.string().nullable(),
      location_names: z.array(z.string().nullable()),
      value: z.number(),
      on_shopping_list: z.number(),
      product_no_own_stock: z.number(),
      product_calories: z.union([z.number(), z.string()]).nullable(),
      calories: z.number().nullable(),
      last_purchased: z.string().nullable(),
      last_price: z.number().nullable(),
      average_price: z.number().nullable(),
      qu_stock_name: z.string().nullable(),
      qu_stock_name_plural: z.string().nullable(),
      qu_consume_name: z.string().nullable(),
      quick_consume_amount: z.number(),
      quick_consume_amount_qu_consume: z.number().nullable(),
      quick_open_amount: z.number(),
      quick_open_amount_qu_consume: z.number().nullable(),
      enable_tare_weight_handling: z.number(),
      tare_weight: z.number(),
      disable_open: z.number(),
      qu_price_name: z.string().nullable(),
      product_qu_factor_price_to_stock: z.coerce.number(),
      product_barcodes: z.string().nullable(),
      product_description: z.string(),
      parent_product_id: z.number().nullable(),
      parent_product_name: z.string().nullable(),
      product_picture_file_name: z.string().nullable(),
      default_store_name: z.string().nullable(),
      unit_label: z.string(),
      unit_label_aggregated: z.string(),
      number_text: z.record(z.string(), z.string()),
      product_values: z.record(z.string(), z.string().nullable()),
    }),
  ),
  locations: z.array(choice),
  product_groups: z.array(choice),
  show_shopping_icon: z.boolean(),
});

export type StockOverviewRow = z.infer<typeof schema>["rows"][number];

export async function getStockOverview(signal?: AbortSignal) {
  return schema.parse(await request("/api/v2/stock/overview", { signal }));
}

const openDetails = z.object({
  product: z.object({ move_on_open: z.union([z.number(), z.string()]).nullable() }),
  default_consume_location: z.object({ name: z.string().nullable() }).nullable(),
});

export async function getQuickOpenDetails(productId: number) {
  return openDetails.parse(await request(`/api/stock/products/${productId}`));
}

const refresh = z.object({
  product: z.object({
    id: z.number(),
    parent_product_id: z.number().nullable(),
    min_stock_amount: z.union([z.number(), z.string()]),
    due_type: z.number(),
    disable_open: z.number(),
  }),
  stock_amount: z.number(),
  stock_amount_aggregated: z.number(),
  stock_amount_opened: z.number(),
  stock_amount_opened_aggregated: z.number(),
  stock_value: z.number(),
  next_due_date: z.string().nullable(),
  is_aggregated_amount: z.union([z.number(), z.boolean()]),
  quantity_unit_stock: z.object({
    name: z.string(),
    name_plural: z.string().nullable(),
    plural_forms: z.string().nullable(),
    active: z.number(),
  }),
});

export type OverviewProductRefresh = z.infer<typeof refresh> & { at: number };

export async function getOverviewProductRefresh(
  productId: number,
  signal?: AbortSignal,
): Promise<OverviewProductRefresh> {
  return {
    ...refresh.parse(await request(`/api/stock/products/${productId}`, { signal })),
    at: Date.now(),
  };
}
