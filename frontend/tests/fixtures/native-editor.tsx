import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { onTestFinished, vi } from "vitest";
import { StrictMode } from "react";
import { createAppRouter } from "@/router";
import { cookieSessionSelected } from "@/lib/config";
import { supportDialogs } from "./dialogs";

export function mountNativeEditor(
  path: string,
  respond: (
    url: string,
    options: RequestInit | undefined,
  ) => Response | Promise<Response | undefined> | undefined,
  config = {},
  routerOptions: { basepath?: string } = {},
  testOptions: {
    strictMode?: boolean;
    prepareClient?: (client: QueryClient) => void;
    browserSession?: boolean;
  } = {},
) {
  supportDialogs();
  vi.stubGlobal("scrollTo", vi.fn());

  const fetchMock = vi.fn<typeof fetch>(async (input, options) => {
    const url = String(input);
    const response = await respond(url, options);

    if (response) return response;

    if (url === "/api/v2/setup") return Response.json({ needs_setup: false });

    if (url === "/api/v2/system/login-context") {
      const prefix = (routerOptions.basepath ?? "").replace(/\/+$/, "");

      return Response.json({
        login_url: `${prefix}/login`,
        logout_url: `${prefix}/logout`,
        browser_session_supplied: false,
      });
    }

    if (url === "/api/user") {
      const key = new Headers(options?.headers).get("GROCY-API-KEY");

      if (!key && !testOptions.browserSession && !cookieSessionSelected())
        return Response.json({ error_message: "Unauthorized" }, { status: 401 });

      return Response.json([{ id: 7, username: "owner" }]);
    }

    if (url === "/api/system/config")
      return Response.json({
        FEATURE_FLAG_STOCK: false,
        FEATURE_FLAG_SHOPPINGLIST: false,
        ...config,
      });

    if (url === "/api/user/settings") return Response.json({});

    if (url === "/api/v2/user/permissions") return Response.json({ MASTER_DATA_EDIT: true });

    if (url.startsWith("/api/v2/localization"))
      return Response.json({
        locale: "en",
        direction: "ltr",
        languages: ["en"],
        catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
      });

    if (url === "/api/v2/tasks/form-context")
      return Response.json({
        users: [
          { id: 7, username: "owner", display_name: "Household owner" },
          { id: 2, username: "alex", display_name: "Alex" },
        ],
        categories: [{ id: 3, name: "Work" }],
        current_user_id: 7,
      });

    return Response.json([]);
  });

  vi.stubGlobal("fetch", fetchMock);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  testOptions.prepareClient?.(client);

  const router = createAppRouter({
    ...routerOptions,
    context: { queryClient: client },
    history: createMemoryHistory({ initialEntries: [path] }),
  });

  const contents = (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  const app = render(testOptions.strictMode ? <StrictMode>{contents}</StrictMode> : contents);

  onTestFinished(() => {
    app.unmount();
    client.clear();
  });

  return { router, client, fetchMock };
}

export const notesField = (entity: string) => ({
  id: 1,
  entity,
  name: "note",
  caption: "Owner note",
  type: "text-single-line",
  input_required: 0,
  default_value: null,
  config: null,
});
