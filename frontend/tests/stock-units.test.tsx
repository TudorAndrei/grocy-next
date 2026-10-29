import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { StockActions } from "@/components/StockActions";
import { Toaster } from "@/components/Toaster";

function stockForm({ totalPrice = false, consume = false, tare = false, quick = false } = {}) {
  const writes: Record<string, number | boolean>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/objects/products")
        return Response.json([
          {
            id: 1,
            name: "Flour",
            default_best_before_days: 5,
            qu_id_stock: 1,
            qu_id_purchase: 2,
            qu_id_consume: tare ? 1 : 2,
            quick_consume_amount: 3,
            default_purchase_price_type: totalPrice ? 3 : 2,
            enable_tare_weight_handling: tare ? 1 : 0,
            tare_weight: 50,
          },
        ]);

      if (path === "/api/objects/quantity_units")
        return Response.json([
          { id: 1, name: "Piece", name_plural: "Pieces" },
          { id: 2, name: "Box", name_plural: "Boxes" },
          { id: 3, name: "Bag", name_plural: "Bags" },
        ]);

      if (path === "/api/objects/quantity_unit_conversions_resolved")
        return Response.json([
          { product_id: 1, from_qu_id: 1, to_qu_id: 1, factor: 1 },
          { product_id: 1, from_qu_id: 1, to_qu_id: 2, factor: 1 / 6 },
          { product_id: 1, from_qu_id: 2, to_qu_id: 1, factor: 6 },
          { product_id: 2, from_qu_id: 1, to_qu_id: 3, factor: 0.1 },
        ]);

      if (path === "/api/user/settings")
        return Response.json({
          stock_default_purchase_amount: 2,
          stock_default_consume_amount: 1,
          stock_default_consume_amount_use_quick_consume_amount: quick,
          stock_decimal_places_amounts: 4,
          stock_decimal_places_prices_input: 3,
        });

      if (path === "/api/stock/products/1")
        return Response.json({ stock_amount: 100, stock_amount_opened: 0 });

      if (init?.method === "POST") {
        const booking = JSON.parse(String(init.body));
        writes.push(booking);

        let bookedAmount = booking.amount;

        if (tare && (!consume || !booking.exact_amount))
          bookedAmount = Math.abs(bookedAmount - 150);

        return Response.json([
          { id: 1, product_id: 1, amount: bookedAmount, transaction_id: "move" },
        ]);
      }

      return Response.json(path === "/api/system/config" ? {} : []);
    }),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Toaster>
        <StockActions productId={1} initialMove={consume ? "consume" : "purchase"} />
      </Toaster>
    </QueryClientProvider>,
  );

  return { writes, user: userEvent.setup() };
}

test.each([
  { totalPrice: false, price: 2.058 },
  { totalPrice: true, price: 1.029 },
])("purchase converts the selected unit and price ($totalPrice)", async ({ totalPrice, price }) => {
  const { writes, user } = stockForm({ totalPrice });
  const units = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Quantity unit" });
  await waitFor(() => expect(units.value).toBe("2"));
  expect(screen.getAllByRole("option").some((option) => option.textContent === "Bag")).toBe(false);
  await screen.findByText("This equals 12 pcs.");
  await user.click(screen.getByText("Purchase details"));
  await user.type(screen.getByLabelText(totalPrice ? "Total price" : "Price per Box"), "12.345");
  await user.click(screen.getByRole("button", { name: "Purchase 2 Boxes" }));
  await waitFor(() => expect(writes[0]).toMatchObject({ amount: 12, price }));
});

test("quick consumption stays in stock units and a selected unit sets the stock limit", async () => {
  const { writes, user } = stockForm({ consume: true, quick: true });
  await screen.findByText("This equals 3 pcs.");
  const amount = screen.getByRole<HTMLInputElement>("textbox", { name: "Amount" });
  expect(amount.value).toBe("0.5");
  await user.clear(amount);
  await user.type(amount, "20");
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Consume 20 Boxes" }).disabled).toBe(
    true,
  );
  await user.clear(amount);
  await user.type(amount, "2");
  await user.click(screen.getByRole("button", { name: "Consume 2 Boxes" }));
  await waitFor(() => expect(writes[0]).toMatchObject({ amount: 12 }));
});

test("tare purchases use gross weight and the legacy total price divisor", async () => {
  const { writes, user } = stockForm({ tare: true, totalPrice: true });
  await screen.findByText(/Tare weight: 50 pcs/);
  const amount = screen.getByRole("textbox", { name: "Gross weight" });
  await user.clear(amount);
  await user.type(amount, "250");
  await user.click(screen.getByText("Purchase details"));
  await user.type(screen.getByLabelText("Total price"), "12");
  await user.click(screen.getByRole("button", { name: "Purchase 250 pcs" }));
  await waitFor(() => expect(writes[0]).toMatchObject({ amount: 250, price: 0.06 }));
  await screen.findByText("Purchased 100 pcs Flour");
});

test("tare consumption accepts gross weight or an exact amount", async () => {
  const { writes, user } = stockForm({ tare: true, consume: true });
  await screen.findByText(/Tare weight: 50 pcs/);
  let amount = screen.getByRole("textbox", { name: "Gross weight" });
  await user.clear(amount);
  await user.type(amount, "140");
  await user.click(screen.getByRole("button", { name: "Consume 140 pcs" }));
  await waitFor(() => expect(writes[0]).toMatchObject({ amount: 140, exact_amount: false }));
  await screen.findByText("Consumed 10 pcs Flour");
  await user.click(screen.getByRole("checkbox", { name: "Consume exact amount" }));
  amount = screen.getByRole<HTMLInputElement>("textbox", { name: "Amount" });
  await user.clear(amount);
  await user.type(amount, "10");
  await user.click(screen.getByRole("button", { name: "Consume 10 pcs" }));
  await waitFor(() => expect(writes[1]).toMatchObject({ amount: 10, exact_amount: true }));
});
