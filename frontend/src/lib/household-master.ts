import { z } from "zod";
import { request } from "./api";
import { compareSqliteNames } from "./collation";
import { userfieldValuesSchema } from "./userfield-values";

export type HouseholdMasterEntity = "chores" | "batteries" | "task_categories";

const record = z.object({
  id: z.number().int().positive(),
  name: z.string().nullable(),
  active: z.number(),
  description: z.string().nullable().optional().default(null),
  period_type: z.string().nullable().optional().default(null),
  used_in: z.string().nullable().optional().default(null),
  charge_interval_days: z.number().nullable().optional().default(null),
  userfields: userfieldValuesSchema.nullish(),
});

export type HouseholdMasterRecord = z.infer<typeof record>;

export async function householdMasterRecords(entity: HouseholdMasterEntity) {
  return z
    .array(record)
    .parse(await request("/api/objects/" + entity))
    .sort((a, b) => compareSqliteNames(a.name ?? "", b.name ?? ""));
}

export function householdEditPath(entity: HouseholdMasterEntity, id: number | "new") {
  const prefix =
    entity === "chores" ? "chore" : entity === "batteries" ? "battery" : "taskcategory";

  return "/" + prefix + "/" + id;
}

export const householdMasterSearch = z
  .object({
    include_disabled: z.string().optional().catch(undefined),
  })
  .passthrough();
