import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { StockLedger } from "@/components/StockLedger";
import { supportDialogs } from "./fixtures/dialogs";

test("the product detail ledger opens the shared entry editor and closes after its save", async () => {
  supportDialogs();
  let saved: object | undefined;

  const entry = {
    id: 1,
    product_id: 1,
    stock_id: "stock-1",
    product_name: "Milk",
    qu_name: "pc",
    amount: 2,
    best_before_date: "2027-01-01",
    purchased_date: "2026-01-02",
    price: 2.5,
    location_id: 2,
    shopping_location_id: 3,
    note: "Keep this note",
    open: 1,
  };

  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/system/config") return Response.json({});

      if (path === "/api/user/settings") return Response.json({});

      if (path === "/api/v2/stock/entries/1/editor")
        return Response.json({
          entry,
          locations: [{ id: 2, name: "Fridge" }],
          stores: [{ id: 3, name: "Market" }],
          fields: [],
          values: {},
        });

      if (path === "/api/stock/entry/1") {
        saved = JSON.parse(String(init?.body));

        return Response.json([
          { id: 11, product_id: 1, stock_id: "stock-1", transaction_id: "edit-1" },
          { id: 12, product_id: 1, stock_id: "stock-1", transaction_id: "edit-1" },
        ]);
      }

      if (path === "/api/stock/products/1/entries") return Response.json([entry]);

      if (path === "/api/objects/locations") return Response.json([{ id: 2, name: "Fridge" }]);

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
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Edit stock entry" }));
  const amount = await dialog.findByRole("spinbutton", { name: /^Amount/ });
  await user.clear(amount);
  await user.type(amount, "3");
  await user.click(dialog.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(saved).toEqual({
    amount: "3",
    best_before_date: "2027-01-01",
    purchased_date: "2026-01-02",
    price: "2.50",
    location_id: "2",
    shopping_location_id: "3",
    note: "Keep this note",
    open: true,
  });
});
