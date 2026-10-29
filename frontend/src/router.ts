import type { QueryClient } from "@tanstack/react-query";
import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

type AppRouterOptions = {
  basepath?: string;
  history?: RouterHistory;
  context?: { queryClient: QueryClient };
};

export function createAppRouter(options: AppRouterOptions = {}) {
  return createRouter({
    routeTree,
    ...options,
    // Legacy links carry literal query text. JSON parsing changes names, codes,
    // and numeric spellings before the route can apply its own validation.
    parseSearch: (search) => Object.fromEntries(new URLSearchParams(search)),
    stringifySearch: (search) => {
      const query = new URLSearchParams();

      for (const [key, value] of Object.entries(search))
        if (value !== undefined) query.set(key, String(value));

      const encoded = query.toString();

      return encoded ? `?${encoded}` : "";
    },
  });
}
