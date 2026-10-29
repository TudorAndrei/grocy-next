import { z } from "zod";
import { request } from "./api";

export const transferSearch = z.object({
  product: z.coerce.string().optional().catch(undefined),
  "product-name": z.coerce.string().optional().catch(undefined),
  locationId: z.coerce.string().optional().catch(undefined),
  stockId: z.coerce.string().optional().catch(undefined),
  embedded: z.coerce.string().optional().catch(undefined),
  flow: z.coerce.string().optional().catch(undefined),
  barcode: z.coerce.string().optional().catch(undefined),
});

export type TransferOptions = z.infer<typeof transferSearch>;

const catalogSchema = z.object({
  barcode_lookup_plugin_name: z.string(),
  products: z.array(z.object({ id: z.number(), name: z.string() })),
  locations: z.array(z.object({ id: z.number(), name: z.string(), is_freezer: z.number() })),
  units: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      name_plural: z.string().nullable(),
      plural_forms: z.string().nullable().optional(),
    }),
  ),
  barcodes: z.array(z.object({ product_id: z.number(), barcodes: z.string().nullable() })),
  conversions: z.array(
    z.object({
      product_id: z.number().nullable(),
      from_qu_id: z.number().nullable(),
      to_qu_id: z.number().nullable(),
      factor: z.union([z.string(), z.number()]).nullable(),
      to_qu_name: z.string().nullable(),
      to_qu_name_plural: z.string().nullable(),
    }),
  ),
});

export type TransferCatalog = z.infer<typeof catalogSchema>;

const detailsSchema = z.object({
  product: z.object({
    id: z.number(),
    name: z.string(),
    enable_tare_weight_handling: z.number().nullable(),
    should_not_be_frozen: z.number().nullable(),
  }),
  stock_amount: z.number(),
  quantity_unit_stock: z.object({
    id: z.number(),
    name: z.string(),
    name_plural: z.string().nullable(),
  }),
  location: z.object({ id: z.number() }).nullable(),
});

const locationsSchema = z.array(
  z.object({
    location_id: z.number(),
    location_name: z.string(),
    location_is_freezer: z.number(),
  }),
);

const entriesSchema = z.array(
  z.object({
    stock_id: z.string(),
    amount: z.number(),
    location_id: z.number(),
    best_before_date: z.string().nullable(),
    purchased_date: z.string().nullable(),
    open: z.number(),
    note: z.string().nullable(),
  }),
);

export type TransferEntry = z.infer<typeof entriesSchema>[number];

export async function getTransferCatalog(signal: AbortSignal) {
  return catalogSchema.parse(await request("/api/v2/stock/transfer/editor", { signal }));
}

export async function getTransferDetails(productId: string, signal?: AbortSignal) {
  return detailsSchema.parse(await request(`/api/stock/products/${productId}`, { signal }));
}

export async function getTransferSelection(
  productId: string,
  signal: AbortSignal,
  code?: { barcode: string; stockId?: string },
) {
  const details = await getTransferDetails(productId, signal);

  const locations = locationsSchema.parse(
    await request(`/api/stock/products/${productId}/locations`, { signal }),
  );

  let barcode: { amount: number | null; qu_id: number | null } | undefined;
  let stockLocation: number | undefined;

  if (code) {
    const params = new URLSearchParams([["query[]", `barcode=${code.barcode}`]]);
    barcode = z
      .array(z.object({ amount: z.number().nullable(), qu_id: z.number().nullable() }))
      .parse(await request(`/api/objects/product_barcodes_view?${params}`, { signal }))[0];

    if (code.stockId !== undefined) {
      const params = new URLSearchParams([["query[]", `stock_id=${code.stockId}`]]);
      stockLocation = z
        .array(z.object({ location_id: z.number() }))
        .parse(await request(`/api/objects/stock?${params}`, { signal }))[0]?.location_id;
    }
  }

  return { details, locations, barcode, stockLocation };
}

export type TransferSelection = Awaited<ReturnType<typeof getTransferSelection>>;

export async function getTransferEntries(productId: string, signal: AbortSignal) {
  return entriesSchema.parse(await request(`/api/stock/products/${productId}/entries`, { signal }));
}

export function transferUnits(catalog: TransferCatalog, productId: string, stockUnit: number) {
  const choices = new Map<
    number | null,
    { id: number | null; name: string; name_plural: string | null; factor: number }
  >();

  for (const row of catalog.conversions) {
    if (String(row.product_id) !== productId || choices.has(row.to_qu_id)) continue;

    if (row.from_qu_id !== stockUnit && row.to_qu_id !== stockUnit) continue;
    choices.set(row.to_qu_id, {
      id: row.to_qu_id,
      name: String(row.to_qu_name),
      name_plural: row.to_qu_name_plural,
      factor: row.to_qu_id === stockUnit ? 1 : Number(String(row.factor)),
    });
  }

  return [...choices.values()];
}
