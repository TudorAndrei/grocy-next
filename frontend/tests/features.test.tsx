import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { AppShell } from "@/components/AppShell";
import { CommandProvider } from "@/components/CommandBar";
import { FeatureRoute } from "@/components/FeatureRoute";
import { Toaster } from "@/components/Toaster";
import { Route as TodayRoute } from "@/routes/index";
import type { JsonObject } from "@/lib/json";

function mount(path: string, config: JsonObject, today = false) {
  vi.stubGlobal("scrollTo", vi.fn());
  const visited = vi.fn();

  const root = createRootRoute({
    component: () => (
      <Toaster>
        <CommandProvider>
          <AppShell>
            <FeatureRoute />
          </AppShell>
        </CommandProvider>
      </Toaster>
    ),
  });

  const routeTree = root.addChildren([
    createRoute({
      getParentRoute: () => root,
      path: "/",
      component: today ? TodayRoute.options.component : () => <p>Home page</p>,
    }),
    createRoute({
      getParentRoute: () => root,
      path: "/tasks",
      component: () => {
        visited();

        return <p>Task page</p>;
      },
    }),
    createRoute({
      getParentRoute: () => root,
      path: "/settings",
      component: () => <p>Connection settings</p>,
    }),
  ]);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["system", "config"], config);

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { visited, queryClient };
}

test("server flags control direct routes and navigation with legacy string values", async () => {
  const config = { FEATURE_FLAG_TASKS: "0", FEATURE_FLAG_CHORES: "off" };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) =>
      Response.json(
        String(input) === "/api/system/config"
          ? config
          : String(input).includes("/shopping")
            ? { items: [] }
            : [],
      ),
    ),
  );
  const { visited } = mount("/tasks", config);
  await screen.findByRole("heading", { name: "Feature disabled" });
  expect(visited).not.toHaveBeenCalled();
  const nav = screen.getByRole("navigation", { name: "Primary" });
  expect(within(nav).getByRole("link", { name: "Chores" }).getAttribute("href")).toBe("/chores");
  expect(within(nav).queryByRole("link", { name: "Tasks" })).toBeNull();
  await userEvent.setup().click(within(nav).getByRole("link", { name: "Settings" }));
  await screen.findByText("Connection settings");
});

test("typed stock actions obey a disabled stock feature", async () => {
  // jsdom has dialog elements but does not implement the browser modal methods.
  const prototype = HTMLDialogElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "showModal");
  Object.defineProperty(prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  onTestFinished(() => {
    if (descriptor) Object.defineProperty(prototype, "showModal", descriptor);
    else Reflect.deleteProperty(prototype, "showModal");
  });
  const config = { FEATURE_FLAG_STOCK: false };

  const fetchMock = vi.fn<typeof fetch>(async (input) =>
    Response.json(
      String(input) === "/api/system/config"
        ? config
        : String(input).includes("/shopping")
          ? { items: [] }
          : [],
    ),
  );

  vi.stubGlobal("fetch", fetchMock);
  mount("/", config);
  await screen.findByText("Home page");
  const user = userEvent.setup();
  await user.click(screen.getAllByRole("button", { name: /Quick actions/ })[0]!);
  await user.type(screen.getByRole("combobox", { name: "Command" }), "buy milk{Enter}");
  await screen.findByText("This action is disabled in the server configuration.");
  expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("/api/stock"))).toBe(
    false,
  );
});

test("Today loads enabled tasks while stock and shopping are disabled", async () => {
  const config = {
    FEATURE_FLAG_STOCK: false,
    FEATURE_FLAG_SHOPPINGLIST: false,
    FEATURE_FLAG_CHORES: false,
    FEATURE_FLAG_TASKS: true,
  };

  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const path = String(input);

    if (path === "/api/system/config") return Response.json(config);

    if (path === "/api/user/settings") return Response.json({});

    if (path === "/api/user") return Response.json([{ id: 1, username: "test" }]);

    if (path.startsWith("/api/tasks"))
      return Response.json([
        { id: 1, name: "Check shelves", due_date: new Date().toISOString().slice(0, 10) },
      ]);

    return Response.json([]);
  });

  vi.stubGlobal("fetch", fetchMock);
  mount("/", config, true);
  await screen.findByText("Check shelves");
  expect(screen.getByRole("button", { name: "Complete" })).toBeDefined();
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("/api/tasks"))).toBe(
      true,
    ),
  );
  expect(
    fetchMock.mock.calls.some(([input]) =>
      /^\/api\/(stock|chores|objects\/products)/.test(String(input)),
    ),
  ).toBe(false);
});
