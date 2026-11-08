import { z } from "zod";
import type { QueryClient } from "@tanstack/react-query";
import { request } from "./api";
import { apiHref } from "./open-document";

export const nativeApiKeySchema = z
  .object({
    id: z.number(),
    user_id: z.number(),
    api_key: z.string(),
    description: z.string().nullable(),
    key_type: z.string(),
    expires: z.string().nullable(),
    last_used: z.string().nullable(),
    row_created_timestamp: z.string().nullable(),
  })
  .passthrough();

export const nativeApiKeysContextSchema = z.object({
  keys: z.array(nativeApiKeySchema),
  users: z.array(
    z
      .object({
        id: z.number(),
        username: z.string().nullable(),
        first_name: z.string().nullable(),
        last_name: z.string().nullable(),
      })
      .passthrough(),
  ),
  selected_key_id: z.union([z.string(), z.number()]),
});

export type NativeApiKey = z.infer<typeof nativeApiKeySchema>;

export async function getNativeApiKeys(search: string, signal?: AbortSignal) {
  return nativeApiKeysContextSchema.parse(
    await request(`/api/v2/access/api-keys-context${search}`, { signal }),
  );
}

export function invalidateNativeApiKeys(client: QueryClient) {
  for (const key of [["native-api-keys"], ["api-keys"]])
    void client.invalidateQueries({ queryKey: key, refetchType: "none" });
}

export async function createNativeApiKey(
  search: string,
  signal?: AbortSignal,
  client?: QueryClient,
) {
  signal?.throwIfAborted();

  try {
    const response = await request(`/api/v2/access/api-keys/new${search}`, { signal });
    signal?.throwIfAborted();

    return z.object({ id: z.number() }).parse(response).id;
  } finally {
    if (client) invalidateNativeApiKeys(client);
  }
}

export function apiKeyQrContent(key: NativeApiKey) {
  const absolute = (path: string) => new URL(apiHref(path), window.location.href).href;

  return key.key_type === "special-purpose-calendar-ical"
    ? absolute(`/api/calendar/ical?secret=${key.api_key}`)
    : `${absolute("/api")}|${key.api_key}`;
}
