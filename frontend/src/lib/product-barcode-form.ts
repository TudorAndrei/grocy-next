import { z } from "zod";
import { filePath, request } from "./api";
import type { FieldEdit } from "./userfields";

export const productBarcodeSearch = z
  .object({ product: z.coerce.string().optional(), embedded: z.coerce.string().optional() })
  .passthrough();

const product = z.object({
  id: z.number(),
  name: z.string().nullable(),
  qu_id_purchase: z.number(),
});

const barcode = z.object({
  id: z.number(),
  barcode: z.string(),
  amount: z.union([z.number(), z.string()]).nullable(),
  qu_id: z.number().nullable(),
  shopping_location_id: z.number().nullable(),
  note: z.string().nullable(),
});

const unit = z.object({
  id: z.number(),
  name: z.string(),
  name_plural: z.string().nullable().optional().default(null),
  plural_forms: z.string().nullable().optional().default(null),
  active: z.number(),
});

const conversion = z.object({
  from_qu_id: z.number().nullable(),
  to_qu_id: z.number().nullable(),
  factor: z.union([z.number(), z.string()]).nullable(),
});

export async function getProductBarcodeForm(
  recordId: number | null,
  productId: number,
  prices: boolean,
  signal?: AbortSignal,
) {
  const [selectedProduct, selectedBarcode, units, conversions, stores] = await Promise.all([
    request(`/api/objects/products/${productId}`, { signal }).then((value) => product.parse(value)),
    recordId === null
      ? null
      : request(`/api/objects/product_barcodes/${recordId}`, { signal }).then((value) =>
          barcode.parse(value),
        ),
    request("/api/objects/quantity_units", { signal }).then((value) => z.array(unit).parse(value)),
    request(`/api/v2/quantity-unit-conversions/resolved?product=${productId}`, { signal }).then(
      (value) =>
        z
          .object({ product: z.object({ id: z.number() }).nullable(), rows: z.array(conversion) })
          .parse(value),
    ),
    prices
      ? request("/api/objects/shopping_locations", { signal }).then((value) =>
          z.array(z.object({ id: z.number(), name: z.string(), active: z.number() })).parse(value),
        )
      : [],
  ]);

  const productConversions = conversions.product?.id === productId ? conversions.rows : [];
  const available: Array<z.infer<typeof unit> & { factor: number }> = [];

  for (const row of productConversions) {
    if (
      row.from_qu_id !== selectedProduct.qu_id_purchase &&
      row.to_qu_id !== selectedProduct.qu_id_purchase
    )
      continue;
    const quantityUnit = units.find((candidate) => candidate.id === row.to_qu_id);

    if (quantityUnit && !available.some((candidate) => candidate.id === quantityUnit.id))
      available.push({
        ...quantityUnit,
        factor:
          row.to_qu_id === selectedProduct.qu_id_purchase
            ? 1
            : row.factor === null
              ? Number.NaN
              : Number(row.factor),
      });
  }

  const storedUnit = selectedBarcode?.qu_id;

  // Reload selects the unmatched initial -1; only the single-conversion branch selects blank.
  const initialUnit = storedUnit
    ? available.some((row) => row.id === storedUnit)
      ? String(storedUnit)
      : null
    : productConversions.length === 1
      ? ""
      : null;

  return {
    product: selectedProduct,
    barcode: selectedBarcode,
    units: available,
    purchaseUnit: units.find((row) => row.id === selectedProduct.qu_id_purchase),
    initialUnit,
    stores: stores.filter((row) => row.active === 1),
  };
}

export type ProductBarcodeForm = Awaited<ReturnType<typeof getProductBarcodeForm>>;

/** Native plain PUT failures are silent; only the following file operations report errors. */
export async function saveBarcodeUserfield(
  recordId: number,
  name: string,
  edit: FieldEdit | undefined,
  onFileError: (error: Error) => void,
  signal?: AbortSignal,
) {
  if (!edit?.dirty || signal?.aborted) return;

  try {
    await request(`/api/userfields/product_barcodes/${recordId}`, {
      method: "PUT",
      body: JSON.stringify({
        [name]: edit.nativeValue === undefined ? edit.value : edit.nativeValue,
      }),
      signal,
    });
  } catch {
    return;
  }

  if (signal?.aborted) return;

  try {
    if (edit.remove) {
      await request(filePath("userfiles", edit.remove), { method: "DELETE", signal });
      signal?.throwIfAborted();
    }

    if (edit.upload) {
      await request(filePath("userfiles", edit.upload.name), {
        method: "PUT",
        body: edit.readFile ? edit.readFile() : edit.upload.file,
        signal,
      });
      signal?.throwIfAborted();
    }
  } catch (error) {
    if (!signal?.aborted) onFileError(error instanceof Error ? error : new Error(String(error)));
  }
}
