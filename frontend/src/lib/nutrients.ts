import type { Nutrients } from "./types";

export type NutrientKey = keyof Nutrients;

export const NUTRIENTS: Array<{ key: NutrientKey; label: string; unit: string; indent?: boolean }> =
  [
    { key: "energy_kcal", label: "Energy", unit: "kcal" },
    { key: "energy_kj", label: "Energy", unit: "kJ" },
    { key: "fat_g", label: "Fat", unit: "g" },
    { key: "saturated_fat_g", label: "of which saturates", unit: "g", indent: true },
    { key: "carbohydrates_g", label: "Carbohydrate", unit: "g" },
    { key: "sugars_g", label: "of which sugars", unit: "g", indent: true },
    { key: "fiber_g", label: "Fibre", unit: "g" },
    { key: "protein_g", label: "Protein", unit: "g" },
    { key: "salt_g", label: "Salt", unit: "g" },
  ];

export function formatNutrient(value: number | string | null | undefined, unit: string): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = Number(value);

  if (!Number.isFinite(num)) return String(value);
  // Keep stored precision (salt is often 0.01 g); only trim trailing zeros.
  const text = Number.isInteger(num) ? String(num) : String(Number(num.toFixed(3)));

  return unit ? `${text} ${unit}` : text;
}
