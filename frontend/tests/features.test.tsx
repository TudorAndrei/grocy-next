import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { AppShell } from "@/components/AppShell";
import { CommandProvider } from "@/components/CommandBar";
import { FeatureRoute } from "@/components/FeatureRoute";
import { Toaster } from "@/components/Toaster";
import { Route as TodayRoute } from "@/routes/today";
import type { JsonObject } from "@/lib/json";
import { mountNativeEditor } from "./fixtures/native-editor";

function mount(path: string, config: JsonObject, today = false) {
  vi.stubGlobal("scrollTo", vi.fn());

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

  onTestFinished(() => queryClient.clear());
}

test("native Tasks remains readable with its feature disabled while navigation follows native flag truthiness", async () => {
  const config = {
    FEATURE_FLAG_STOCK: false,
    FEATURE_FLAG_SHOPPINGLIST: false,
    FEATURE_FLAG_TASKS: "0",
    FEATURE_FLAG_CHORES: "off",
  };

  mountNativeEditor(
    "/tasks",
    (url) => {
      if (url === "/api/v2/tasks/overview")
        return Response.json({
          rows: [
            {
              id: 1,
              name: "Read the hidden task",
              due_date: null,
              done: 0,
              due_type: "",
              category_id: null,
              has_category: false,
              category_name: null,
              assigned_to_user_id: null,
              assigned_name: null,
              custom_values: {},
            },
          ],
          categories: [],
          next_days: "5",
          include_done: false,
        });

      return undefined;
    },
    config,
  );
  await screen.findByText("Read the hidden task");
  const nav = screen.getByRole("navigation", { name: "Primary" });
  expect(within(nav).getByRole("link", { name: "Chores overview" }).getAttribute("href")).toBe(
    "/choresoverview",
  );
  expect(within(nav).queryByRole("link", { name: "Tasks" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Feature disabled" })).toBeNull();
});

test.each(["/products/7", "/recipes/7", "/catalog", "/shopping", "/stock", "/meal-plan"])(
  "modern route %s remains feature gated alongside native paths",
  async (path) => {
    mountNativeEditor(path, () => undefined, {
      FEATURE_FLAG_STOCK: false,
      FEATURE_FLAG_SHOPPINGLIST: false,
      FEATURE_FLAG_RECIPES: false,
      FEATURE_FLAG_RECIPES_MEALPLAN: false,
    });
    await screen.findByRole("heading", { name: "Feature disabled" });
  },
);

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

test("native unconditional menu links and command results survive disabled modules/auth while only API keys follow the auth flag", async () => {
  const config = {
    FEATURE_FLAG_STOCK: false,
    FEATURE_FLAG_SHOPPINGLIST: false,
    FEATURE_FLAG_RECIPES: false,
    FEATURE_FLAG_CHORES: false,
    FEATURE_FLAG_TASKS: false,
    FEATURE_FLAG_BATTERIES: false,
    FEATURE_FLAG_EQUIPMENT: false,
    FEATURE_FLAG_CALENDAR: false,
    DISABLE_AUTH: true,
  };

  const app = mountNativeEditor(
    "/barcodescannertesting",
    (url) => (url === "/api/v2/user/permissions" ? Response.json({}) : undefined),
    config,
  );

  await screen.findByRole("heading", { name: "Barcode scanner testing" });
  const nav = within(screen.getByRole("navigation", { name: "Primary" }));
  await waitFor(() => expect(app.client.getQueryData(["system", "config"])).toMatchObject(config));

  await userEvent.setup().click(nav.getByRole("button", { name: "Manage master data" }));

  for (const name of [
    "Products",
    "Quantity units",
    "Product groups",
    "Userfields",
    "Userentities",
    "Stock settings",
    "REST API browser",
    "Barcode scanner testing",
    "About Grocy",
  ])
    expect(nav.getByRole("link", { name })).toBeTruthy();
  expect(nav.getByRole("link", { name: "REST API browser" }).getAttribute("target")).toBe("_blank");
  const about = nav.getByRole("link", { name: "About Grocy" });
  expect(about.getAttribute("href")).toBe("/about?embedded");
  expect(about.getAttribute("data-dialog-type")).toBe("wider");

  for (const name of [
    "Stock overview",
    "Shopping list",
    "Recipes",
    "Calendar",
    "Manage API keys",
    "Shopping list settings",
  ])
    expect(nav.queryByRole("link", { name })).toBeNull();
  expect(nav.getByRole("link", { name: "Manage users" }).getAttribute("aria-disabled")).toBe(
    "true",
  );
  const user = userEvent.setup();
  await user.click(screen.getAllByRole("button", { name: /Quick actions/ })[0]!);
  const input = screen.getByRole("combobox", { name: "Command" });
  await user.type(input, "Stock settings");
  expect(screen.getByRole("option", { name: /Stock settings/ })).toBeTruthy();
  await user.clear(input);
  await user.type(input, "Manage users");
  expect(screen.queryByRole("option", { name: /Manage users/ })).toBeNull();
  await user.clear(input);
  await user.type(input, "REST API browser");
  expect(screen.getByRole("option", { name: /REST API browser/ })).toBeTruthy();
  await act(() => app.client.setQueryData(["system", "config"], { ...config, DISABLE_AUTH: "0" }));
  await waitFor(() => expect(nav.getByRole("link", { name: "Manage API keys" })).toBeTruthy());
  await act(() =>
    app.client.setQueryData(["system", "config"], { ...config, DISABLE_AUTH: "off" }),
  );
  await waitFor(() => expect(nav.queryByRole("link", { name: "Manage API keys" })).toBeNull());
  expect(screen.getByRole("option", { name: /REST API browser/ })).toBeTruthy();
});

test("native navigation applies only source permission classes and uses canonical stock/shopping destinations", async () => {
  const app = mountNativeEditor(
    "/barcodescannertesting",
    (url) => {
      if (url === "/api/v2/user/permissions")
        return Response.json({ RECIPES: true, CHORE_TRACK_EXECUTION: true });

      if (url === "/api/v2/shopping-lists/1")
        return Response.json({ id: 1, name: "Groceries", items: [] });

      return undefined;
    },
    { FEATURE_FLAG_STOCK: true, FEATURE_FLAG_SHOPPINGLIST: true },
  );

  await screen.findByRole("heading", { name: "Barcode scanner testing" });
  const nav = within(screen.getByRole("navigation", { name: "Primary" }));
  await waitFor(() => expect(nav.getByRole("link", { name: "Recipes" })).toBeTruthy());
  expect(nav.getByRole("link", { name: "Stock overview" }).getAttribute("href")).toBe(
    "/stockoverview",
  );
  expect(nav.getByRole("link", { name: "Shopping list" }).getAttribute("href")).toBe(
    "/shoppinglist",
  );

  for (const name of [
    "Chores overview",
    "Tasks",
    "Batteries overview",
    "Chore tracking",
    "Stock settings",
    "Recipes settings",
  ])
    expect(nav.getByRole("link", { name })).toBeTruthy();

  for (const name of [
    "Purchase",
    "Consume",
    "Transfer",
    "Inventory",
    "Meal plan",
    "Calendar",
    "Equipment",
    "Shopping list settings",
    "Tasks settings",
    "Battery tracking",
  ])
    expect(nav.getByRole("link", { name }).getAttribute("aria-disabled")).toBe("true");
  const equipment = nav.getByRole("link", { name: "Equipment" });
  expect(equipment.getAttribute("href")).toBe("/equipment");
  expect(equipment.parentElement?.classList.contains("not-allowed")).toBe(true);
  expect(
    nav.getByRole("link", { name: "Shopping list settings" }).classList.contains("not-allowed"),
  ).toBe(true);
  equipment.focus();
  await userEvent.keyboard("{Enter}");
  await screen.findByRole("heading", { name: "Equipment", level: 1 });
  await screen.findByRole("table", { name: "Equipment" });
  expect(app.router.history.location.pathname).toBe("/equipment");
});

test.each([false, true])(
  "native shell nutrition count respects resolved STOCK permission (%s), including cached data",
  async (stockAllowed) => {
    let proposalReads = 0;

    const proposals = [1, 2, 3].map((id) => ({
      id,
      product_id: 7,
      status: "pending",
      payload: {
        product_id: 7,
        basis: { quantity: 100, unit: "g" },
        nutrients: {},
      },
    }));

    const app = mountNativeEditor(
      "/barcodescannertesting",
      (url) => {
        if (url === "/api/v2/user/permissions") return Response.json({ STOCK: stockAllowed });

        if (url === "/api/v2/nutrition/proposals?status=pending") {
          proposalReads += 1;

          return Response.json(proposals.slice(0, 2));
        }

        if (url === "/api/v2/shopping-lists/1")
          return Response.json({ id: 1, name: "Groceries", items: [] });

        return undefined;
      },
      { FEATURE_FLAG_STOCK: true, FEATURE_FLAG_SHOPPINGLIST: true },
    );

    await screen.findByRole("heading", { name: "Barcode scanner testing" });
    await waitFor(() =>
      expect(app.client.getQueryData(["user-permissions"])).toEqual({ STOCK: stockAllowed }),
    );

    const review = within(screen.getByRole("navigation", { name: "Primary" })).getByRole("link", {
      name: /^Review/,
    });

    if (stockAllowed)
      await waitFor(() => expect(within(review).getByLabelText("2 open")).toBeTruthy());

    await act(async () => {
      // A previously loaded proposal cache must not expose counts to a denied actor.
      app.client.setQueryData(["proposals", "pending"], proposals);
      await new Promise<void>((resolve) => notifyManager.schedule(resolve));
    });
    expect.soft(proposalReads > 0).toBe(stockAllowed);
    expect.soft(within(review).queryByLabelText("3 open") !== null).toBe(stockAllowed);
    // This native-compatible count read remains authenticated, without a STOCK grant.
    expect(
      app.fetchMock.mock.calls.some(([url]) => String(url) === "/api/v2/shopping-lists/1"),
    ).toBe(true);
  },
);
