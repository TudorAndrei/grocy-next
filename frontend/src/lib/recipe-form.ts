import { z } from "zod";
import type { QueryClient } from "@tanstack/react-query";
import type { RecipeFormContext, RecipeFormPosition } from "./recipe-form-context";
import { nativeQueryParameter } from "./native-query-flag";

export const recipeFormSearch = z.object({}).passthrough();

export type RecipeSaveLocation = "continue" | "return";

export function recipePictureFilename(file: File) {
  return (
    Math.random().toString(36).substring(2, 100) +
    Math.random().toString(36).substring(2, 100) +
    file.name
      .toLowerCase()
      .replaceAll("ä", "ae")
      .replaceAll("ö", "oe")
      .replaceAll("ü", "ue")
      .replaceAll("ß", "ss")
      .replace(/\s+/g, "")
      .replace(/[^\p{ASCII}]/gu, "")
  );
}

export function initialRecipeProduct(data: RecipeFormContext, search: string) {
  let value = "";
  const name = nativeQueryParameter(search, "product-name");

  if (name !== undefined && name !== "")
    value = String(
      data.products.find(
        (product) => ",".includes(String(name)) || (product.name ?? "").includes(String(name)),
      )?.id ?? "",
    );

  const id = data.recipe?.product_id
    ? String(data.recipe.product_id)
    : nativeQueryParameter(search, "product");

  if (id !== undefined)
    value = data.products.some((product) => String(product.id) === String(id)) ? String(id) : "";

  return value;
}

export function recipeIngredientAmount(row: RecipeFormPosition, data: RecipeFormContext) {
  const text = String(row.amount ?? "").trim();
  let amount = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : 0;
  const product = data.products.find((product) => product.id === row.product_id);

  const conversion = data.conversions.find(
    (conversion) =>
      conversion.product_id === row.product_id &&
      conversion.from_qu_id === product?.qu_id_stock &&
      conversion.to_qu_id === row.qu_id,
  );

  if (conversion && row.only_check_single_unit_in_stock === 0) amount *= Number(conversion.factor);

  return amount;
}

export async function invalidateRecipeForms(client: QueryClient) {
  await Promise.all(
    [
      "recipe-form",
      "recipe-overview",
      "recipe-view",
      "recipes",
      "recipe-fulfillment",
      "mealplan-calendar",
      "calendar",
      "native-calendar",
    ].map((key) => client.invalidateQueries({ queryKey: [key], refetchType: "none" })),
  );
  await client.invalidateQueries({ queryKey: ["content", "recipes"], refetchType: "none" });
  await Promise.all(
    ["recipes", "recipes_pos", "recipes_nestings"].map((entity) =>
      client.invalidateQueries({ queryKey: ["objects", entity], refetchType: "none" }),
    ),
  );
}
