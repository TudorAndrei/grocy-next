import moment from "moment/min/moment-with-locales.js";
import { z } from "zod";
import { ApiError, request } from "./api";

const row = z.object({
  id: z.number(),
  name: z.string(),
  used_in: z.string().nullable(),
  charge_interval_days: z.number(),
  last_tracked_time: z.string().nullable(),
  next_estimated_charge_time: z.string().nullable(),
  due_type: z.enum(["", "overdue", "duetoday", "duesoon"]),
  custom_values: z.record(z.string(), z.string().nullable()),
});

const context = z.object({ rows: z.array(row), next_x_days: z.number() });
const statistics = z.array(z.object({ next_estimated_charge_time: z.string().nullable() }));

const detail = z.object({
  battery: z.object({ charge_interval_days: z.number() }),
  next_estimated_charge_time: z.string().nullable(),
});

export type BatteryOverviewRow = z.infer<typeof row>;

export type BatteryOverview = z.infer<typeof context>;

export type BatteryTone = { info: boolean; warning: boolean; danger: boolean };

export type BatteryRefresh = {
  id: number;
  trackedTime: string;
  next: string | null;
  interval: number;
  at: number;
};

export class BatteryChargeRequestError extends Error {
  constructor(cause: Error) {
    super("Battery charge request failed", { cause });
  }
}

function chargeRequestFailure(error: Error): never {
  if (error instanceof ApiError && (error.status === 200 || error.status === 204)) throw error;

  throw new BatteryChargeRequestError(error);
}

export async function getBatteriesOverview(signal?: AbortSignal) {
  return context.parse(await request("/api/v2/batteries/overview", { signal }));
}

export async function getBatteryStatistics(days: number, signal?: AbortSignal) {
  const rows = statistics.parse(await request("/api/batteries", { signal }));
  signal?.throwIfAborted();
  const now = moment();
  const today = now.clone().endOf("day");
  const soon = now.clone().add(days, "days");
  let overdue = 0;
  let dueToday = 0;
  let dueSoon = 0;

  for (const row of rows) {
    const date = moment(row.next_estimated_charge_time);

    if (date.isBefore(now)) overdue++;
    else if (date.isSameOrBefore(today)) {
      dueToday++;
      dueSoon++;
    } else if (date.isSameOrBefore(soon)) dueSoon++;
  }

  return { overdue, dueToday, dueSoon };
}

export async function chargeBattery(id: number, signal: AbortSignal): Promise<BatteryRefresh> {
  const trackedTime = moment().format("YYYY-MM-DD HH:mm:ss");
  await request("/api/batteries/" + id + "/charge", {
    method: "POST",
    body: JSON.stringify({ tracked_time: trackedTime }),
    signal,
  }).catch(chargeRequestFailure);
  signal.throwIfAborted();
  const response = await request("/api/batteries/" + id, { signal }).catch(chargeRequestFailure);
  signal.throwIfAborted();
  const value = detail.parse(response);

  return {
    id,
    trackedTime,
    next: value.next_estimated_charge_time,
    interval: value.battery.charge_interval_days,
    at: Date.now(),
  };
}

export function initialBatteryTone(row: BatteryOverviewRow): BatteryTone {
  return {
    info: row.due_type === "duetoday",
    warning: row.due_type === "duesoon",
    danger: row.due_type === "overdue",
  };
}

export function refreshedBatteryTone(
  previous: BatteryTone,
  value: BatteryRefresh,
  days: number,
): BatteryTone {
  const now = moment(value.at);
  const next = moment(value.next);

  // The native handler removes danger/warning, but retains an existing info class.
  return {
    info: previous.info,
    danger: next.isBefore(now),
    warning: !next.isBefore(now) && next.isBefore(now.clone().add(days, "days")),
  };
}
