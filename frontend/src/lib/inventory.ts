import { z } from "zod";
import { request } from "./api";
import { stockEditorSchema } from "./stock-editor";
import { userfieldSchema } from "./userfields";

export const inventorySearch = z.object({
  product: z.coerce.string().optional().catch(undefined),
  "product-name": z.coerce.string().optional().catch(undefined),
  embedded: z.coerce.string().optional().catch(undefined),
  flow: z.coerce.string().optional().catch(undefined),
  barcode: z.coerce.string().optional().catch(undefined),
});

export type InventoryOptions = z.infer<typeof inventorySearch>;

const catalog = stockEditorSchema.extend({
  stores: z.array(z.object({ id: z.number(), name: z.string() })),
  fields: z.array(userfieldSchema),
});

export type InventoryCatalog = z.infer<typeof catalog>;

const details = z.object({
  product: z.object({
    id: z.number(),
    name: z.string(),
    enable_tare_weight_handling: z.number().nullable(),
    tare_weight: z.number().nullable(),
    default_best_before_days: z.number().nullable(),
    default_stock_label_type: z.number().nullable(),
  }),
  stock_amount: z.number(),
  quantity_unit_stock: z.object({
    id: z.number(),
    name: z.string(),
    name_plural: z.string().nullable(),
  }),
  location: z.object({ id: z.number() }).nullable(),
  last_price: z.number().nullable(),
  last_shopping_location_id: z.number().nullable(),
});

const barcode = z.object({
  amount: z.number().nullable(),
  qu_id: z.number().nullable(),
  note: z.string().nullable(),
});

export type InventoryDetails = z.infer<typeof details>;

export async function getInventoryCatalog(signal: AbortSignal) {
  return catalog.parse(await request("/api/v2/stock/inventory/editor", { signal }));
}

export async function getInventoryDetails(product: string, signal?: AbortSignal) {
  return details.parse(
    await request(`/api/stock/products/${product}`, { signal, cache: "default" }),
  );
}

export async function getInventorySelection(product: string, signal: AbortSignal, code?: string) {
  const selected = await getInventoryDetails(product, signal);
  const query = new URLSearchParams([["query[]", `barcode=${code}`]]);

  const found =
    code === undefined
      ? undefined
      : z.array(barcode).parse(
          await request(`/api/objects/product_barcodes_view?${query}`, {
            signal,
            cache: "default",
          }),
        )[0];

  return { details: selected, barcode: found };
}
