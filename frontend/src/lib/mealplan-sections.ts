import { z } from "zod";
import type { QueryClient } from "@tanstack/react-query";
import { request } from "./api";

export const mealPlanSectionSchema = z
  .object({
    id: z.number(),
    name: z.string().nullable(),
    sort_number: z.union([z.number(), z.string()]).nullable(),
    time_info: z.string().nullable(),
  })
  .passthrough();

export type MealPlanSection = z.infer<typeof mealPlanSectionSchema>;

export async function getMealPlanSections(signal?: AbortSignal) {
  return z
    .object({ rows: z.array(mealPlanSectionSchema) })
    .parse(await request("/api/v2/mealplan-sections", { signal })).rows;
}

export async function getMealPlanSectionContext(id: number | null, signal?: AbortSignal) {
  return z.object({ section: mealPlanSectionSchema.nullable() }).parse(
    await request(`/api/v2/mealplan-sections/editor${id === null ? "" : `?section_id=${id}`}`, {
      signal,
    }),
  );
}

export async function invalidateMealPlanSections(client: QueryClient) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ["mealplan-sections"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["mealplan-section-editor"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["objects", "meal_plan_sections"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["meal-plan"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["mealplan-calendar"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["calendar"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["native-calendar"], refetchType: "none" }),
  ]);
}
