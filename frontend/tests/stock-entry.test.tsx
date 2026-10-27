import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { StockLedger } from "@/components/StockLedger";

test("an entry amount edit preserves its purchase details", async () => {
  let saved: Record<string, string | number | boolean | null> | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/stock/entry/1") {
        saved = JSON.parse(String(init?.body));

        return Response.json([]);
      }

      if (path === "/api/stock/products/1/entries") {
        return Response.json([
          {
            id: 1,
            product_id: 1,
            amount: 2,
            best_before_date: "2027-01-01",
            purchased_date: "2026-01-02",
            price: 2.5,
            location_id: 1,
            shopping_location_id: 3,
            note: "Keep this note",
            open: 1,
          },
        ]);
      }

      if (path === "/api/objects/locations") return Response.json([{ id: 1, name: "Fridge" }]);

      if (path === "/api/objects/shopping_locations")
        return Response.json([{ id: 3, name: "Market" }]);

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
  await user.clear(screen.getByLabelText("Entry amount"));
  await user.type(screen.getByLabelText("Entry amount"), "3");
  await user.click(screen.getByRole("button", { name: "Save entry" }));
  await waitFor(() =>
    expect(saved).toEqual({
      amount: 3,
      best_before_date: "2027-01-01",
      purchased_date: "2026-01-02",
      price: 2.5,
      location_id: 1,
      shopping_location_id: 3,
      note: "Keep this note",
      open: true,
    }),
  );
});
