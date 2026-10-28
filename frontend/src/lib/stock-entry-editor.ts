import { z } from "zod";
import { request } from "./api";
import type { JsonObject } from "./json";
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

export async function saveStockEntry(id: number, body: JsonObject) {
  return entryBookingsSchema.parse(
    await request(`/api/stock/entry/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  );
}
