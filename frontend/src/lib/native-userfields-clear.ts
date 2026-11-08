import { z } from "zod";
import { request, resolveUrl } from "./api";
import type { JsonObject } from "./json";

// The pinned Clear callback reads free global bindings rather than its field value.
// Keep normal JavaScript lookup, including ReferenceError when no binding exists.
declare const value: unknown;
declare const data: { title: unknown; link: unknown };

export function nativeClearFileValue() {
  return value;
}

export function nativeClearLinkValue() {
  return data;
}

/** The source Show/thumbnail uses U('/files/...'), with the complete raw binding. */
export function nativeUserfileUrl(source: string, config: JsonObject | undefined) {
  return nativeResourceUrl(`/files/userfiles/${source}`, config);
}

/** Native U paths retain their raw tokens and configured front controller. */
export function nativeResourceUrl(path: string, config: JsonObject | undefined) {
  const configured = z.string().safeParse(config?.BASE_URL);

  if (!configured.success) return resolveUrl(path);
  const base = configured.data === "/" ? window.location.origin : configured.data;

  const script =
    config?.DISABLE_URL_REWRITING === undefined || config.DISABLE_URL_REWRITING === false
      ? ""
      : "/index.php";

  return `${base.replace(/\/+$/, "")}${script}${path}`;
}

const definitions = z.array(z.object({ name: z.string() }));

/** Fetch first, then visit the current controls in the response's order. */
export async function clearNativeUserfields(
  namespace: string,
  clear: (name: string) => void,
  signal: AbortSignal,
) {
  const fields = definitions.parse(
    await request(`/api/objects/userfields?query[]=entity=${encodeURIComponent(namespace)}`, {
      signal,
    }),
  );

  signal.throwIfAborted();

  for (const field of fields) clear(field.name);
}
