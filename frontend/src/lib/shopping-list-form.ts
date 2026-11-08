import { z } from "zod";
import type { QueryClient } from "@tanstack/react-query";
import { request } from "./api";
import { shoppingEditorSchema } from "./shopping-list";

export const shoppingListFormSearch = z.object({}).passthrough();

export type ShoppingListFormContext = z.infer<typeof shoppingEditorSchema>;

export async function getShoppingListForm(id: number | null, signal?: AbortSignal) {
  return shoppingEditorSchema.parse(
    await request(`/api/v2/shopping-lists/editor${id === null ? "" : `?list_id=${id}`}`, {
      signal,
    }),
  );
}

export async function invalidateShoppingListForms(client: QueryClient) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ["shopping-list-editor"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["shopping-lists"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["shopping"], refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["objects", "shopping_lists"], refetchType: "none" }),
  ]);
}
