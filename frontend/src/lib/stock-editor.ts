import { z } from "zod";

export const stockEditorSchema = z.object({
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

export type StockEditorCatalog = z.infer<typeof stockEditorSchema>;

export function stockEditorUnits(
  catalog: StockEditorCatalog,
  productId: string,
  stockUnit: number,
) {
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
