import { z } from "zod";
import { userfieldSchema } from "./userfields";
import { request } from "./api";

export const shoppingSearchSchema = z.object({
  list: z.coerce.number().int().optional().catch(undefined),
});

export const shoppingItemSearchSchema = shoppingSearchSchema.extend({
  product: z.coerce.number().int().optional().catch(undefined),
  "product-name": z.coerce.string().optional().catch(undefined),
  amount: z.coerce.string().optional().catch(undefined),
  updateexistingproduct: z
    .unknown()
    .optional()
    .transform((value) => (value === undefined ? undefined : true)),
  flow: z.coerce.string().optional().catch(undefined),
  barcode: z.coerce.string().optional().catch(undefined),
});

export type ShoppingItemOptions = {
  product?: number;
  productName?: string;
  amount?: string;
  list?: number;
  merge?: boolean;
  flow?: string;
  barcode?: string;
};

const mergedItemSchema = z.array(z.object({ id: z.coerce.number().int() }));

export async function mergedShoppingItem(productId: string, listId: number): Promise<number> {
  const query = new URLSearchParams([
    ["query[]", `product_id=${productId}`],
    ["query[]", `shopping_list_id=${listId}`],
  ]);

  const rows = mergedItemSchema.parse(await request(`/api/objects/shopping_list?${query}`));

  if (!rows[0]) throw new Error("Could not load the saved shopping list item. Retry to continue.");

  return rows[0].id;
}

export type ShoppingSearch = z.infer<typeof shoppingSearchSchema>;

export const shoppingEditorSchema = z.object({
  list: z.object({ id: z.number(), name: z.string() }).nullable(),
  fields: z.array(userfieldSchema),
  values: z.record(z.string(), z.string().nullable()),
});

export type ShoppingListSummary = {
  id: number;
  name: string;
  description: string | null;
  item_count: number;
};

export async function shoppingEditor(id?: number) {
  return shoppingEditorSchema.parse(
    await request(`/api/v2/shopping-lists/editor${id === undefined ? "" : `?list_id=${id}`}`),
  );
}

export const shoppingListsQuery = {
  queryKey: ["shopping-lists"] as const,
  queryFn: () => request<ShoppingListSummary[]>("/api/v2/shopping-lists"),
};

export const shoppingItemEditorSchema = z.object({
  barcode_lookup_plugin_name: z.string().optional().default(""),
  item: z
    .object({
      id: z.number(),
      shopping_list_id: z.number(),
      product_id: z.number().nullable(),
      amount: z.number(),
      qu_id: z.number().nullable(),
      note: z.string().nullable(),
    })
    .nullable(),
  lists: z.array(z.object({ id: z.number(), name: z.string() })),
  products: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      qu_id_stock: z.number(),
      qu_id_purchase: z.number(),
    }),
  ),
  units: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      name_plural: z.string().nullable(),
      plural_forms: z.string().nullable().optional(),
    }),
  ),
  conversions: z.array(
    z.object({
      product_id: z.number(),
      from_qu_id: z.number(),
      to_qu_id: z.number(),
      factor: z.coerce.number(),
      to_qu_name: z.string(),
      to_qu_name_plural: z.string().nullable(),
    }),
  ),
  barcodes: z
    .array(z.object({ product_id: z.number(), barcodes: z.string().nullable() }))
    .optional()
    .default([]),
  fields: z.array(userfieldSchema),
  values: z.record(z.string(), z.string().nullable()),
});

export type ShoppingItemEditor = z.infer<typeof shoppingItemEditorSchema>;

export async function shoppingItemEditor(itemId?: number) {
  return shoppingItemEditorSchema.parse(
    await request(
      `/api/v2/shopping-lists/items/editor${itemId === undefined ? "" : `?item_id=${itemId}`}`,
    ),
  );
}
