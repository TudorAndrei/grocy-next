import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import type { JsonObject } from "@/lib/json";
import { productOverview } from "./fixtures/product-overview";
import { supportDialogs } from "./fixtures/dialogs";

beforeEach(supportDialogs);

function mount(path: string, { readFailure = false, saveFailure = false } = {}) {
  const writes: { path: string; body: JsonObject }[] = [];
  let detailReads = 0;
  let saves = 0;

  const catalog = {
    barcode_lookup_plugin_name: "Demo",
    products: [
      { id: 7, name: "Coffee" },
      { id: 8, name: "Tare jar" },
    ],
    locations: [{ id: 2, name: "Freezer", is_freezer: 1 }],
    units: [{ id: 1, name: "Piece", name_plural: "Pieces" }],
    barcodes: [{ product_id: 7, barcodes: "COFFEE-2" }],
    conversions: [
      {
        product_id: 7,
        from_qu_id: 3,
        to_qu_id: 1,
        factor: "7",
        to_qu_name: "Piece",
        to_qu_name_plural: "Pieces",
      },
      {
        product_id: 7,
        from_qu_id: 1,
        to_qu_id: 3,
        factor: "0.5",
        to_qu_name: "Saved box",
        to_qu_name_plural: "Saved boxes",
      },
      {
        product_id: null,
        from_qu_id: 1,
        to_qu_id: 3,
        factor: "6",
        to_qu_name: "Global box",
        to_qu_name_plural: null,
      },
    ],
  };

  const entries = [
    {
      stock_id: "mint",
      amount: 2,
      location_id: 1,
      best_before_date: "2027-01-01",
      purchased_date: "2026-10-01",
      open: 1,
      note: "First",
    },
    {
      stock_id: "mint",
      amount: 3,
      location_id: 1,
      best_before_date: "2027-01-01",
      purchased_date: "2026-10-01",
      open: 0,
      note: "Second",
    },
    {
      stock_id: "other",
      amount: 4,
      location_id: 2,
      best_before_date: "2999-12-31",
      purchased_date: "2026-10-02",
      open: 0,
      note: null,
    },
  ];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname;

      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}"));
        writes.push({ path, body });

        if (path.endsWith("/transfer") && saveFailure && ++saves === 1)
          return Response.json({ error_message: "Transfer unavailable" }, { status: 503 });

        return path.endsWith("/transfer")
          ? Response.json([
              {
                id: 90,
                product_id: 7,
                amount: 3,
                transaction_id: "move-transaction",
                transaction_type: "transfer_from",
              },
            ])
          : Response.json({});
      }

      if (path.endsWith("/api/v2/setup")) return Response.json({ needs_setup: false });

      if (path.endsWith("/api/user")) return Response.json([{ id: 1, username: "Owner" }]);

      if (path.endsWith("/api/user/settings"))
        return Response.json({ stock_decimal_places_amounts: 2, stock_default_transfer_amount: 7 });

      if (path.endsWith("/api/system/config"))
        return Response.json({
          FEATURE_FLAG_STOCK: true,
          FEATURE_FLAG_STOCK_PRICE_TRACKING: false,
          FEATURE_FLAG_DISABLE_BROWSER_BARCODE_CAMERA_SCANNING: true,
        });

      if (path.endsWith("/api/v2/stock/transfer/editor")) return Response.json(catalog);

      if (path.includes("/shopping-lists/")) return Response.json({ items: [] });

      if (/\/api\/stock\/products\/[78]$/.test(path)) {
        if (readFailure && ++detailReads === 1)
          return Response.json({ error_message: "Product unavailable" }, { status: 503 });

        return Response.json({
          ...productOverview,
          product: {
            ...productOverview.product,
            description: null,
            id: path.endsWith("/8") ? 8 : 7,
            enable_tare_weight_handling: path.endsWith("/8") ? 1 : 0,
            should_not_be_frozen: 1,
          },
          quantity_unit_stock: { ...productOverview.quantity_unit_stock, id: 1 },
          location: { id: 1, name: "Old shelf" },
          stock_amount: 9,
        });
      }

      if (path.endsWith("/api/stock/products/7/locations"))
        return Response.json([
          { location_id: 1, location_name: "Old shelf", location_is_freezer: 0 },
          { location_id: 2, location_name: "Freezer", location_is_freezer: 1 },
        ]);

      if (path.endsWith("/api/stock/products/7/entries")) return Response.json(entries);

      if (path.endsWith("/api/objects/product_barcodes_view"))
        return Response.json(url.search.includes("COFFEE-2") ? [{ amount: 1.5, qu_id: 3 }] : []);

      return Response.json([]);
    }),
  );

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });

  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });

  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  onTestFinished(() => {
    view.unmount();
    client.clear();
  });

  return { writes };
}

test("transfer retains native unit limits and stock identity, resets, and undoes the transaction", async () => {
  const { writes } = mount("/transfer?product=7&locationId=1&stockId=mint");
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.max).toBe("5.00"));
  expect(amount.value).toBe("");
  expect(screen.getByLabelText<HTMLSelectElement>("From location").value).toBe("1");
  expect(screen.getByLabelText<HTMLInputElement>("Use a specific stock item").checked).toBe(false);
  await userEvent.selectOptions(screen.getByLabelText("Quantity unit"), "3");
  expect(amount.max).toBe("4.50");
  await userEvent.click(screen.getByLabelText("Use a specific stock item"));
  await userEvent.selectOptions(screen.getByLabelText("Specific stock item"), "mint");
  expect(amount.max).toBe("2.00");
  fireEvent.change(amount, { target: { value: "1.5" } });
  await userEvent.selectOptions(screen.getByLabelText("To location"), "2");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(writes.some((row) => row.path.endsWith("/transfer"))).toBe(true));
  expect(writes.find((row) => row.path.endsWith("/transfer"))?.body).toEqual({
    amount: "3.",
    location_id_from: "1",
    location_id_to: "2",
    stock_entry_id: "mint",
  });
  await waitFor(() => expect(amount.value).toBe("7"));
  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(writes.some((row) => row.path.endsWith("/transactions/move-transaction/undo"))).toBe(
      true,
    ),
  );
});

test("embedded stock selection keeps the forced item and the native source and unit limits", async () => {
  mount("/transfer?embedded&product=7&locationId=1&stockId=mint");
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.max).toBe("5.00"));
  const check = screen.getByLabelText<HTMLInputElement>("Use a specific stock item");
  const stock = screen.getByLabelText<HTMLSelectElement>("Specific stock item");
  expect(check.checked).toBe(true);
  expect(stock.value).toBe("mint");
  expect(stock.options.length).toBe(2);
  expect(stock.options[1]?.text).toBe(
    "Amount: 2; Due on 2027-01-01; Bought on 2026-10-01; Opened First",
  );
  await userEvent.selectOptions(screen.getByLabelText("Quantity unit"), "3");
  expect(amount.max).toBe("4.50");
  await userEvent.click(check);
  await waitFor(() => expect(amount.max).toBe("2.50"));
  expect(check.checked).toBe(false);
  expect(stock.disabled).toBe(true);
  expect(stock.value).toBe("mint");
  await userEvent.selectOptions(screen.getByLabelText("From location"), "2");
  await waitFor(() => expect(stock.options.length).toBe(2));
  expect(check.checked).toBe(true);
  expect(stock.value).toBe("");
  await userEvent.selectOptions(screen.getByLabelText("To location"), "2");
  expect(screen.getByLabelText<HTMLSelectElement>("To location").value).toBe("");
  expect(screen.getByText('This cannot be the same as the "From" location')).toBeTruthy();
});

test("barcode metadata prefills the amount and unit and unknown codes can be assigned on submit", async () => {
  const { writes } = mount("/transfer?embedded");
  const product = await screen.findByLabelText<HTMLInputElement>("Product");
  fireEvent.change(product, { target: { value: "COFFEE-2" } });
  await userEvent.type(product, "{Enter}");
  const amount = screen.getByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.value).toBe("1.5"));
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("3");
  expect(screen.getByText("This equals 3 Pieces")).toBeTruthy();
  fireEvent.change(product, { target: { value: "NEW-CODE" } });
  await userEvent.type(product, "{Enter}");
  await userEvent.click(
    await screen.findByRole("button", { name: /Add as barcode to existing product/ }),
  );
  fireEvent.change(product, { target: { value: "Coffee" } });
  await waitFor(() => expect(amount.max).toBe("5.00"));
  fireEvent.change(amount, { target: { value: "1" } });
  await userEvent.selectOptions(screen.getByLabelText("To location"), "2");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(writes.some((row) => row.path.endsWith("/objects/product_barcodes"))).toBe(true),
  );
  expect(writes.map((row) => row.path)).toEqual([
    "/api/stock/products/7/transfer",
    "/api/objects/product_barcodes",
  ]);
  expect(writes[1]?.body).toEqual({ product_id: "7", barcode: "NEW-CODE" });
});

test.each(["stock first", "locations first"])(
  "stock Grocycodes keep native source and stock choices when %s finishes",
  async (order) => {
    mount("/transfer?embedded");
    const fetchData = fetch;
    const requested = new Set<string>();
    let finishLocations!: (response: Response) => void;
    let finishStock!: (response: Response) => void;

    const locations = new Promise<Response>((resolve) => {
      finishLocations = resolve;
    });

    const stock = new Promise<Response>((resolve) => {
      finishStock = resolve;
    });

    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;

      if (path.endsWith("/products/7/locations")) {
        requested.add("locations");

        return locations;
      }

      if (path.endsWith("/objects/stock")) {
        requested.add("stock");

        return stock;
      }

      return fetchData(input, init);
    });

    const product = await screen.findByLabelText<HTMLInputElement>("Product");
    fireEvent.change(product, { target: { value: "grcy:p:7:other" } });
    await userEvent.type(product, "{Enter}");
    await waitFor(() => expect([...requested].sort()).toEqual(["locations", "stock"]));

    const completeLocations = () =>
      finishLocations(
        Response.json([
          { location_id: 1, location_name: "Old shelf", location_is_freezer: 0 },
          { location_id: 2, location_name: "Freezer", location_is_freezer: 1 },
        ]),
      );

    const completeStock = () => finishStock(Response.json([{ location_id: 2 }]));
    await act(async () => (order === "stock first" ? completeStock() : completeLocations()));
    await act(async () => (order === "stock first" ? completeLocations() : completeStock()));
    const amount = screen.getByLabelText<HTMLInputElement>("Amount");
    await waitFor(() => expect(amount.disabled).toBe(false));
    const from = screen.getByLabelText<HTMLSelectElement>("From location");
    const item = screen.getByLabelText<HTMLSelectElement>("Specific stock item");
    expect(from.value).toBe(order === "stock first" ? "1" : "2");
    expect(amount.max).toBe("5.00");
    expect(screen.getByLabelText<HTMLInputElement>("Use a specific stock item").checked).toBe(true);
    expect(item.value).toBe("");
    expect([...item.options].map((option) => option.value)).toEqual(["", "mint"]);
    await userEvent.selectOptions(from, "1");
    await userEvent.selectOptions(from, "2");
    await waitFor(() => expect(item.value).toBe("other"));
    expect(amount.max).toBe("4.00");
  },
);

test("failed reads and transfers can be retried with the draft and tare products are rejected", async () => {
  const { writes } = mount("/transfer?embedded&product=7", {
    readFailure: true,
    saveFailure: true,
  });

  await screen.findByText("Product unavailable");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  const amount = screen.getByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.max).toBe("5.00"));
  const product = screen.getByLabelText<HTMLInputElement>("Product");
  fireEvent.change(product, { target: { value: "Tare jar" } });
  await screen.findByText(
    "Products with tare weight enabled are currently not supported for transfer",
  );
  await waitFor(() => expect(product.value).toBe(""));
  fireEvent.change(product, { target: { value: "Coffee" } });
  await waitFor(() => expect(amount.disabled).toBe(false));
  fireEvent.change(amount, { target: { value: "2" } });
  await userEvent.selectOptions(screen.getByLabelText("To location"), "2");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Transfer unavailable");
  expect(amount.value).toBe("2");
  expect(screen.getByLabelText<HTMLSelectElement>("To location").value).toBe("2");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(writes.filter((row) => row.path.endsWith("/transfer")).length).toBe(2),
  );
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(true),
  );
  expect(product.disabled).toBe(true);
});
