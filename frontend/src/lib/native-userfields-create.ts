import { z } from "zod";
import { request } from "./api";
import type { JsonValue } from "./json";

const definition = z.object({
  name: z.string(),
  type: z.string().nullable().optional(),
  default_value: z.string().nullable().optional(),
  input_required: z.union([z.number(), z.string(), z.boolean(), z.null()]).optional(),
});

export type NativeUserfieldCreation = z.infer<typeof definition>;

export function parseNativeUserfieldCreation(value: JsonValue): NativeUserfieldCreation {
  return definition.parse(value);
}

export async function getNativeCreateUserfields(namespace: string, signal: AbortSignal) {
  const response = await request(
    `/api/objects/userfields?query[]=entity=${encodeURIComponent(namespace)}`,
    { signal },
  );

  signal.throwIfAborted();

  return z.array(z.json()).parse(response);
}
