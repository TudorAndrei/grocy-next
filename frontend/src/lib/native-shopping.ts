import { z } from "zod";
import { request } from "./api";

const metadata = z.object({
  id: z.number(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  item_count: z.number(),
});

const context = z.object({
  list_id: z.union([z.string(), z.number(), z.record(z.string(), z.json())]),
  list: metadata.nullable(),
  lists: z.array(metadata),
  items: z.array(
    z.object({
      id: z.number(),
      product_id: z.number().nullable(),
      amount: z.number(),
      stock_amount: z.number().optional(),
      display_factor: z.number().optional(),
      note: z.string().nullable().optional(),
      done: z.boolean(),
      qu_id: z.number().nullable().optional(),
    }),
  ),
  products: z.array(
    z.object({
      id: z.number(),
      name: z.string().nullable(),
      qu_id_stock: z.number(),
      qu_id_purchase: z.number(),
    }),
  ),
  units: z.array(
    z.object({
      id: z.number(),
      name: z.string().nullable(),
      name_plural: z.string().nullable(),
      plural_forms: z.string().nullable(),
    }),
  ),
  notes_document: z.string(),
});

export type NativeShoppingContext = z.infer<typeof context>;

export async function getNativeShoppingContext(search: string, signal?: AbortSignal) {
  return context.parse(await request(`/api/v2/shopping-lists/native-context${search}`, { signal }));
}

export function nativeShoppingListText(data: NativeShoppingContext) {
  const scalar = z.union([z.string(), z.number()]).safeParse(data.list_id);

  return scalar.success ? String(scalar.data) : "Array";
}
