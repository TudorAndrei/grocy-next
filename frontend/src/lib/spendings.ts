import { z } from "zod";
import { request } from "./api";

export const spendingsSearch = z.object({
  start_date: z.coerce.string().optional().catch(undefined),
  end_date: z.coerce.string().optional().catch(undefined),
  "group-by": z.coerce.string().optional().catch(undefined),
  "product-group": z.coerce.string().optional().catch(undefined),
  embedded: z.coerce.string().optional().catch(undefined),
});

export type SpendingsSearch = z.infer<typeof spendingsSearch>;

const schema = z.object({
  group_by: z.enum(["product", "productgroup", "store"]),
  product_groups: z.array(z.object({ id: z.number(), name: z.string().nullable() })),
  rows: z.array(
    z.object({
      id: z.number().nullable(),
      name: z.string().nullable(),
      total: z.number(),
      group_id: z.number().nullable(),
      group_name: z.string().nullable(),
    }),
  ),
});

export type SpendingsView = z.infer<typeof schema>;

export async function getSpendings(search: SpendingsSearch, signal?: AbortSignal) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined && key !== "embedded")
      query.set(
        key === "group-by" ? "group_by" : key === "product-group" ? "product_group" : key,
        value,
      );
  }

  return schema.parse(await request(`/api/v2/stock/reports/spendings?${query}`, { signal }));
}
