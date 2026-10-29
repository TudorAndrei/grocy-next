import { z } from "zod";
import { request } from "./api";
import { stockEditorSchema } from "./stock-editor";
import { userfieldSchema } from "./userfields";

export const purchaseSearch = z.object({
  product: z.coerce.string().optional().catch(undefined),
  "product-name": z.coerce.string().optional().catch(undefined),
  embedded: z.coerce.string().optional().catch(undefined),
  flow: z.coerce.string().optional().catch(undefined),
  barcode: z.coerce.string().optional().catch(undefined),
  amount: z.coerce.string().optional().catch(undefined),
  quId: z.coerce.string().optional().catch(undefined),
  listitemid: z.coerce.string().optional().catch(undefined),
});

export type PurchaseOptions = z.infer<typeof purchaseSearch>;

const catalog = stockEditorSchema.extend({
  stores: z.array(z.object({ id: z.number(), name: z.string() })),
  fields: z.array(userfieldSchema),
});

export type PurchaseCatalog = z.infer<typeof catalog>;

const unit = z.object({ id: z.number(), name: z.string(), name_plural: z.string().nullable() });

const details = z.object({
  product: z.object({
    id: z.number(),
    name: z.string(),
    enable_tare_weight_handling: z.number().nullable(),
    tare_weight: z.number().nullable(),
    default_best_before_days: z.number().nullable(),
    default_best_before_days_after_freezing: z.number().nullable(),
    default_purchase_price_type: z.number().nullable(),
    default_stock_label_type: z.number().nullable(),
  }),
  stock_amount: z.number(),
  quantity_unit_stock: unit,
  default_quantity_unit_purchase: unit.nullable(),
  location: z.object({ id: z.number(), is_freezer: z.number() }).nullable(),
  last_price: z.number().nullable(),
  last_shopping_location_id: z.number().nullable(),
  default_shopping_location_id: z.number().nullable(),
  next_due_date: z.string().nullable(),
});

const barcode = z.object({
  id: z.number(),
  amount: z.number().nullable(),
  qu_id: z.number().nullable(),
  shopping_location_id: z.number().nullable(),
  last_price: z.number().nullable(),
  note: z.string().nullable(),
});

export type PurchaseDetails = z.infer<typeof details>;

export async function getPurchaseCatalog(signal: AbortSignal) {
  return catalog.parse(await request("/api/v2/stock/purchase/editor", { signal }));
}

export async function getPurchaseDetails(product: string, signal?: AbortSignal) {
  return details.parse(await request(`/api/stock/products/${product}`, { signal }));
}

export async function getPurchaseSelection(product: string, signal: AbortSignal, code?: string) {
  const selected = await getPurchaseDetails(product, signal);
  const params = new URLSearchParams([["query[]", `barcode=${code}`]]);

  const found =
    code === undefined
      ? undefined
      : z
          .array(barcode)
          .parse(await request(`/api/objects/product_barcodes_view?${params}`, { signal }))[0];

  return { details: selected, barcode: found };
}
