import { z } from "zod";
import type { QueryClient } from "@tanstack/react-query";
import { request } from "./api";
import { saveNativeObjectFields } from "./native-object-fields";
import type { FieldEdits, UserfieldDefinition } from "./userfields";
import type { JsonObject } from "./json";

export type NativeHouseholdEntity =
  | "tasks"
  | "batteries"
  | "chores"
  | "task_categories"
  | "locations"
  | "product_groups"
  | "shopping_locations"
  | "quantity_units"
  | "quantity_unit_conversions";

/** A dispatched object/field write may commit after its document retires. */
export function invalidateNativeHouseholdObject(
  client: QueryClient,
  entity: NativeHouseholdEntity,
) {
  const related =
    entity === "tasks" || entity === "task_categories"
      ? [["tasks"], ["tasks-page"], ["task-form-context"]]
      : entity === "batteries"
        ? [["batteries-overview"], ["household-journal", "battery"]]
        : entity === "chores"
          ? [
              ["chores-overview"],
              ["chore-editor"],
              ["chore-reschedule"],
              ["tracking-card", "chore"],
              ["household-journal", "chore"],
              ["objects", "chores_log"],
            ]
          : entity === "quantity_units" || entity === "quantity_unit_conversions"
            ? [
                ["quantity-units"],
                ["resolved-conversions"],
                ["quantity-unit-editor"],
                ["quantity-unit-conversion-editor"],
                ["quantity-unit-fields", entity],
                ["objects", "quantity_units"],
                ["objects", "quantity_unit_conversions"],
                ["objects", "quantity_unit_conversions_resolved"],
                ["stock"],
                ["products"],
                ["catalog"],
                ["product-options"],
                ["native-product-options"],
                ["product-form-options"],
                ["native-products"],
              ]
            : [
                ["stock-reference", entity],
                ["stock"],
                ["products"],
                ["product-options"],
                ["native-product-options"],
                ["product-form-options"],
                ["native-products"],
                ...(entity === "product_groups" ? [["stock-reference", "group-products"]] : []),
              ];

  for (const queryKey of [
    [entity],
    ["objects", entity],
    ["entity-manager", entity],
    ["household-object-editor", entity],
    ["household-object-userfields", entity],
    ["calendar"],
    ["native-calendar"],
    ["household-current"],
    ["household-master"],
    ["tracking-records"],
    ...related,
  ])
    void client.invalidateQueries({ queryKey, refetchType: "none" });
}

/** Native completion belongs to the last dirty field, rather than all fields. */
export async function saveNativeHouseholdObject({
  client,
  entity,
  recordId,
  body,
  fields,
  readEdits,
  primaryError,
  fileError,
  signal,
}: {
  client: QueryClient;
  entity: NativeHouseholdEntity;
  recordId: number | null;
  body: JsonObject;
  fields: UserfieldDefinition[];
  readEdits: () => FieldEdits;
  primaryError: (error: Error) => void;
  fileError: (error: Error) => void;
  signal: AbortSignal;
}): Promise<{ id: number; wireId: string | number } | undefined> {
  signal.throwIfAborted();
  let id: number;
  let wireId: string | number;

  try {
    const result = await request(
      recordId === null ? `/api/objects/${entity}` : `/api/objects/${entity}/${recordId}`,
      { method: recordId === null ? "POST" : "PUT", body: JSON.stringify(body), signal },
    );

    signal.throwIfAborted();
    wireId =
      recordId ??
      z.object({ created_object_id: z.union([z.string(), z.number()]) }).parse(result)
        .created_object_id;
    id = z.coerce.number().int().parse(wireId);
  } catch (error) {
    if (!signal.aborted && error instanceof Error) primaryError(error);

    return undefined;
  } finally {
    invalidateNativeHouseholdObject(client, entity);
  }

  try {
    await saveNativeObjectFields({
      namespace: entity,
      id,
      fields,
      readEdits,
      fileError,
      signal,
      settled: () => invalidateNativeHouseholdObject(client, entity),
    });
    signal.throwIfAborted();

    return { id, wireId };
  } catch {
    // Metadata failures have no native error callback; file errors report above.
    return undefined;
  }
}
