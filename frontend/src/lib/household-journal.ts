import { z } from "zod";
import { request, requestNativeJson } from "./api";
import type { TrackingKind } from "./household-tracking";

const searchValue = z
  .union([z.string(), z.number(), z.boolean()])
  .transform(String)
  .optional()
  .catch(undefined);

export const householdJournalSearch = z
  .object({
    months: searchValue,
    chore: searchValue,
    battery: searchValue,
    embedded: searchValue,
  })
  .passthrough();

const journalRow = z.object({
  id: z.number(),
  record_id: z.number(),
  record_name: z.string().nullable(),
  track_date_only: z.number(),
  tracked_time: z.string().nullable(),
  scheduled_execution_time: z.string().nullable(),
  row_created_timestamp: z.string().nullable(),
  done_by_user_id: z.number().nullable(),
  undone: z.number(),
  undone_timestamp: z.string().nullable(),
  skipped: z.number(),
  custom_values: z.record(z.string(), z.string().nullable()),
});

export const householdJournalSchema = z.object({
  rows: z.array(journalRow),
  records: z.array(
    z.object({ id: z.number(), name: z.string().nullable(), track_date_only: z.number() }),
  ),
  users: z.array(
    z.object({ id: z.number(), username: z.string(), display_name: z.string().nullable() }),
  ),
  months: z.string(),
  selected_id: z.number().nullable(),
});

export type HouseholdJournalSearch = z.infer<typeof householdJournalSearch>;

export type HouseholdJournalRow = z.infer<typeof journalRow>;

export type HouseholdJournalContext = z.infer<typeof householdJournalSchema>;

export async function getHouseholdJournal(
  kind: TrackingKind,
  search: HouseholdJournalSearch,
): Promise<HouseholdJournalContext> {
  const query = new URLSearchParams();

  if (search.months !== undefined) query.set("months", search.months);

  if (search[kind] !== undefined) query.set(kind, search[kind]);

  return householdJournalSchema.parse(
    await request(`/api/v2/${kind === "chore" ? "chores" : "batteries"}/journal?${query}`),
  );
}

/** Sent Undo writes settle independently; their original page guards UI delivery. */
export async function undoNativeHouseholdJournal(kind: TrackingKind, id: number): Promise<void> {
  await requestNativeJson(
    `/api/${kind === "chore" ? "chores/executions" : "batteries/charge-cycles"}/${id}/undo`,
    { method: "POST", body: JSON.stringify({}) },
  );
}
