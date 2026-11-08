import { z } from "zod";
import { request } from "./api";
import type { MealPlanCalendar } from "./mealplan-calendar";

export function mealPlanAmountUnits(context: MealPlanCalendar, product: number, stockUnit: number) {
  const choices: { id: number; name: string; factor: number }[] = [];

  for (const row of context.conversions) {
    if (row.product_id !== product || (row.from_qu_id !== stockUnit && row.to_qu_id !== stockUnit))
      continue;

    if (row.to_qu_id === null || choices.some((choice) => choice.id === row.to_qu_id)) continue;
    choices.push({
      id: row.to_qu_id,
      name: row.to_qu_name ?? "",
      factor:
        row.to_qu_id === stockUnit ? 1 : row.factor === null ? Number.NaN : Number(row.factor),
    });
  }

  return choices;
}

export async function mealPlanRecipeServings(id: string, signal?: AbortSignal) {
  return z
    .object({ base_servings: z.union([z.number(), z.string()]).nullable() })
    .parse(await request(`/api/objects/recipes/${id}`, { signal })).base_servings;
}

export async function mealPlanProductUnit(id: string, signal?: AbortSignal) {
  return z
    .object({
      product: z.object({ id: z.number() }),
      quantity_unit_stock: z.object({ id: z.number(), name: z.string().nullable() }),
    })
    .parse(await request(`/api/stock/products/${id}`, { signal }));
}
