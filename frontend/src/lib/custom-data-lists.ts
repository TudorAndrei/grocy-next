import { z } from "zod";
import { request } from "./api";
import { compareSqliteNames } from "./collation";
import { customDataFieldSchema } from "./custom-data-context";

export const userentitySchema = z.object({
  id: z.number(),
  name: z.string(),
  caption: z.string(),
  description: z.string().nullable(),
  show_in_sidebar_menu: z.number(),
  icon_css_class: z.string().nullable(),
});

export type Userentity = z.infer<typeof userentitySchema>;

export async function getUserentities(signal?: AbortSignal) {
  return z
    .array(userentitySchema)
    .parse(await request("/api/objects/userentities", { signal }))
    .sort((a, b) => compareSqliteNames(a.name, b.name));
}

export const userentitiesQuery = {
  queryKey: ["custom-data-entities"],
  queryFn: ({ signal }: { signal: AbortSignal }) => getUserentities(signal),
};

export async function getUserfieldRows(signal?: AbortSignal) {
  return z
    .array(customDataFieldSchema)
    .parse(await request("/api/objects/userfields", { signal }))
    .sort((a, b) => compareSqliteNames(a.name, b.name));
}
