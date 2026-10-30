import { z } from "zod";
import { request } from "./api";
import { stockEditorSchema } from "./stock-editor";

export const consumeSearch = z.object({
  product: z.coerce.string().optional().catch(undefined),
  "product-name": z.coerce.string().optional().catch(undefined),
  embedded: z.coerce.string().optional().catch(undefined),
  locationId: z.coerce.string().optional().catch(undefined),
  stockId: z.coerce.string().optional().catch(undefined),
  flow: z.coerce.string().optional().catch(undefined),
  barcode: z.coerce.string().optional().catch(undefined),
});

export type ConsumeOptions = z.infer<typeof consumeSearch>;

const catalog = stockEditorSchema.extend({
  recipes: z.array(z.object({ id: z.number(), name: z.string() })),
});

export type ConsumeCatalog = z.infer<typeof catalog>;

const unit = z.object({ id: z.number(), name: z.string(), name_plural: z.string().nullable() });

const details = z.object({
  product: z.object({
    id: z.number(),
    name: z.string(),
    enable_tare_weight_handling: z.number().nullable(),
    tare_weight: z.number().nullable(),
    default_consume_location_id: z.number().nullable(),
    quick_consume_amount: z.number().nullable(),
    disable_open: z.number().nullable(),
    move_on_open: z.number().nullable(),
  }),
  stock_amount: z.number(),
  stock_amount_opened: z.number(),
  has_childs: z.boolean(),
  quantity_unit_stock: unit,
  default_quantity_unit_consume: unit.nullable(),
  location: z.object({ id: z.number() }).nullable(),
  default_consume_location: z.object({ name: z.string() }).nullable(),
});

const locations = z.array(
  z.object({ location_id: z.number(), location_name: z.string(), amount: z.number() }),
);

const entries = z.array(
  z.object({
    id: z.number(),
    stock_id: z.string(),
    amount: z.number(),
    amount_aggregated: z.number().optional(),
    location_id: z.number(),
    best_before_date: z.string().nullable(),
    purchased_date: z.string().nullable(),
    open: z.number(),
    note: z.string().nullable(),
  }),
);

export type ConsumeDetails = z.infer<typeof details>;

export type ConsumeEntry = z.infer<typeof entries>[number];

export async function getConsumeCatalog(signal: AbortSignal) {
  return catalog.parse(await request("/api/v2/stock/consume/editor", { signal }));
}

export async function getConsumeDetails(product: string, signal?: AbortSignal) {
  return details.parse(
    await request(`/api/stock/products/${product}`, { signal, cache: "default" }),
  );
}

export async function getConsumeEntries(product: string, signal: AbortSignal) {
  return entries.parse(
    await request(`/api/stock/products/${product}/entries?include_sub_products=true`, {
      signal,
      cache: "default",
    }),
  );
}

export async function getConsumeStockEntry(product: string, stockId: string, signal: AbortSignal) {
  const filter = new URLSearchParams([["query[]", `stock_id=${stockId}`]]);

  return entries.parse(
    await request(`/api/stock/products/${product}/entries?${filter}`, { signal, cache: "default" }),
  )[0];
}

export async function getConsumeBarcode(barcode: string, signal: AbortSignal) {
  const params = new URLSearchParams([["query[]", `barcode=${barcode}`]]);

  return z
    .array(z.object({ amount: z.number().nullable(), qu_id: z.number().nullable() }))
    .parse(
      await request(`/api/objects/product_barcodes?${params}`, { signal, cache: "default" }),
    )[0];
}

export async function getConsumeSelection(product: string, signal: AbortSignal) {
  const selected = await getConsumeDetails(product, signal);

  const found = locations.parse(
    await request(`/api/stock/products/${product}/locations?include_sub_products=true`, {
      signal,
      cache: "default",
    }),
  );

  return { details: selected, locations: found };
}

export type ConsumeSelection = Awaited<ReturnType<typeof getConsumeSelection>>;
