import { z } from "zod";
import { request } from "./api";

export const locationSheetSearch = z
  .object({
    include_out_of_stock: z.coerce.string().optional().catch(undefined),
    embedded: z.coerce.string().optional().catch(undefined),
  })
  .passthrough();

export type LocationSheetSearch = z.infer<typeof locationSheetSearch>;

const schema = z.object({
  locations: z.array(
    z.object({
      id: z.number(),
      name: z.string().nullable(),
      products: z.array(
        z.object({
          id: z.number(),
          name: z.string().nullable(),
          amount: z.number(),
          amount_opened: z.number(),
          amount_text: z.string(),
          amount_opened_text: z.string(),
          unit_label: z.string(),
          unit_name: z.string().nullable(),
          unit_name_plural: z.string().nullable(),
          unit_plural_forms: z.string().nullable(),
          unit_active: z.number().nullable(),
        }),
      ),
    }),
  ),
});

export async function getLocationSheet(search: LocationSheetSearch, signal?: AbortSignal) {
  const query = new URLSearchParams();

  if (search.include_out_of_stock !== undefined)
    query.set("include_out_of_stock", search.include_out_of_stock);

  return schema.parse(await request(`/api/v2/stock/location-content-sheet?${query}`, { signal }));
}
