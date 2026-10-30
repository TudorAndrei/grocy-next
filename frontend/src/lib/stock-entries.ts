import { z } from "zod";

const choice = z.object({ id: z.number(), name: z.string().nullable() });
const values = z.record(z.string(), z.string().nullable());

export const stockEntriesSchema = z.object({
  products: z.array(choice),
  locations: z.array(choice),
  stores: z.array(choice),
  rows: z.array(
    z.object({
      id: z.number(),
      product_id: z.number(),
      stock_id: z.string(),
      amount: z.number(),
      best_before_date: z.string().nullable(),
      purchased_date: z.string().nullable(),
      row_created_timestamp: z.string().nullable(),
      price: z.number().nullable(),
      open: z.number(),
      location_id: z.number(),
      shopping_location_id: z.number().nullable(),
      note: z.string().nullable(),
      qu_factor_price_to_stock: z.number(),
      qu_factor_purchase_to_stock: z.number(),
      product_name: z.string().nullable(),
      qu_name: z.string().nullable(),
      qu_name_plural: z.string().nullable(),
      price_qu_name: z.string().nullable(),
      purchase_qu_name: z.string().nullable(),
      location_name: z.string().nullable(),
      shopping_location_name: z.string().nullable(),
      enable_tare_weight_handling: z.number().nullable(),
      disable_open: z.number().nullable(),
      due_type: z.number().nullable(),
      product_values: values,
      stock_values: values,
    }),
  ),
});

export const stockEntriesSearch = z.object({
  product: z.coerce.string().optional().catch(undefined),
  embedded: z.coerce.string().optional().catch(undefined),
});

export type EntriesSearch = z.infer<typeof stockEntriesSearch>;

export type EntriesView = z.infer<typeof stockEntriesSchema>;

export type EntryRow = EntriesView["rows"][number];
