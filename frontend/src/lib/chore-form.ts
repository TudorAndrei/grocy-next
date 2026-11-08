import { z } from "zod";
import { request } from "./api";
import { userfieldValuesSchema } from "./userfield-values";

export const chorePeriods = [
  "hourly",
  "daily",
  "manually",
  "monthly",
  "weekly",
  "yearly",
  "adaptive",
] as const;

export const choreAssignments = [
  "in-alphabetical-order",
  "no-assignment",
  "random",
  "who-least-did-first",
] as const;

export const choreWeekdays = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const choreSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  active: z.number(),
  period_type: z.enum(chorePeriods),
  period_days: z.number().nullable(),
  period_interval: z.number(),
  period_config: z.string().nullable(),
  assignment_type: z.enum(choreAssignments).nullable(),
  assignment_config: z.string().nullable(),
  track_date_only: z.number().nullable(),
  rollover: z.number().nullable(),
  consume_product_on_execution: z.number(),
  product_id: z.number().nullable(),
  product_amount: z.number().nullable(),
  userfields: userfieldValuesSchema.nullable(),
});

const contextSchema = z.object({
  chore: choreSchema.nullable(),
  has_history: z.boolean(),
  initial_start_date: z.string(),
  users: z.array(
    z.object({ id: z.number(), username: z.string(), display_name: z.string().nullable() }),
  ),
  products: z.array(
    z.object({
      id: z.number(),
      name: z.string().nullable(),
      stock_unit_name: z.string().nullable(),
    }),
  ),
});

export type ChoreFormContext = z.infer<typeof contextSchema>;

export async function getChoreProductBarcodes(signal?: AbortSignal) {
  const rows = z
    .array(z.object({ product_id: z.number(), barcode: z.string().nullable() }))
    .parse(await request("/api/objects/product_barcodes_view", { signal }));

  const byProduct = new Map<number, string[]>();

  for (const row of rows) {
    const codes = byProduct.get(row.product_id) ?? [];

    if (row.barcode !== null) codes.push(row.barcode);
    byProduct.set(row.product_id, codes);
  }

  return Array.from(byProduct, ([product_id, codes]) => ({
    product_id,
    barcodes: codes.join(","),
  }));
}

export async function getChoreForm(id: string, signal?: AbortSignal): Promise<ChoreFormContext> {
  return contextSchema.parse(
    await request(`/api/v2/chores/${encodeURIComponent(id)}/editor`, { signal }),
  );
}

export async function calculateChoreAssignments(
  id: number | string,
  signal?: AbortSignal,
): Promise<void> {
  await request("/api/chores/executions/calculate-next-assignments", {
    method: "POST",
    body: JSON.stringify({ chore_id: id }),
    signal,
  });
}
