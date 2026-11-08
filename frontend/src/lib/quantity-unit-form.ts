import { z } from "zod";
import { request } from "./api";
import { compareSqliteNames } from "./collation";
import { userfieldValuesSchema } from "./userfield-values";
import type { QueryClient } from "@tanstack/react-query";

export const quantityUnitSearch = z
  .object({
    embedded: z.string().optional().catch(undefined),
    include_disabled: z.string().optional().catch(undefined),
    product: z.string().optional().catch(undefined),
    "qu-unit": z.string().optional().catch(undefined),
  })
  .passthrough();

export type QuantityUnitSearch = z.infer<typeof quantityUnitSearch>;

export const quantityUnitSchema = z.object({
  id: z.number(),
  name: z.string().nullable(),
  name_plural: z.string().nullable(),
  plural_forms: z.string().nullable(),
  description: z.string().nullable(),
  active: z.number(),
  userfields: userfieldValuesSchema.nullish(),
});

export const quantityUnitConversionSchema = z.object({
  id: z.number(),
  from_qu_id: z.number(),
  to_qu_id: z.number(),
  factor: z.number(),
  product_id: z.number().nullable(),
});

export type QuantityUnit = z.infer<typeof quantityUnitSchema>;

export type QuantityUnitConversion = z.infer<typeof quantityUnitConversionSchema>;

export async function getQuantityUnits(signal?: AbortSignal) {
  return z
    .array(quantityUnitSchema)
    .parse(await request("/api/objects/quantity_units", { signal }))
    .sort((a, b) => compareSqliteNames(a.name ?? "", b.name ?? ""));
}

export async function getQuantityUnit(id: number, signal?: AbortSignal) {
  return quantityUnitSchema.parse(await request(`/api/objects/quantity_units/${id}`, { signal }));
}

export async function getQuantityUnitConversions(signal?: AbortSignal) {
  return z
    .array(quantityUnitConversionSchema)
    .parse(await request("/api/objects/quantity_unit_conversions", { signal }));
}

export async function getQuantityUnitConversionContext(
  id: number | null,
  search: QuantityUnitSearch,
  signal?: AbortSignal,
) {
  const [units, record, product] = await Promise.all([
    getQuantityUnits(signal),
    id === null
      ? null
      : request(`/api/objects/quantity_unit_conversions/${id}`, { signal }).then((value) =>
          quantityUnitConversionSchema.parse(value),
        ),
    search.product === undefined
      ? null
      : request(`/api/objects/products/${search.product}`, { signal }).then((value) =>
          z
            .object({ id: z.number(), name: z.string().nullable(), qu_id_stock: z.number() })
            .parse(value),
        ),
  ]);

  const defaultUnit = units.find((unit) => String(unit.id) === search["qu-unit"]);

  if (search["qu-unit"] !== undefined && !defaultUnit) throw new Error("Object not found");

  return { units: units.filter((unit) => unit.active === 1), record, product, defaultUnit };
}

export async function invalidateQuantityUnits(client: QueryClient) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ["quantity-units"] }),
    client.invalidateQueries({ queryKey: ["resolved-conversions"] }),
    client.invalidateQueries({ queryKey: ["quantity-unit-editor"], refetchType: "none" }),
    client.invalidateQueries({
      queryKey: ["quantity-unit-conversion-editor"],
      refetchType: "none",
    }),
    client.invalidateQueries({ queryKey: ["objects", "quantity_units"] }),
    client.invalidateQueries({ queryKey: ["objects", "quantity_unit_conversions"] }),
    client.invalidateQueries({ queryKey: ["products"] }),
    client.invalidateQueries({ queryKey: ["catalog"] }),
  ]);
}
