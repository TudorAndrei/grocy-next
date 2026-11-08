import { z } from "zod";
import { request } from "./api";
import { userfieldSchema } from "./userfields";

const row = z.object({ id: z.number() }).catchall(z.json());

export const nativeProductContextSchema = z.object({
  mode: z.enum(["create", "edit"]),
  product: row
    .extend({ userfields: z.record(z.string(), z.string().nullable()).nullable() })
    .nullable(),
  references: z.object({
    locations: z.array(row),
    quantity_units: z.array(row),
    shopping_locations: z.array(row),
    product_groups: z.array(row),
    products: z.array(row),
  }),
  options: z.object({
    references: z.record(z.string(), z.array(z.number())),
    parent_disabled: z.boolean(),
    conversions: z.array(
      z.object({
        from_qu_id: z.number().nullable(),
        to_qu_id: z.number().nullable(),
        factor: z.union([z.number(), z.string()]).nullable(),
      }),
    ),
  }),
  fields: z.array(
    userfieldSchema
      .extend({
        entity: z.string(),
        sort_number: z.union([z.number(), z.string()]).nullable().optional(),
        show_as_column_in_tables: z.number().optional(),
      })
      .passthrough(),
  ),
  user_settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  config: z.record(z.string(), z.json()),
  locale: z.string(),
});

export type NativeProductContext = z.infer<typeof nativeProductContextSchema>;

export async function getNativeProductContext(row: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ row });

  return nativeProductContextSchema.parse(
    await request(`/api/v2/products/native-editor?${query}`, { signal }),
  );
}

/** Slim decodes the path before matching and the matched argument once more. */
export function nativeProductRouteArgument(pathname: string) {
  const segment = /\/product\/([^/]+)\/?$/.exec(pathname)?.[1];

  if (segment === undefined) throw new Error("Object not found");

  // PHP rawurldecode preserves malformed escapes and literal plus characters.
  const decode = (value: string) =>
    new URLSearchParams("row=" + value.replaceAll("+", "%2B").replaceAll("&", "%26")).get("row") ??
    "";

  const matched = decode(segment);

  if (matched.includes("/")) throw new Error("Object not found");

  return decode(matched);
}
