import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { StockOverviewPage } from "@/components/StockOverviewPage";
import { overviewFixture } from "./fixtures/stock-overview";

function mount(priceTracking = true, failInitially = false) {
  let failed = failInitially;
  const visible = { product: { hide_on_stock_overview: 0 } };
  const hidden = { product: { hide_on_stock_overview: 1 } };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const path = String(input);

      if (path === "/api/system/config")
        return Response.json({ CURRENCY: "EUR", FEATURE_FLAG_STOCK_PRICE_TRACKING: priceTracking });

      if (path === "/api/user/settings")
        return Response.json({ stock_decimal_places_prices_display: 8, stock_due_soon_days: 14 });

      if (path === "/api/v2/stock/overview")
        return Response.json(
          overviewFixture([{ product_id: 1, product: { name: "Table-only product" }, amount: 0 }]),
        );

      if (path === "/api/stock")
        return failed
          ? Response.json({ error_message: "Statistics unavailable" }, { status: 503 })
          : Response.json([
              { ...visible, value: 1.25 },
              { ...visible, value: 2.75 },
              { ...hidden, value: 30 },
            ]);

      if (path === "/api/stock/volatile?due_soon_days=14")
        return Response.json({
          due_products: [visible, hidden],
          overdue_products: [visible, visible, hidden],
          expired_products: [visible, hidden],
          missing_products: [visible, hidden],
        });

      return Response.json([]);
    }),
  );
  const root = createRootRoute({ component: StockOverviewPage });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider
        router={createRouter({
          routeTree: root,
          history: createMemoryHistory({ initialEntries: ["/"] }),
        })}
      />
    </QueryClientProvider>,
  );

  return () => {
    failed = false;
  };
}

test.each([true, false])(
  "overview statistics use API stock, include hidden value, and preserve overlapping overdue counts (prices=%s)",
  async (prices) => {
    mount(prices);
    const currency = (34).toLocaleString(undefined, { style: "currency", currency: "EUR" });
    await screen.findByText(prices ? `2 Products, ${currency} total value` : "2 Products");
    const due = await screen.findByRole("button", { name: /Due soon\s*1/ });
    expect(due.title).toBe("1 product is due within the next 14 days");
    expect(screen.getByRole("button", { name: /Overdue\s*2/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Expired\s*1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Below min\s*1/ })).toBeTruthy();
  },
);

test("a failed summary read can retry without resetting the table search", async () => {
  const recover = mount(true, true);
  await screen.findByText("Statistics unavailable");
  const user = userEvent.setup();
  const search = screen.getByRole<HTMLInputElement>("searchbox", { name: "Search stock" });
  await user.type(search, "Table");
  recover();
  await user.click(screen.getByRole("button", { name: "Retry stock statistics" }));
  await waitFor(() => expect(screen.queryByText("Statistics unavailable")).toBeNull());
  expect(search.value).toBe("Table");
  await screen.findByText(
    `2 Products, ${(34).toLocaleString(undefined, { style: "currency", currency: "EUR" })} total value`,
  );
});
