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
      min_stock_amount: z.number(),
      product_missing: z.number(),
      best_before_date: z.string(),
      due_type: z.number(),
      product_group_name: z.string().nullable(),
      product_default_location_name: z.string().nullable(),
      location_names: z.array(z.string().nullable()),
    }),
  ),
  locations: z.array(choice),
  product_groups: z.array(choice),
});

export async function getStockOverview(signal?: AbortSignal) {
  return schema.parse(await request("/api/v2/stock/overview", { signal }));
}
