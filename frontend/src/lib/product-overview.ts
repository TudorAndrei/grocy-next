import { z } from "zod";
import { request } from "./api";

const unit = z.object({
  name: z.string().nullable(),
  name_plural: z.string().nullable(),
  plural_forms: z.string().nullable(),
  active: z.number(),
});

const overviewSchema = z.object({
  product: z.object({
    id: z.number(),
    name: z.string().nullable(),
    description: z.string().nullable(),
    picture_file_name: z.string().nullable(),
    no_own_stock: z.number(),
  }),
  quantity_unit_stock: unit,
  quantity_unit_price: z.object({ name: z.string().nullable() }),
  stock_amount: z.number(),
  stock_amount_opened: z.number(),
  stock_amount_aggregated: z.number(),
  stock_amount_opened_aggregated: z.number(),
  is_aggregated_amount: z.number(),
  stock_value: z.number(),
  location: z.object({ name: z.string().nullable() }).nullable(),
  last_purchased: z.string().nullable(),
  last_used: z.string().nullable(),
  last_price: z.number().nullable(),
  avg_price: z.number().nullable(),
  qu_conversion_factor_price_to_stock: z.number(),
  average_shelf_life_days: z.number(),
  spoil_rate_percent: z.number(),
});

export async function getProductOverview(productId: number, signal: AbortSignal) {
  return overviewSchema.parse(await request(`/api/stock/products/${productId}`, { signal }));
}

const historySchema = z.array(
  z.object({
    date: z.string().nullable(),
    price: z.number(),
    shopping_location: z.object({ name: z.string().nullable() }).nullable(),
  }),
);

export type PriceHistory = z.infer<typeof historySchema>;

export async function getPriceHistory(productId: number, signal: AbortSignal) {
  return historySchema.parse(
    await request(`/api/stock/products/${productId}/price-history`, { signal }),
  );
}
