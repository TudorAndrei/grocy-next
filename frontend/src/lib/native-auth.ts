import { z } from "zod";
import { request } from "./api";
import type { JsonObject } from "./json";

const context = z.object({ login_url: z.string(), logout_url: z.string() });

const publicUrl = z.object({
  BASE_URL: z.string().default("/"),
  DISABLE_URL_REWRITING: z.json().default(false),
});

export function nativeLoginQuery() {
  return {
    queryKey: ["native-login-context"],
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      context.parse(await request("/api/v2/system/login-context", { signal })),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always" as const,
    refetchOnWindowFocus: false,
    retry: false,
  };
}

/** UrlManager's public root is independent of the frontend/API routing prefix. */
function nativeAccountUrl(path: string, config: JsonObject, origin: string) {
  const values = publicUrl.parse(config);
  const base = values.BASE_URL === "/" ? origin : values.BASE_URL;

  return `${base.replace(/\/+$/, "")}${values.DISABLE_URL_REWRITING === false ? "" : "/index.php"}${path}`;
}

export function nativeLogoutUrl(config: JsonObject, origin: string) {
  return nativeAccountUrl("/logout", config, origin);
}

export function nativeAccountVisible(config: JsonObject) {
  const value = config.DISABLE_AUTH;

  // PHP's nonempty string "false" is true; its string "0" is false.
  return (
    value === undefined ||
    value === null ||
    value === false ||
    value === 0 ||
    value === "" ||
    value === "0" ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function nativeAccountExternal(config: JsonObject) {
  if (z.enum(["dev", "demo", "prerelease"]).safeParse(config.MODE).success) return false;

  return (
    config.AUTH_CLASS === "Grocy\\Middleware\\LdapAuthMiddleware" ||
    config.AUTH_CLASS === "Grocy\\Middleware\\ReverseProxyAuthMiddleware"
  );
}

export function nativeAccountUserUrl(id: number, config: JsonObject, origin: string) {
  const query = nativeAccountExternal(config) ? "" : "?changepw=true";

  return nativeAccountUrl(`/user/${id}${query}`, config, origin);
}

export function nativeAccountPictureUrl(name: string, config: JsonObject, origin: string) {
  const bytes = Array.from(new TextEncoder().encode(name), (byte) =>
    String.fromCharCode(byte),
  ).join("");

  const encoded = btoa(bytes);

  return nativeAccountUrl(
    `/files/userpictures/${encoded}_${encoded}?force_serve_as=picture&best_fit_width=32&best_fit_height=32`,
    config,
    origin,
  );
}
