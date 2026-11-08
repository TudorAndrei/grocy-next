import { z } from "zod";
import type { QueryClient } from "@tanstack/react-query";
import { request } from "./api";
import { customDataFieldSchema } from "./custom-data-context";
import type { JsonObject } from "./json";
import { nativeUserfieldValues } from "./native-userfield-values";

export const nativeUserSchema = z
  .object({
    id: z.number(),
    username: z.string().nullable(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    picture_file_name: z.string().nullable(),
    row_created_timestamp: z.string().nullable().optional(),
    display_name: z.string().nullable().optional(),
  })
  .passthrough();

const values = z.array(
  z.object({
    object_id: z.union([z.number(), z.string()]).nullable(),
    name: z.string(),
    value: z.string().nullable(),
  }),
);

const fields = z.array(customDataFieldSchema);

const overviewSchema = z.object({
  users: z.array(nativeUserSchema),
  fields,
  values,
  current_user_id: z.number(),
  externally_managed_authentication: z.boolean(),
  show_permissions: z.boolean(),
});

const editorSchema = z.object({
  user: nativeUserSchema.nullable(),
  fields,
  values: z.record(z.string(), z.string().nullable()),
  current_user_id: z.number(),
  password_controls: z.boolean(),
  hidden_password: z.boolean(),
  externally_managed_authentication: z.boolean(),
});

export type NativeUser = z.infer<typeof nativeUserSchema>;

export type UsersOverview = z.infer<typeof overviewSchema>;

export type UserFormContext = z.infer<typeof editorSchema>;

export async function getUsersOverview(signal?: AbortSignal) {
  return overviewSchema.parse(await request("/api/v2/users/overview", { signal }));
}

export async function getUserForm(id: string | null, signal?: AbortSignal) {
  return editorSchema.parse(
    await request(`/api/v2/users/${encodeURIComponent(id ?? "new")}/form-context`, { signal }),
  );
}

export function userValues(data: Pick<UsersOverview, "fields" | "values">, id: number | null) {
  return nativeUserfieldValues(data.fields, data.values, id);
}

export function userPictureFilename(file: File) {
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

export function invalidateUsers(client: QueryClient) {
  for (const key of [
    ["users-overview"],
    ["user-editor"],
    ["users"],
    ["objects", "users"],
    ["user", "current"],
    ["entity-manager", "users"],
    ["task-form-context"],
    ["tracking-users"],
    ["tasks-page"],
    ["chores-overview"],
    ["chore-editor"],
    ["household-journal"],
    ["tracking-card", "chore"],
    ["household-current", "chores"],
    ["household-current", "tasks"],
    ["stock", "journal-view"],
    ["stock", "journal-summary"],
    ["user-permissions-editor"],
  ])
    void client.invalidateQueries({ queryKey: key, refetchType: "none" });
}

export async function writeUser(
  client: QueryClient,
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body: JsonObject,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();

  try {
    return await request(path, { method, body: JSON.stringify(body), signal });
  } finally {
    invalidateUsers(client);
  }
}
