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
import { Route } from "@/routes/stock";
import { isoDay } from "@/lib/format";

test("the due-soon filter uses the saved number of days", async () => {
  vi.stubGlobal("scrollTo", vi.fn());
  const product = { id: 1, name: "Milk", qu_id_stock: 1 };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const path = String(input);

      if (path === "/api/user/settings") return Response.json({ stock_due_soon_days: 14 });

      if (path === "/api/objects/products") return Response.json([product]);

      if (path === "/api/objects/quantity_units") return Response.json([{ id: 1, name: "Piece" }]);

      if (path === "/api/stock")
        return Response.json([
          { product_id: 1, product, amount: 1, amount_opened: 0, best_before_date: isoDay(10) },
        ]);

      if (path.startsWith("/api/stock/volatile")) return Response.json({ missing_products: [] });

      return Response.json([]);
    }),
  );
  const Stock = Route.options.component;

  if (!Stock) throw new Error("The stock route has no page.");
  const root = createRootRoute({ component: Stock });

  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Due soon\s*1/ }));
  expect(screen.getByRole("link", { name: "Milk" })).toBeTruthy();
});
