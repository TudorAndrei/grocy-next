import { overviewFixture } from "./fixtures/stock-overview";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Route as StockRoute } from "@/routes/stock";
import { Route as TodayRoute } from "@/routes/today";

test.each([
  { page: "Stock", component: StockRoute.options.component },
  { page: "Today", component: TodayRoute.options.component },
])(
  "$page shows a shortage when opened stock is treated as missing",
  async ({ page, component }) => {
    const milk = {
      id: 1,
      name: "Milk",
      min_stock_amount: 1,
      qu_id_stock: 1,
      treat_opened_as_out_of_stock: 1,
    };

    const bread = {
      id: 2,
      name: "Bread",
      min_stock_amount: 2,
      qu_id_stock: 1,
      parent_product_id: 99,
    };

    const family = { id: 3, name: "Family", min_stock_amount: 2, qu_id_stock: 1 };

    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const path = String(input);

        if (path === "/api/system/config" || path === "/api/user/settings")
          return Response.json({});

        if (path === "/api/user") return Response.json([{ id: 1, username: "test" }]);

        if (path === "/api/objects/products") return Response.json([milk, bread, family]);

        if (path === "/api/objects/quantity_units")
          return Response.json([{ id: 1, name: "Piece" }]);

        if (path === "/api/v2/stock/overview") {
          const view = overviewFixture([
            { product_id: 1, product: milk, amount: 3, amount_opened: 3 },
            { product_id: 2, product: bread, amount: 1 },
            {
              product_id: 3,
              product: family,
              amount: 0,
              amount_aggregated: 4,
              is_aggregated_amount: true,
            },
          ]);

          view.rows[0]!.product_missing = 1;

          return Response.json(view);
        }

        if (path === "/api/stock")
          return Response.json([
            {
              product_id: 1,
              product: milk,
              amount: 3,
              amount_opened: 3,
              amount_aggregated: 3,
              amount_opened_aggregated: 3,
              is_aggregated_amount: false,
            },
            {
              product_id: 3,
              product: family,
              amount: 0,
              amount_opened: 0,
              amount_aggregated: 4,
              amount_opened_aggregated: 0,
              is_aggregated_amount: true,
            },
            {
              product_id: 2,
              product: bread,
              amount: 1,
              amount_opened: 0,
              amount_aggregated: 1,
              amount_opened_aggregated: 0,
              is_aggregated_amount: false,
            },
          ]);

        if (path.startsWith("/api/stock/volatile"))
          return Response.json({
            missing_products: [{ id: 1, name: "Milk", amount_missing: 1, is_partly_in_stock: 1 }],
          });

        if (path.startsWith("/api/v2/shopping-lists/")) return Response.json({ items: [] });

        return Response.json([]);
      }),
    );

    if (!component) throw new Error("The route has no page.");

    const router = createRouter({
      routeTree: createRootRoute({ component }),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    if (page === "Today") await screen.findByRole("img", { name: "Milk, 0% of minimum" });
    else await screen.findByRole("link", { name: "Milk" });

    if (page === "Stock") {
      expect(screen.getByRole("link", { name: "Family" })).toBeTruthy();
      await userEvent.setup().click(screen.getByRole("button", { name: /Below min\s*1/ }));
    }

    expect(screen.getByRole("link", { name: /Milk/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Bread/ })).toBeNull();
  },
);
