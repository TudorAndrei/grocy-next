import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { StockActions } from "@/components/StockActions";
import { StockLedger } from "@/components/StockLedger";
import { Toaster } from "@/components/Toaster";
import { isoDay } from "@/lib/format";
import { fireEvent, waitFor } from "@testing-library/react";

test("a purchase can be undone from its confirmation", async () => {
  let stock = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const path = String(input);

      if (path === "/api/objects/products") {
        return Response.json([
          { id: 1, name: "Milk", qu_id_stock: 1, location_id: 1, min_stock_amount: 1 },
        ]);
      }

      if (path === "/api/objects/locations") {
        return Response.json([{ id: 1, name: "Fridge" }]);
      }

      if (path === "/api/objects/quantity_units") {
        return Response.json([{ id: 1, name: "Piece", name_plural: "Pieces" }]);
      }

      if (path === "/api/user/settings") {
        return Response.json({ stock_default_purchase_amount: 1 });
      }

      if (path === "/api/stock/products/1") {
        return Response.json({ stock_amount: stock, stock_amount_opened: 0 });
      }

      if (path === "/api/stock/products/1/entries") {
        return Response.json(stock ? [{ id: 1, amount: stock, location_id: 1 }] : []);
      }

      if (
        path === "/api/stock/products/1/price-history" ||
        path.startsWith("/api/objects/stock_log")
      ) {
        return Response.json([]);
      }

      if (path === "/api/stock/products/1/add") {
        stock = 1;

        return Response.json([
          {
            id: 2,
            product_id: 1,
            amount: 1,
            transaction_type: "purchase",
            transaction_id: "sale-1",
          },
        ]);
      }

      if (path === "/api/stock/transactions/sale-1/undo") {
        stock = 0;

        return new Response(null, { status: 204 });
      }

      return Response.json({ error_message: "Transaction not found" }, { status: 400 });
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Toaster>
        <StockActions productId={1} />
        <StockLedger productId={1} />
      </Toaster>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await screen.findByRole("img", { name: "Milk, 0% of minimum" });
  await user.click(screen.getByRole("button", { name: "Purchase 1 pc" }));
  await screen.findByRole("img", { name: "Milk, 100% of minimum" });
  await screen.findByText("1 at Fridge");
  await user.click(await screen.findByRole("button", { name: "Undo" }));
  await screen.findByRole("img", { name: "Milk, 0% of minimum" });
  expect(screen.queryByText("1 at Fridge")).toBeNull();
  expect(stock).toBe(0);
});

test("purchase details keep the selected freezer date and stored amount preferences", async () => {
  let purchase: Record<string, string | number | null> | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/objects/products") {
        return Response.json([
          {
            id: 1,
            name: "Milk",
            qu_id_stock: 1,
            location_id: 1,
            min_stock_amount: 1,
            default_best_before_days: 5,
            default_best_before_days_after_freezing: 90,
          },
        ]);
      }

      if (path === "/api/objects/locations") {
        return Response.json([
          { id: 1, name: "Fridge" },
          { id: 2, name: "Freezer", is_freezer: 1 },
        ]);
      }

      if (path === "/api/objects/quantity_units") {
        return Response.json([{ id: 1, name: "Piece", name_plural: "Pieces" }]);
      }

      if (path === "/api/objects/shopping_locations") {
        return Response.json([{ id: 3, name: "Market" }]);
      }

      if (path === "/api/user/settings") {
        return Response.json({ stock_default_purchase_amount: 2, stock_decimal_places_amounts: 3 });
      }

      if (path === "/api/stock/products/1") {
        return Response.json({ stock_amount: 12.3456, stock_amount_opened: 0 });
      }

      if (path === "/api/stock/products/1/add") {
        purchase = JSON.parse(String(init?.body));

        return Response.json([
          { id: 2, product_id: 1, amount: 2, transaction_id: "purchase-details" },
        ]);
      }

      return Response.json([]);
    }),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <StockActions productId={1} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await screen.findByText("12.346");
  await user.selectOptions(screen.getByLabelText("Location"), "2");
  expect(screen.getByLabelText<HTMLInputElement>("Best before").value).toBe(isoDay(90));
  await user.click(screen.getByText("Purchase details"));
  await user.type(screen.getByLabelText("Price per stock unit"), "2.5");
  await user.selectOptions(screen.getByLabelText("Store"), "3");
  fireEvent.change(screen.getByLabelText("Purchase date"), { target: { value: "2020-01-02" } });
  await user.type(screen.getByLabelText("Note"), "Weekly purchase");
  await user.click(screen.getByRole("button", { name: "Purchase 2 pcs" }));
  await waitFor(() =>
    expect(purchase).toMatchObject({
      amount: 2,
      best_before_date: null,
      location_id: 2,
      price: 2.5,
      shopping_location_id: 3,
      purchased_date: "2020-01-02",
      note: "Weekly purchase",
    }),
  );
});
