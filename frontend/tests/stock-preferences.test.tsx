import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import { StockActions } from "@/components/StockActions";
import { StockLedger } from "@/components/StockLedger";

test("stock preference controls read legacy booleans and save typed values", async () => {
  localStorage.setItem("grocy_next_theme", "light");
  vi.stubGlobal("scrollTo", vi.fn());
  let saved: Record<string, number | boolean> | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (path === "/api/user") return Response.json([{ id: 1, username: "tester" }]);

      if (path === "/api/system/info")
        return Response.json({
          grocy_version: { Version: "4.5.0", ReleaseDate: "" },
          python_version: "3.13",
        });

      if (path === "/api/system/config") return Response.json({});

      if (path === "/api/v2/user/settings" && init?.method === "PUT") {
        saved = JSON.parse(String(init.body));

        return Response.json({});
      }

      if (path === "/api/user/settings") {
        return Response.json({
          stock_default_consume_amount_use_quick_consume_amount: "on",
          show_purchased_date_on_purchase: 1,
          scan_mode_consume_enabled: "true",
          stock_decimal_places_prices_input: 2,
          stock_decimal_places_prices_display: 2,
        });
      }

      return Response.json({ items: [] });
    }),
  );

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/settings?tab=preferences"] }),
  });

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();

  const quick = await screen.findByRole<HTMLInputElement>("checkbox", {
    name: 'Use the products "Quick consume amount"',
  });

  expect(quick.checked).toBe(true);
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Barcode mode defaults to consume" })
      .checked,
  ).toBe(true);
  await user.click(quick);
  await user.click(
    screen.getByRole("checkbox", {
      name: "Show purchased date on purchase and inventory page (otherwise the purchased date defaults to today)",
    }),
  );
  const inputPrecision = screen.getByLabelText("Decimal places allowed for prices (input)");
  await user.clear(inputPrecision);
  await user.type(inputPrecision, "3");
  const displayPrecision = screen.getByLabelText("Decimal places allowed for prices (display)");
  await user.clear(displayPrecision);
  await user.type(displayPrecision, "4");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(saved).toEqual({
      stock_default_consume_amount_use_quick_consume_amount: false,
      show_purchased_date_on_purchase: false,
      stock_decimal_places_prices_input: 3,
      stock_decimal_places_prices_display: 4,
    }),
  );
});

test.each([
  { showDate: false, inventory: false },
  { showDate: "on", inventory: false },
  { showDate: false, inventory: true },
  { showDate: "on", inventory: true },
])(
  "purchase date submission follows the user preference ($showDate, inventory $inventory)",
  async ({ showDate, inventory }) => {
    let saved: Record<string, number | string> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = String(input);

        if (path === "/api/system/config") return Response.json({});

        if (path === "/api/user/settings")
          return Response.json({
            stock_default_purchase_amount: 1,
            show_purchased_date_on_purchase: showDate,
          });

        if (path === "/api/objects/products")
          return Response.json([{ id: 1, name: "Milk", qu_id_stock: 1 }]);

        if (path === "/api/objects/quantity_units")
          return Response.json([{ id: 1, name: "Piece", name_plural: "Pieces" }]);

        if (path === "/api/stock/products/1") return Response.json({ stock_amount: 0 });

        if (path === "/api/stock/products/1/add" || path === "/api/stock/products/1/inventory") {
          saved = JSON.parse(String(init?.body));

          return Response.json([]);
        }

        return Response.json([]);
      }),
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        {inventory ? <StockLedger productId={1} /> : <StockActions productId={1} />}
      </QueryClientProvider>,
    );
    const user = userEvent.setup();

    if (inventory) await user.click(await screen.findByRole("button", { name: "Count" }));
    else await user.click(await screen.findByText("Purchase details"));

    if (showDate)
      expect(screen.getByLabelText<HTMLInputElement>("Purchase date").value).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
    else expect(screen.queryByLabelText("Purchase date")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: inventory ? "Save count" : "Purchase 1 pc" }),
    );
    await waitFor(() => expect(saved).toBeDefined());
    expect(Object.hasOwn(saved ?? {}, "purchased_date")).toBe(Boolean(showDate));
  },
);

test.each([
  [0, "3"],
  [3, "2.500"],
])("price history uses %s decimal places", async (precision, expected) => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const path = String(input);

      if (path === "/api/system/config") return Response.json({});

      if (path === "/api/user/settings")
        return Response.json({ stock_decimal_places_prices_display: precision });

      if (path === "/api/stock/products/1/price-history") return Response.json([{ price: 2.5 }]);

      return Response.json([]);
    }),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <StockLedger productId={1} />
    </QueryClientProvider>,
  );
  await screen.findByText(String(expected));
});
