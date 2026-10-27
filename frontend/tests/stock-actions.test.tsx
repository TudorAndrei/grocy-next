import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { StockActions } from "@/components/StockActions";
import { Toaster } from "@/components/Toaster";

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

      if (path === "/api/stock/products/1") {
        return Response.json({ stock_amount: stock, stock_amount_opened: 0 });
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
      </Toaster>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await screen.findByRole("img", { name: "Milk, 0% of minimum" });
  await user.click(screen.getByRole("button", { name: "Purchase 1 pc" }));
  await screen.findByRole("img", { name: "Milk, 100% of minimum" });
  await user.click(await screen.findByRole("button", { name: "Undo" }));
  await screen.findByRole("img", { name: "Milk, 0% of minimum" });
  expect(stock).toBe(0);
});
