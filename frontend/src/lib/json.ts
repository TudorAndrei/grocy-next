import { z } from "zod";

export type JsonValue = z.infer<ReturnType<typeof z.json>>;

export type JsonObject = { [key: string]: JsonValue | undefined };

export function parseJson(text: string): JsonValue {
  // SAFETY: JSON.parse returns only JSON values when no reviver is supplied.
  return JSON.parse(text) as JsonValue;
}
