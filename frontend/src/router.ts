import type { QueryClient } from "@tanstack/react-query";
import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import type { JsonObject, JsonValue } from "./lib/json";

type AppRouterOptions = {
  basepath?: string;
  history?: RouterHistory;
  context?: { queryClient: QueryClient };
};

type WireSearch = { raw: string; entries: Record<string, string> };

/** Slim accepts raw percent bytes that the router's parameter decoder rejects. */
function nativeSelectedRoutePath(pathname: string) {
  const match = /^\/(?:stockentry|product)\/([^/]+)$/.exec(pathname);

  if (!match) return pathname;

  try {
    decodeURIComponent(match[1]);

    return pathname;
  } catch {
    return pathname.replaceAll("%", "%25");
  }
}

export function createAppRouter(options: AppRouterOptions = {}) {
  // Router search validation spreads objects. A private symbol carries the original
  // query through those copies without adding a public search parameter or URL key.
  const wireSearch = Symbol("native query text");
  const scriptInBasepath = (options.basepath ?? "").replace(/\/+$/, "").endsWith("/index.php");
  const basepath = "/" + (options.basepath ?? "").replace(/^\/+|\/+$/g, "");

  const currentApplicationPath = () => {
    const href = options.history?.location.href ?? globalThis.location?.href;

    if (!href) return undefined;
    const pathname = new URL(href, "http://router.invalid").pathname;

    return basepath === "/"
      ? pathname
      : pathname.startsWith(basepath + "/")
        ? pathname.slice(basepath.length)
        : undefined;
  };

  const currentScriptPath = () => {
    const relative = currentApplicationPath();

    return relative === "/index.php"
      ? "/"
      : relative?.startsWith("/index.php/")
        ? relative.slice("/index.php".length)
        : undefined;
  };

  const encode = (key: string, value: JsonValue | undefined) =>
    new URLSearchParams([[key, String(value)]]).toString();

  const canonical = (search: JsonObject) =>
    Object.entries(search)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => encode(key, value))
      .join("&");

  return createRouter({
    routeTree,
    ...options,
    // TanStack strips basepath before custom input rewrites. A configured
    // script base already consumed index.php; do not strip a second segment.
    // Preserve an existing script alias during canonicalization/partial URI
    // edits. Links to other pages still use only the configured basepath.
    rewrite: {
      input: ({ url }) => {
        if (!scriptInBasepath) {
          if (url.pathname === "/index.php") url.pathname = "/";
          else if (url.pathname.startsWith("/index.php/"))
            url.pathname = url.pathname.slice("/index.php".length);
        }

        url.pathname = nativeSelectedRoutePath(url.pathname);

        return url;
      },
      output: ({ url }) => {
        const current =
          (!scriptInBasepath ? currentScriptPath() : undefined) ?? currentApplicationPath();

        // Masking is internal only. Keep the native bookmark and manifest URL intact.
        if (current && nativeSelectedRoutePath(current) === url.pathname) url.pathname = current;

        if (!scriptInBasepath && currentScriptPath() === url.pathname)
          url.pathname = "/index.php" + url.pathname;

        return url;
      },
    },
    // Native GetUriParam reads the first raw value, including bare flags and
    // literal percent encoding; route validators still receive ordinary strings.
    parseSearch: (search) => {
      const parsed = Object.fromEntries(new URLSearchParams(search));
      const encoded = canonical(parsed);

      if (search !== (encoded ? `?${encoded}` : ""))
        Object.defineProperty(parsed, wireSearch, {
          enumerable: true,
          value: { raw: search, entries: { ...parsed } } satisfies WireSearch,
        });

      return parsed;
    },
    stringifySearch: (search: JsonObject & { [wireSearch]?: WireSearch }) => {
      const wire = search[wireSearch];

      if (!wire) {
        const encoded = canonical(search);

        return encoded ? `?${encoded}` : "";
      }

      const used = new Set<string>();
      const parts: string[] = [];

      for (const part of wire.raw.replace(/^\?/, "").split("&")) {
        const key = new URLSearchParams(part).keys().next().value;

        if (key === undefined) {
          parts.push(part);
          continue;
        }

        const value = Object.hasOwn(search, key) ? search[key] : undefined;

        if (value === undefined) continue;

        if (String(value) === wire.entries[key]) parts.push(part);
        else if (!used.has(key)) parts.push(encode(key, value));
        used.add(key);
      }

      for (const [key, value] of Object.entries(search))
        if (value !== undefined && !used.has(key)) parts.push(encode(key, value));
      const encoded = parts.join("&");

      return encoded ? `?${encoded}` : "";
    },
  });
}
