import { z } from "zod";
import { request } from "./api";
import {
  recipeRecordSchema,
  recipeProductSchema,
  recipeUnitSchema,
  recipeConversionSchema,
} from "./recipe-form-context";
import { mealPlanSectionSchema } from "./mealplan-sections";

const number = z.union([z.number(), z.string()]).nullable();

export const mealPlanEntrySchema = z
  .object({
    id: z.number(),
    day: z.string(),
    type: z.string().nullable(),
    recipe_id: number,
    recipe_servings: number,
    product_id: number,
    product_amount: number,
    product_qu_id: number,
    note: z.string().nullable(),
    section_id: number,
    done: number,
    row_created_timestamp: z.string().nullable(),
  })
  .passthrough();

export const mealPlanProductSchema = recipeProductSchema.extend({
  picture_file_name: z.string().nullable(),
  calories: number,
});

export const mealPlanProductDetailsSchema = z
  .object({
    product: mealPlanProductSchema,
    quantity_unit_stock: recipeUnitSchema,
    stock_amount: number,
    stock_amount_aggregated: number,
    last_price: number,
  })
  .passthrough();

export const mealPlanResolvedSchema = z
  .object({
    recipe_id: z.number(),
    costs: number,
    calories: number,
    need_fulfilled: number,
    need_fulfilled_with_shopping_list: number,
  })
  .passthrough();

export const mealPlanEventSchema = z.object({
  id: z.number(),
  title: z.string().nullable(),
  start: z.string(),
  date_format: z.literal("date"),
  type: z.string().nullable(),
  recipe: recipeRecordSchema.nullable(),
  entry: mealPlanEntrySchema,
  product_details: mealPlanProductDetailsSchema.nullable(),
  note_html: z.string().optional(),
});

export const mealPlanCalendarSchema = z.object({
  start: z.string(),
  days: z.union([z.number(), z.string()]),
  events: z.array(mealPlanEventSchema),
  recipes: z.array(recipeRecordSchema),
  internal_recipes: z.array(recipeRecordSchema),
  recipes_resolved: z.array(mealPlanResolvedSchema),
  products: z.array(mealPlanProductSchema),
  units: z.array(recipeUnitSchema),
  conversions: z.array(recipeConversionSchema),
  sections: z.array(mealPlanSectionSchema),
  used_sections: z.array(mealPlanSectionSchema),
  week_recipe: recipeRecordSchema.nullable(),
});

export type MealPlanCalendar = z.infer<typeof mealPlanCalendarSchema>;

export type MealPlanEvent = z.infer<typeof mealPlanEventSchema>;

export type MealPlanEntry = z.infer<typeof mealPlanEntrySchema>;

export type MealPlanRecipe = MealPlanCalendar["recipes"][number];

export type MealPlanProduct = MealPlanCalendar["products"][number];

export type MealPlanEditorRequest = {
  kind: "recipe" | "note" | "product" | "copy";
  day: string;
  entry?: MealPlanEntry;
  version: number;
};

export type MealPlanCallbacks = {
  onReload: () => Promise<void>;
  getSignal: () => AbortSignal | undefined;
};

export async function getMealPlanCalendar(search: string, signal?: AbortSignal) {
  return mealPlanCalendarSchema.parse(
    await request(`/api/v2/meal-plan/calendar${search}`, { signal }),
  );
}
