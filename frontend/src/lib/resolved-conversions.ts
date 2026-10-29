import { z } from "zod";
import { request } from "./api";

export const resolvedConversionSearch = z.object({
  product: z.union([z.number(), z.string()]).optional().catch(undefined),
  embedded: z.coerce.string().optional().catch(undefined),
});

export const resolvedConversionsSchema = z.object({
  product: z.object({ id: z.number(), name: z.string().nullable() }).nullable(),
  units: z.array(
    z.object({
      id: z.number(),
      name: z.string().nullable(),
      name_plural: z.string().nullable(),
      plural_forms: z.string().nullable(),
    }),
  ),
  rows: z.array(
    z.object({
      id: z.number(),
      from_qu_id: z.number().nullable(),
      to_qu_id: z.number().nullable(),
      factor: z.string().nullable(),
    }),
  ),
});

export async function getResolvedConversions(product: string | undefined, signal: AbortSignal) {
  const query = new URLSearchParams();

  if (product !== undefined) query.set("product", product);

  return resolvedConversionsSchema.parse(
    await request(`/api/v2/quantity-unit-conversions/resolved?${query}`, { signal }),
  );
}
