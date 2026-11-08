import { z } from "zod";
import moment from "moment/min/moment-with-locales.js";
import type { QueryClient } from "@tanstack/react-query";
import { request, requestNativeJson } from "./api";
import type { Task } from "./types";
import type { JsonObject } from "./json";
import {
  nativeTableCell,
  tableDate,
  tableNumber,
  tableText,
  type NativeTableRow,
} from "./native-table-cell";
import type { UserfieldDefinition } from "./userfields";
import { userfieldTableCell } from "./userfield-table-cell";

export const tasksSearchSchema = z
  .object({ include_done: z.string().optional().catch(undefined) })
  .passthrough();

const identity = z.union([z.number(), z.string()]).nullable();

const taskRow = z.object({
  id: z.number(),
  name: z.string(),
  due_date: z.string().nullable(),
  done: z.number(),
  due_type: z.enum(["", "overdue", "duetoday", "duesoon"]),
  category_id: identity,
  has_category: z.boolean(),
  category_name: z.string().nullable(),
  assigned_to_user_id: identity,
  assigned_name: z.string().nullable(),
  custom_values: z.record(z.string(), z.string().nullable()),
});

const pageSchema = z.object({
  rows: z.array(taskRow),
  categories: z.array(z.object({ id: z.number(), name: z.string().nullable() })),
  next_days: z.union([z.number(), z.string()]).nullable(),
  include_done: z.boolean(),
});

export type TaskPageRow = z.infer<typeof taskRow>;

export async function getTasksPage(search: string, signal?: AbortSignal) {
  return pageSchema.parse(await request(`/api/v2/tasks/overview${search}`, { signal }));
}

/** A dispatched native Delete settles even after its originating page retires. */
export function deleteNativeTask(id: number) {
  return requestNativeJson(`/api/objects/tasks/${id}`, {
    method: "DELETE",
    body: JSON.stringify({}),
  });
}

export function markTaskDeleteStale(client: QueryClient) {
  for (const queryKey of [["tasks"], ["tasks-page"], ["objects", "tasks"], ["calendar"]])
    void client.invalidateQueries({ queryKey, refetchType: "none" });
}

/** The pinned GetUriParam distinguishes a bare flag from an explicit empty value. */
export function showDoneTasks(search: string) {
  for (const part of search.replace(/^\?/, "").split("&")) {
    const [key, value] = part.split("=");

    if (key === "include_done") return value === undefined || Boolean(decodeURIComponent(value));
  }

  return false;
}

export function taskStatistics(rows: Task[], at: number, days: number) {
  const now = moment(at);
  const yesterday = now.clone().subtract(1, "days").endOf("day");
  const today = now.clone().endOf("day");
  const next = today.clone().add(days, "days");
  let overdue = 0;
  let dueToday = 0;
  let dueSoon = 0;

  for (const row of rows) {
    if (!row.due_date) continue;
    const due = moment(`${row.due_date} 23:59:59`).endOf("day");

    if (due.isSameOrBefore(yesterday)) overdue++;
    else if (due.isSameOrBefore(today)) {
      dueToday++;
      dueSoon++;
    } else if (due.isSameOrBefore(next)) dueSoon++;
  }

  return { overdue, dueToday, dueSoon };
}

export function taskTableCells(
  row: TaskPageRow,
  fields: UserfieldDefinition[],
  context: {
    at: number;
    locale: string;
    pricePrecision: number;
    currency: string;
    config?: JsonObject;
    t: (message: string) => string;
  },
): NativeTableRow {
  const category = row.has_category ? (row.category_name ?? "") : context.t("Uncategorized");

  const cells: NativeTableRow = {
    name: nativeTableCell(tableText(row.name)),
    due: nativeTableCell(
      tableDate(row.due_date, new Date(context.at), context.locale, context.t).html,
      "html",
    ),
    category: nativeTableCell(`<span>${tableText(category)}</span>`),
    assigned: nativeTableCell(
      row.assigned_name ? `<span>${tableText(row.assigned_name)}</span>` : "",
    ),
    status: nativeTableCell(row.due_type + (row.due_type === "duetoday" ? " duesoon" : "")),
    category_group: nativeTableCell(tableText(category)),
  };

  for (const field of fields) {
    if (["file", "image", "link", "link-with-title"].includes(field.type)) {
      cells[`custom:${field.name}`] = userfieldTableCell(
        field,
        row.custom_values[field.name] ?? null,
        context.pricePrecision,
        context.currency,
        context.config,
        Object.hasOwn(row.custom_values, field.name),
      );
      continue;
    }

    const value = row.custom_values[field.name] ?? "";
    let html = tableText(value);

    if (field.type === "checkbox")
      html = Number(value) === 1 ? '<i class="fa-solid fa-check"></i>' : "";
    else if (field.type === "preset-checklist") html = value.split(",").map(tableText).join("<br>");
    else if (field.type === "number-decimal") html = tableText(tableNumber(value, 0));
    else if (field.type === "number-currency")
      html = tableText(tableNumber(value, context.pricePrecision, context.currency));

    cells[`custom:${field.name}`] = nativeTableCell(html);
  }

  return cells;
}

export async function invalidateTasksPage(client: QueryClient) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ["tasks"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["tasks-page"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["objects", "tasks"] }),
    client.invalidateQueries({ queryKey: ["calendar"] }),
  ]);
}
