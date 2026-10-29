import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { StockActions } from "@/components/StockActions";
import { StockLedger } from "@/components/StockLedger";
import { Toaster } from "@/components/Toaster";
import { isoDay } from "@/lib/format";
import { fireEvent, waitFor } from "@testing-library/react";

test("a parent product can consume the available child stock", async () => {
  let consumed = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/system/config" || path === "/api/user/settings") return Response.json({});

      if (path === "/api/objects/products")
        return Response.json([
          {
            id: 1,
            name: "Family",
            qu_id_stock: 1,
            min_stock_amount: 1,
            treat_opened_as_out_of_stock: 1,
          },
        ]);

      if (path === "/api/objects/quantity_units")
        return Response.json([{ id: 1, name: "Piece", name_plural: "Pieces" }]);

      if (path === "/api/stock/products/1")
        return Response.json({
          stock_amount: 0,
          stock_amount_opened: 0,
          stock_amount_aggregated: 3,
          stock_amount_opened_aggregated: 1,
        });

      if (path === "/api/stock/products/1/consume") {
        consumed = JSON.parse(String(init?.body)).amount;

        return Response.json([]);
      }

      return Response.json([]);
    }),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Toaster>
        <StockActions productId={1} initialMove="consume" />
      </Toaster>
    </QueryClientProvider>,
  );
  await screen.findByRole("img", { name: "Family, 200% of minimum" });
  const user = userEvent.setup();
  const amount = screen.getByRole("textbox", { name: /Amount/ });
  await user.clear(amount);
  await user.type(amount, "3");
  await user.click(screen.getByRole("button", { name: "Consume 3 pcs" }));
  await waitFor(() => expect(consumed).toBe(3));
});

test.each([true, false])(
  "a purchase follows price tracking (%s) and can be undone",
  async (tracking) => {
    let stock = 0;
    let price: number | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = String(input);

        if (path === "/api/system/config")
          return Response.json({ FEATURE_FLAG_STOCK_PRICE_TRACKING: tracking });

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

        if (path === "/api/objects/quantity_unit_conversions_resolved") return Response.json([]);

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
          price = JSON.parse(String(init?.body)).price;
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
    expect(price).toBe(tracking ? null : 0);
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await screen.findByRole("img", { name: "Milk, 0% of minimum" });
    expect(screen.queryByText("1 at Fridge")).toBeNull();
    expect(stock).toBe(0);
  },
);

test.each([
  { freezerDays: 90, editedDate: undefined, expectedDate: () => isoDay(90) },
  { freezerDays: -1, editedDate: undefined, expectedDate: () => "2999-12-31" },
  { freezerDays: 90, editedDate: "2027-03-04", expectedDate: () => "2027-03-04" },
])(
  "purchase saves the displayed due date and preferences: %j",
  async ({ freezerDays, editedDate, expectedDate }) => {
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
              default_best_before_days_after_freezing: freezerDays,
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
          return Response.json({
            stock_default_purchase_amount: 2,
            stock_decimal_places_amounts: 3,
            show_purchased_date_on_purchase: true,
          });
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
    const dueDate = screen.getByLabelText<HTMLInputElement>("Best before");
    expect(dueDate.value).toBe(freezerDays === -1 ? "2999-12-31" : isoDay(90));

    if (editedDate) fireEvent.change(dueDate, { target: { value: editedDate } });
    await user.click(screen.getByText("Purchase details"));
    await user.type(screen.getByLabelText("Price per stock unit"), "2.5");
    await user.selectOptions(screen.getByLabelText("Store"), "3");
    fireEvent.change(screen.getByLabelText("Purchase date"), { target: { value: "2020-01-02" } });
    await user.type(screen.getByLabelText("Note"), "Weekly purchase");
    await user.click(screen.getByRole("button", { name: "Purchase 2 pcs" }));
    await waitFor(() =>
      expect(purchase).toMatchObject({
        amount: 2,
        best_before_date: expectedDate(),
        location_id: 2,
        price: 2.5,
        shopping_location_id: 3,
        purchased_date: "2020-01-02",
        note: "Weekly purchase",
      }),
    );
  },
);
