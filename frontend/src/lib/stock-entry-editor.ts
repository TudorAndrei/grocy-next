import { z } from "zod";
import { request } from "./api";
import type { JsonObject } from "./json";
import type { QueryClient } from "@tanstack/react-query";
import { userfieldSchema } from "./userfields";

const choice = z.object({ id: z.number(), name: z.string().nullable() });
const values = z.record(z.string(), z.string().nullable());

export const entryEditorSchema = z.object({
  entry: z.object({
    id: z.number(),
    product_id: z.number(),
    stock_id: z.string(),
    amount: z.number(),
    best_before_date: z.string().nullable(),
    purchased_date: z.string().nullable(),
    price: z.number().nullable(),
    location_id: z.number(),
    shopping_location_id: z.number().nullable(),
    note: z.string().nullable(),
    open: z.number(),
    product_name: z.string().nullable(),
    qu_name: z.string().nullable(),
  }),
  locations: z.array(choice),
  stores: z.array(choice),
  fields: z.array(userfieldSchema),
  values,
});

export type EntryEditor = z.infer<typeof entryEditorSchema>;

export const entryBookingsSchema = z
  .array(
    z.object({
      id: z.number(),
      product_id: z.number(),
      transaction_id: z.string(),
      stock_id: z.string(),
    }),
  )
  .min(1);

export type EntryBookings = z.infer<typeof entryBookingsSchema>;

export async function getEntryEditor(id: number, signal?: AbortSignal) {
  return entryEditorSchema.parse(await request(`/api/v2/stock/entries/${id}/editor`, { signal }));
}

export async function getNativeEntryEditor(id: string, signal?: AbortSignal) {
  return entryEditorSchema.parse(
    await request(`/api/v2/stock/entries/native-editor?row=${encodeURIComponent(id)}`, { signal }),
  );
}

export async function getNativeEntryUnit(productId: number, signal?: AbortSignal) {
  return z
    .object({ quantity_unit_stock: z.object({ name: z.string().nullable() }) })
    .parse(await request(`/api/stock/products/${productId}`, { signal })).quantity_unit_stock.name;
}

export function invalidateNativeEntry(client: QueryClient) {
  for (const key of [
    "stock",
    "stock-entry-editor",
    "native-stock-entry-editor",
    "products",
    "product-overview",
    "native-products",
    "recipe-fulfillment",
    "recipe-view",
    "recipe-overview",
    "shopping",
    "mealplan-calendar",
    "calendar",
    "native-calendar",
  ])
    void client.invalidateQueries({ queryKey: [key], refetchType: "none" });
}

export async function saveStockEntry(id: number, body: JsonObject, signal?: AbortSignal) {
  return entryBookingsSchema.parse(
    await request(`/api/stock/entry/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
      signal,
    }),
  );
}
