import { z } from "zod";
import { request } from "./api";
import { stockEditorSchema } from "./stock-editor";

export { stockEditorUnits as transferUnits } from "./stock-editor";

export type { StockEditorCatalog as TransferCatalog } from "./stock-editor";

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
  return stockEditorSchema.parse(await request("/api/v2/stock/transfer/editor", { signal }));
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

  let stockLocation: number | undefined;

  const readLocations = request(`/api/stock/products/${productId}/locations`, { signal }).then(
    (result) => {
      // The native location callback replaces an earlier stock-code source value.
      stockLocation = undefined;

      return locationsSchema.parse(result);
    },
  );

  const readBarcode = (async () => {
    if (!code) return undefined;
    const params = new URLSearchParams([["query[]", `barcode=${code.barcode}`]]);

    return z
      .array(z.object({ amount: z.number().nullable(), qu_id: z.number().nullable() }))
      .parse(await request(`/api/objects/product_barcodes_view?${params}`, { signal }))[0];
  })();

  const readStockLocation = (async () => {
    if (code?.stockId === undefined) return;
    const params = new URLSearchParams([["query[]", `stock_id=${code.stockId}`]]);

    stockLocation = z
      .array(z.object({ location_id: z.number() }))
      .parse(await request(`/api/objects/stock?${params}`, { signal }))[0]?.location_id;
  })();

  const [locations, barcode] = await Promise.all([readLocations, readBarcode, readStockLocation]);

  return { details, locations, barcode, stockLocation };
}

export type TransferSelection = Awaited<ReturnType<typeof getTransferSelection>>;

export async function getTransferEntries(productId: string, signal: AbortSignal) {
  return entriesSchema.parse(await request(`/api/stock/products/${productId}/entries`, { signal }));
}
