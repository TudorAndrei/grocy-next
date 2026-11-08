import { z } from "zod";
import { request } from "./api";
import { nativeQueryParameter } from "./native-query-flag";
import type { RecipeIngredientContext } from "./recipe-form-context";

export const recipeIngredientSearch = z.object({}).passthrough();

export function initialIngredientProduct(data: RecipeIngredientContext, search: string) {
  let selected = "";
  const name = nativeQueryParameter(search, "product-name");

  if (name !== undefined && name !== "") {
    const text = String(name);
    selected = String(
      data.products.find((product) =>
        `${data.barcodes.find((row) => row.product_id === product.id)?.barcodes?.toLowerCase() ?? ""},`.includes(
          text,
        ),
      )?.id ??
        data.products.find((product) => product.name?.includes(text))?.id ??
        "",
    );
  }

  const id = nativeQueryParameter(search, "product");

  if (id !== undefined)
    selected = data.products.some((product) => String(product.id) === String(id)) ? String(id) : "";

  return selected;
}

export type IngredientUnit = { id: number; name: string; factor: number };

export function ingredientUnits(
  data: RecipeIngredientContext,
  productId: number,
  stockUnit: number,
) {
  const rows = data.conversions.filter((row) => row.product_id === productId);
  const units: IngredientUnit[] = [];

  for (const row of rows) {
    if (row.from_qu_id !== stockUnit && row.to_qu_id !== stockUnit) continue;

    if (row.to_qu_id === null || units.some((unit) => unit.id === row.to_qu_id)) continue;
    units.push({
      id: row.to_qu_id,
      name: row.to_qu_name ?? data.units.find((unit) => unit.id === row.to_qu_id)?.name ?? "",
      factor:
        row.to_qu_id === stockUnit ? 1 : row.factor === null ? Number.NaN : Number(row.factor),
    });
  }

  return { units, conversionCount: rows.length };
}

const details = z.object({
  product: z.object({ id: z.number() }),
  quantity_unit_stock: z.object({ id: z.number(), name: z.string().nullable() }),
});

export async function getIngredientProduct(id: string, signal?: AbortSignal) {
  return details.parse(await request(`/api/stock/products/${id}`, { signal }));
}

export function ingredientStockAmount(display: string, factor: number, precision: number) {
  return (Number(display) / factor).toFixed(Math.max(1, precision)).replace(/0*$/g, "");
}

export function ingredientNumber(value: number | string | null, precision: number) {
  const number = Number.parseFloat(String(value ?? ""));

  return Number.isFinite(number)
    ? number.toLocaleString("en", { maximumFractionDigits: precision, useGrouping: false })
    : "";
}
