import { z } from "zod";
import { request, requestNativeJson } from "./api";
import moment from "moment/min/moment-with-locales.js";
import type { JsonValue } from "./json";

const user = z.object({
  id: z.number(),
  username: z.string(),
  display_name: z.string().nullable(),
});

const identity = z.union([z.number(), z.string()]).nullable();

export const choresOverviewSearch = z
  .object({ user: z.string().optional(), embedded: z.string().optional() })
  .passthrough();

export type ChoresOverviewSearch = z.infer<typeof choresOverviewSearch>;

const row = z.object({
  chore_id: z.number(),
  name: z.string().nullable(),
  period_type: z.string().nullable(),
  track_date_only: z.number().nullable(),
  last_tracked_time: z.string().nullable(),
  next_estimated_execution_time: z.string().nullable(),
  next_execution_assigned_to_user_id: identity,
  is_rescheduled: z.number(),
  is_reassigned: z.number(),
  due_type: z.enum(["", "overdue", "duetoday", "duesoon"]),
  custom_values: z.record(z.string(), z.string().nullable()),
});

const context = z.object({
  rows: z.array(row),
  users: z.array(user),
  next_x_days: z.number(),
  current_user_id: z.number(),
});

const details = z.object({
  chore: z.object({
    id: z.number(),
    name: z.string().nullable(),
    description: z.string().nullable(),
    period_type: z.string(),
    track_date_only: z.number().nullable(),
    next_execution_assigned_to_user_id: identity,
    rescheduled_date: z.string().nullable(),
  }),
  next_estimated_execution_time: z.string().nullable(),
  next_execution_assigned_user: user.nullable(),
  last_tracked: z.string().nullable(),
  tracked_count: z.number(),
  last_done_by: user.nullable(),
  average_execution_frequency_hours: z.number().nullable(),
});

export type ChoreOverviewRow = z.infer<typeof row>;

export type ChoresOverviewContext = z.infer<typeof context>;

export type ChoreOverviewDetails = z.infer<typeof details>;

export async function getChoresOverview(signal?: AbortSignal): Promise<ChoresOverviewContext> {
  return context.parse(await request("/api/v2/chores/overview", { signal }));
}

export function requestChoreOverviewDetails(id: number, signal?: AbortSignal) {
  return request<JsonValue>(`/api/chores/${id}`, { signal });
}

export function decodeChoreOverviewDetails(response: JsonValue): ChoreOverviewDetails {
  return details.parse(response);
}

export function requestChoreOverviewCard(id: number, signal?: AbortSignal) {
  return request<JsonValue>(`/api/v2/chores/${id}/card`, { signal });
}

export function decodeChoreOverviewCard(response: JsonValue) {
  return details.extend({ description_html: z.string() }).parse(response);
}

export async function getChoreStatistics(signal?: AbortSignal) {
  return z
    .array(
      z.object({
        next_estimated_execution_time: z.string().nullable(),
        next_execution_assigned_to_user_id: identity,
      }),
    )
    .parse(await request("/api/chores", { signal }));
}

export async function trackChoreOverview(
  id: number,
  tracked: string,
  skipped: boolean,
  signal?: AbortSignal,
) {
  await request(`/api/chores/${id}/execute`, {
    method: "POST",
    body: JSON.stringify({ tracked_time: tracked, skipped }),
    signal,
  });
}

export async function rescheduleChoreOverview(
  id: number,
  date: string | null,
  user: string | null,
  signal?: AbortSignal,
) {
  await requestNativeJson(`/api/objects/chores/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      rescheduled_date: date,
      rescheduled_next_execution_assigned_to_user_id: user,
    }),
    signal,
  });
}

export async function calculateChoreOverviewAssignments(id: string, signal?: AbortSignal) {
  await requestNativeJson("/api/chores/executions/calculate-next-assignments", {
    method: "POST",
    body: JSON.stringify({ chore_id: id }),
    signal,
  });
}

export function refreshedChoreDue(
  next: string | null,
  now: Date,
  days: number,
  locale = "en",
): ChoreOverviewRow["due_type"] {
  const date = moment(next, undefined, locale);

  if (date.isBefore(now)) return "overdue";

  if (date.isSameOrBefore(moment(now).locale(locale).endOf("day"))) return "duetoday";

  return date.isBefore(moment(now).locale(locale).add(days, "days")) ? "duesoon" : "";
}
