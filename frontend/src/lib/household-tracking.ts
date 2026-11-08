import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { request, requestNativeJson } from "./api";
import { compareSqliteNames } from "./collation";
import type { JsonObject, JsonValue } from "./json";

export type TrackingKind = "chore" | "battery";

const recordSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().nullable(),
  active: z.number(),
  description: z.string().nullable(),
  used_in: z.string().nullable().optional().default(null),
  period_type: z.string().nullable().optional().default(null),
  track_date_only: z.number().optional().default(0),
});

const userSchema = z.object({
  id: z.number().int().positive(),
  username: z.string(),
  display_name: z.string().nullable().optional(),
});

const choreDetailsSchema = z.object({
  chore: recordSchema,
  last_tracked: z.string().nullable(),
  tracked_count: z.number().int().nonnegative(),
  last_done_by: userSchema.nullable(),
  average_execution_frequency_hours: z.number().nullable(),
});

const batteryDetailsSchema = z.object({
  battery: recordSchema,
  last_charged: z.string().nullable(),
  charge_cycles_count: z.number().int().nonnegative(),
});

const trackedSchema = z.object({ id: z.number().int().positive() });

export type TrackingRecord = z.infer<typeof recordSchema>;

export type TrackingUser = z.infer<typeof userSchema>;

export type TrackingDetails = {
  record: TrackingRecord;
  lastTime: string | null;
  count: number;
  lastDoneBy: string | null;
  frequencyHours: number | null;
};

function entity(kind: TrackingKind) {
  return kind === "chore" ? "chores" : "batteries";
}

export async function getTrackingRecords(kind: TrackingKind): Promise<TrackingRecord[]> {
  const rows = z.array(recordSchema).parse(await request(`/api/objects/${entity(kind)}`));

  return rows
    .filter((row) => row.active === 1)
    .sort((first, second) => compareSqliteNames(first.name ?? "", second.name ?? ""));
}

export async function getTrackingUsers(): Promise<TrackingUser[]> {
  const users = z.array(userSchema).parse(await request("/api/v2/chores/tracking/users"));

  return users.sort((first, second) => {
    // The native page orders usernames using SQLite BINARY, without case folding.
    const a = [...first.username];
    const b = [...second.username];

    for (let index = 0; index < Math.min(a.length, b.length); index++) {
      const difference = a[index].codePointAt(0)! - b[index].codePointAt(0)!;

      if (difference) return difference;
    }

    return a.length - b.length;
  });
}

export async function getTrackingDetails(
  kind: TrackingKind,
  id: number | string,
  signal?: AbortSignal,
): Promise<TrackingDetails> {
  const response = await request<JsonValue>(`/api/${entity(kind)}/${id}`, { signal });

  return decodeTrackingDetails(kind, response);
}

/** Native Card decoding belongs to its successful browser callback. */
export function requestBatteryOverviewCard(id: number, signal?: AbortSignal) {
  return requestNativeJson<JsonValue>(`/api/batteries/${id}`, { signal });
}

export function decodeTrackingDetails(kind: TrackingKind, response: JsonValue): TrackingDetails {
  if (kind === "chore") {
    const data = choreDetailsSchema.parse(response);

    return {
      record: data.chore,
      lastTime: data.last_tracked,
      count: data.tracked_count,
      lastDoneBy: data.last_done_by?.display_name || null,
      frequencyHours: data.average_execution_frequency_hours,
    };
  }

  const data = batteryDetailsSchema.parse(response);

  return {
    record: data.battery,
    lastTime: data.last_charged,
    count: data.charge_cycles_count,
    lastDoneBy: null,
    frequencyHours: null,
  };
}

export async function recordTracking(
  kind: TrackingKind,
  id: number,
  body: JsonObject,
  signal?: AbortSignal,
) {
  return trackedSchema.parse(
    await request(`/api/${entity(kind)}/${id}/${kind === "chore" ? "execute" : "charge"}`, {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }),
  );
}

export async function undoTracking(
  kind: TrackingKind,
  id: number,
  signal?: AbortSignal,
): Promise<void> {
  await request(
    `/api/${kind === "chore" ? "chores/executions" : "batteries/charge-cycles"}/${id}/undo`,
    { method: "POST", body: JSON.stringify({}), signal },
  );
}

/** Sent native tracking writes can settle after their form has retired. */
export function invalidateNativeTracking(client: QueryClient, kind: TrackingKind): void {
  const name = entity(kind);

  for (const queryKey of [
    [name],
    ["tracking-records", kind],
    ["tracking-card", kind],
    [kind === "chore" ? "chores-overview" : "batteries-overview"],
    ["household-current", name],
    ["objects", kind === "chore" ? "chores_log" : "battery_charge_cycles"],
    ["household-journal", kind],
    ["calendar"],
    ["native-calendar"],
    ...(kind === "chore"
      ? ["stock", "recipe-fulfillment", "recipe-view", "recipe-overview", "shopping"].map((key) => [
          key,
        ])
      : []),
  ])
    void client.invalidateQueries({ queryKey, refetchType: "none" });
}

export async function invalidateTracking(client: QueryClient, kind: TrackingKind) {
  const name = entity(kind);

  await Promise.all([
    client.invalidateQueries({ queryKey: [name] }),
    client.invalidateQueries({ queryKey: ["household-current", name] }),
    client.invalidateQueries({
      queryKey: ["objects", kind === "chore" ? "chores_log" : "battery_charge_cycles"],
    }),
    client.invalidateQueries({ queryKey: ["calendar"] }),
    client.invalidateQueries({ queryKey: ["household-journal", kind] }),
    // Chores can consume stock, which also changes recipe and shopping availability.
    ...(kind === "chore"
      ? ["stock", "recipe-fulfillment", "recipe-view", "recipe-overview", "shopping"].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        )
      : []),
  ]);
}
