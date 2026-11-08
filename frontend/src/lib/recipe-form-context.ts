import { z } from "zod";
import { request } from "./api";
import { customDataFieldSchema } from "./custom-data-context";

const nativeNumber = z.union([z.number(), z.string()]).nullable();

export const recipeRecordSchema = z
  .object({
    id: z.number(),
    name: z.string().nullable(),
    description: z.string().nullable(),
    picture_file_name: z.string().nullable(),
    base_servings: nativeNumber,
    desired_servings: nativeNumber,
    not_check_shoppinglist: z.number(),
    type: z.string().nullable(),
    product_id: z.number().nullable(),
  })
  .passthrough();

export type RecipeFormRecord = z.infer<typeof recipeRecordSchema>;

export const recipePositionSchema = z
  .object({
    id: z.number(),
    recipe_id: z.number(),
    product_id: z.number(),
    amount: nativeNumber,
    qu_id: z.number().nullable(),
    only_check_single_unit_in_stock: z.number(),
    ingredient_group: z.string().nullable(),
    note: z.string().nullable(),
    note_html: z.string().optional(),
    not_check_stock_fulfillment: z.number(),
    variable_amount: z.string().nullable(),
    price_factor: nativeNumber,
    round_up: z.number(),
  })
  .passthrough();

export type RecipeFormPosition = z.infer<typeof recipePositionSchema>;

export const recipeNestingSchema = z
  .object({
    id: z.number(),
    recipe_id: z.number(),
    includes_recipe_id: z.number(),
    servings: nativeNumber,
  })
  .passthrough();

export type RecipeFormNesting = z.infer<typeof recipeNestingSchema>;

export const recipeProductSchema = z
  .object({
    id: z.number(),
    name: z.string().nullable(),
    active: z.number(),
    location_id: z.number(),
    qu_id_stock: z.number(),
    qu_id_purchase: z.number(),
    qu_id_consume: z.number().nullable(),
    qu_id_price: z.number().nullable(),
    not_check_stock_fulfillment_for_recipes: z.number().nullable(),
  })
  .passthrough();

export type RecipeFormProduct = z.infer<typeof recipeProductSchema>;

export const recipeUnitSchema = z
  .object({
    id: z.number(),
    name: z.string().nullable(),
    name_plural: z.string().nullable(),
    plural_forms: z.string().nullable(),
    active: z.number(),
  })
  .passthrough();

export type RecipeFormUnit = z.infer<typeof recipeUnitSchema>;

export const recipeConversionSchema = z
  .object({
    id: z.number(),
    product_id: z.number().nullable(),
    from_qu_id: z.number().nullable(),
    to_qu_id: z.number().nullable(),
    from_qu_name: z.string().nullable(),
    from_qu_name_plural: z.string().nullable(),
    to_qu_name: z.string().nullable(),
    to_qu_name_plural: z.string().nullable(),
    factor: nativeNumber,
    path: z.string().nullable(),
  })
  .passthrough();

export type RecipeFormConversion = z.infer<typeof recipeConversionSchema>;

export const recipeBarcodeSchema = z
  .object({
    product_id: z.number(),
    barcodes: z.string().nullable(),
  })
  .passthrough();

export const recipeFormContextSchema = z.object({
  recipe: recipeRecordSchema.nullable(),
  positions: z.array(recipePositionSchema),
  nestings: z.array(recipeNestingSchema),
  recipes: z.array(recipeRecordSchema),
  products: z.array(recipeProductSchema),
  units: z.array(recipeUnitSchema),
  conversions: z.array(recipeConversionSchema),
  fields: z.array(customDataFieldSchema),
  values: z.record(z.string(), z.string().nullable()),
});

export type RecipeFormContext = z.infer<typeof recipeFormContextSchema>;

export const recipeIngredientContextSchema = z.object({
  recipe: recipeRecordSchema,
  position: recipePositionSchema.nullable(),
  products: z.array(recipeProductSchema),
  barcodes: z.array(recipeBarcodeSchema),
  units: z.array(recipeUnitSchema),
  conversions: z.array(recipeConversionSchema),
  barcode_lookup_plugin_name: z.string(),
});

export type RecipeIngredientContext = z.infer<typeof recipeIngredientContextSchema>;

export async function getRecipeFormContext(
  id: number | null,
  signal?: AbortSignal,
): Promise<RecipeFormContext> {
  return recipeFormContextSchema.parse(
    await request(`/api/v2/recipes/editor${id === null ? "" : `?recipe_id=${id}`}`, { signal }),
  );
}

export async function getRecipeIngredientContext(
  recipeId: number,
  positionId: number | null,
  signal?: AbortSignal,
): Promise<RecipeIngredientContext> {
  const search = new URLSearchParams({ recipe_id: String(recipeId) });

  if (positionId !== null) search.set("position_id", String(positionId));

  return recipeIngredientContextSchema.parse(
    await request(`/api/v2/recipes/ingredient-editor?${search}`, { signal }),
  );
}
