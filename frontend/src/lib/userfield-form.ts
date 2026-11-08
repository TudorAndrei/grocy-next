import { z } from "zod";
import type { QueryClient } from "@tanstack/react-query";
import { request } from "./api";
import { userfieldSchema } from "./userfields";

export const userfieldFormSearch = z
  .object({
    entity: z.string().optional().catch(undefined),
    embedded: z.string().optional().catch(undefined),
  })
  .passthrough();

export const userfieldDefinitionSchema = userfieldSchema.extend({
  entity: z.string(),
  sort_number: z.union([z.number(), z.string()]).nullable(),
  show_as_column_in_tables: z.number(),
});

export type UserfieldDefinitionRecord = z.infer<typeof userfieldDefinitionSchema>;

export async function getUserfieldDefinition(id: number, signal?: AbortSignal) {
  return userfieldDefinitionSchema.parse(
    await request(`/api/objects/userfields/${id}`, { signal }),
  );
}

/** Definition writes may commit even when the originating document has retired. */
export async function invalidateUserfieldDefinitions(client: QueryClient) {
  await Promise.all(
    [
      ["entity-manager-userfields"],
      ["custom-data-fields"],
      ["custom-data-catalog"],
      ["custom-data-objects"],
      ["objects", "userfields"],
      ["userfield-editor"],
      ["native-products"],
      ["native-product-editor"],
      ["native-product-fields"],
      ["stock-entry-editor"],
      ["native-stock-entry-editor"],
      ["stock", "purchase-editor"],
      ["stock", "inventory-editor"],
      ["users-overview"],
      ["user-editor"],
      ["recipe-form"],
      ["shopping-list-editor"],
      ["shopping-item-editor"],
    ].map((queryKey) => client.invalidateQueries({ queryKey, refetchType: "none" })),
  );
}
