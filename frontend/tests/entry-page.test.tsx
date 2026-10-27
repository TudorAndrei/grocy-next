import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { expect, onTestFinished, test, vi } from "vitest";
import { Route } from "@/routes/index";

test.each([
  ["stock", "/stock", "/"],
  ["tasks", "/tasks", "/"],
  ["shoppinglist", "/shopping", "/grocy"],
  ["mealplan", "/meal-plan", "/grocy"],
])("home opens configured page %s at %s under %s", async (entry, destination, basepath) => {
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubEnv("BASE_URL", basepath === "/" ? "/" : `${basepath}/`);
  vi.stubEnv("VITE_API_BASE", "");
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ENTRY_PAGE: entry }));
  vi.stubGlobal("fetch", fetchMock);
  const root = createRootRoute({ component: Outlet });

  const routeTree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: "/", component: Route.options.component }),
    createRoute({
      getParentRoute: () => root,
      path: destination,
      component: () => <h1>Configured page</h1>,
    }),
  ]);

  const prefix = basepath === "/" ? "" : basepath;
  const history = createMemoryHistory({ initialEntries: [`${prefix}/`] });
  const router = createRouter({ routeTree, basepath, history });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Configured page" });
  expect(history.location.pathname).toBe(`${prefix}${destination}`);
  expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${prefix}/api/system/config`);
});
