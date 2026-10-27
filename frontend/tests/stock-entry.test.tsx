import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { StockLedger } from "@/components/StockLedger";

test.each([true, false])("an entry edit follows legacy tracking flags (%s)", async (tracking) => {
  let saved: Record<string, string | number | boolean | null> | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/system/config")
        return Response.json({
          FEATURE_FLAG_STOCK_PRICE_TRACKING: tracking,
          FEATURE_FLAG_STOCK_LOCATION_TRACKING: tracking,
          FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: tracking,
          FEATURE_FLAG_STOCK_PRODUCT_OPENED_TRACKING: tracking,
        });

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
            location_id: 2,
            shopping_location_id: 3,
            note: "Keep this note",
            open: 1,
          },
        ]);
      }

      if (path === "/api/objects/locations") return Response.json([{ id: 2, name: "Fridge" }]);

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

  const expected = {
    amount: 3,
    best_before_date: "2027-01-01",
    purchased_date: "2026-01-02",
    price: tracking ? 2.5 : 0,
    location_id: tracking ? 2 : 1,
    note: "Keep this note",
    open: tracking,
  };

  if (tracking) Object.assign(expected, { shopping_location_id: 3 });
  await waitFor(() => expect(saved).toEqual(expected));
});
