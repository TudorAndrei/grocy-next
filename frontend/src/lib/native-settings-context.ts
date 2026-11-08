import { z } from "zod";
import { request } from "./api";
import { nativeQueryParameter } from "./native-query-flag";

const shoppingSettingsContext = z.object({
  shopping_lists: z.array(z.object({ id: z.number(), name: z.string().nullable() })),
});

export async function getShoppingSettingsContext(signal?: AbortSignal) {
  return shoppingSettingsContext.parse(
    await request("/api/v2/settings/shopping-context", { signal }),
  );
}

export type ShoppingSettingsContext = z.infer<typeof shoppingSettingsContext>;

/** Native U prefixes application-relative return links; keep them inside that application. */
export function nativeSettingsReturnHref(search: string, rootHref: string) {
  let path;

  try {
    path = nativeQueryParameter(search, "returnto");
  } catch {
    return rootHref;
  }

  if (
    path === undefined ||
    path === true ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\")
  )
    return rootHref;
  const base = new URL(rootHref, window.location.origin);
  const basePath = base.pathname.replace(/\/$/, "");
  const target = new URL(`${basePath}${path}`, base.origin);

  if (
    target.origin !== base.origin ||
    (basePath && target.pathname !== basePath && !target.pathname.startsWith(`${basePath}/`))
  )
    return rootHref;

  return `${target.pathname}${target.search}${target.hash}`;
}
