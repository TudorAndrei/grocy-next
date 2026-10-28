import { z } from "zod";

const ingredientSchema = z.object({
  id: z.number(),
  product_id: z.number(),
  product_name: z.string(),
  product_id_effective: z.number(),
  active: z.boolean(),
  due_score: z.number().nullable(),
  amount: z.number(),
  qu_id: z.number().nullable(),
  stock_amount: z.number(),
  missing_amount: z.number(),
  shopping_amount: z.number(),
  fulfilled: z.boolean(),
  fulfilled_with_shopping_list: z.boolean(),
  ingredient_group: z.string().nullable(),
  product_group: z.string().nullable(),
  variable_amount: z.string().nullable(),
  note_html: z.string(),
  costs: z.number(),
  calories: z.number(),
});

export const recipeViewSchema = z.object({
  recipe_id: z.number(),
  need_fulfilled: z.boolean(),
  need_fulfilled_with_shopping_list: z.boolean(),
  missing_products_count: z.number(),
  cards: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        desired_servings: z.number(),
        picture_file_name: z.string().nullable(),
        preparation_html: z.string(),
        costs: z.number(),
        calories: z.number(),
        prices_incomplete: z.boolean(),
        need_fulfilled_with_shopping_list: z.boolean(),
        ingredients: z.array(ingredientSchema),
      }),
    )
    .nonempty(),
});

export type RecipeView = z.infer<typeof recipeViewSchema>;

export type RecipeCard = RecipeView["cards"][number];
