import { z } from "zod";
import { request } from "./api";
import { userfieldSchema } from "./userfields";

export const customDataCatalogSchema = z.object({
  entities: z.array(z.string()),
  field_types: z.array(z.string()),
});

export type CustomDataCatalog = z.infer<typeof customDataCatalogSchema>;

export const customDataFieldSchema = userfieldSchema
  .extend({
    entity: z.string(),
    sort_number: z.union([z.number(), z.string()]).nullable(),
    show_as_column_in_tables: z.number(),
    row_created_timestamp: z.string().nullable().optional(),
  })
  .passthrough();

export type CustomDataField = z.infer<typeof customDataFieldSchema>;

export const userobjectsContextSchema = z.object({
  userentity: z.object({
    id: z.number(),
    name: z.string(),
    caption: z.string(),
    description: z.string().nullable(),
    show_in_sidebar_menu: z.number(),
    icon_css_class: z.string().nullable(),
  }),
  fields: z.array(customDataFieldSchema),
  rows: z.array(
    z.object({
      id: z.number(),
      userentity_id: z.number(),
      values: z.record(z.string(), z.string().nullable()),
    }),
  ),
});

export type UserobjectsContext = z.infer<typeof userobjectsContextSchema>;

export async function getCustomDataCatalog(signal?: AbortSignal): Promise<CustomDataCatalog> {
  return customDataCatalogSchema.parse(await request("/api/v2/custom-data/catalog", { signal }));
}

export const customDataCatalogQuery = {
  queryKey: ["custom-data-catalog"],
  queryFn: ({ signal }: { signal: AbortSignal }) => getCustomDataCatalog(signal),
};

export async function getUserobjectsContext(
  name: string,
  signal?: AbortSignal,
): Promise<UserobjectsContext> {
  return userobjectsContextSchema.parse(
    await request(`/api/v2/custom-data/userobjects/${encodeURIComponent(name)}`, { signal }),
  );
}
