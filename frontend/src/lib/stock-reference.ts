import { z } from "zod";
import { request } from "./api";
import { compareSqliteNames } from "./collation";
import { nativeQueryParameterPresent } from "./native-query-flag";
import { userfieldValuesSchema } from "./userfield-values";

export const stockReferences = {
  locations: {
    title: "Locations",
    path: "/locations",
    editor: "/location",
    question: 'Are you sure you want to delete location "%s"?',
  },
  product_groups: {
    title: "Product groups",
    path: "/productgroups",
    editor: "/productgroup",
    question: 'Are you sure you want to delete product group "%s"?',
  },
  shopping_locations: {
    title: "Stores",
    path: "/shoppinglocations",
    editor: "/shoppinglocation",
    question: 'Are you sure you want to delete store "%s"?',
  },
} as const;

export type StockReferenceEntity = keyof typeof stockReferences;

const record = z.object({
  id: z.number(),
  name: z.string(),
  active: z.number(),
  description: z.string().nullable(),
  userfields: userfieldValuesSchema.nullish(),
});

export type StockReferenceRecord = z.infer<typeof record>;

export async function stockReferenceRecords(entity: StockReferenceEntity, signal?: AbortSignal) {
  return z
    .array(record)
    .parse(await request("/api/objects/" + entity, { signal }))
    .sort((a, b) => compareSqliteNames(a.name, b.name));
}

export async function productGroupCounts(signal?: AbortSignal) {
  return z
    .array(z.object({ product_group_id: z.number().nullable(), active: z.number() }))
    .parse(await request("/api/objects/products", { signal }));
}

export function includesDisabledReferences(search: string) {
  return nativeQueryParameterPresent(search, "include_disabled");
}
