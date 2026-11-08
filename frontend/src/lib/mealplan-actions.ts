import { z } from "zod";
import type { QueryClient } from "@tanstack/react-query";
import { request } from "./api";
import type { JsonObject, JsonValue } from "./json";

export async function mealPlanAction(
  client: QueryClient,
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body: JsonObject,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  let result: JsonValue;

  try {
    result = await request<JsonValue>(path, { method, body: JSON.stringify(body), signal });
  } finally {
    // A dispatched write may have committed even when its owner departed or the response failed.
    invalidateMealPlanActions(client);
  }

  signal?.throwIfAborted();

  return result;
}

const booking = z.array(z.object({ transaction_id: z.string() })).nonempty();

export function mealPlanTransaction(value: JsonValue) {
  return booking.parse(value)[0].transaction_id;
}

const details = z.object({
  product: z.object({ id: z.number(), name: z.string().nullable() }),
  quantity_unit_stock: z.object({
    name: z.string().nullable(),
    name_plural: z.string().nullable(),
    plural_forms: z.string().nullable().optional().default(null),
    active: z.number().optional().default(1),
  }),
});

export async function mealPlanConsumedProduct(id: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const result = details.parse(await request(`/api/stock/products/${id}`, { signal }));
  signal?.throwIfAborted();

  return result;
}

export function invalidateMealPlanActions(client: QueryClient) {
  for (const key of [
    ["mealplan-calendar"],
    ["meal-plan"],
    ["objects", "meal_plan"],
    ["entity-manager", "meal_plan"],
    ["entity-manager", "recipes"],
    ["recipes"],
    ["recipe-view"],
    ["recipe-overview"],
    ["stock"],
    ["shopping"],
  ])
    void client.invalidateQueries({ queryKey: key, refetchType: "none" });
}
