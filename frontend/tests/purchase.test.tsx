import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import type { JsonObject } from "@/lib/json";
import { isoDay } from "@/lib/format";
import { productOverview } from "./fixtures/product-overview";
import { supportDialogs } from "./fixtures/dialogs";

beforeEach(supportDialogs);

function mount(
  path: string,
  {
    custom = false,
    customRequired = true,
    failField = false,
    failRead = false,
    failSave = false,
    failBarcode = false,
    tracking = true,
    scan = false,
    labels = false,
    serverLabels = true,
  } = {},
) {
  const writes: { path: string; body: JsonObject }[] = [];
  let reads = 0;
  let fieldWrites = 0;
  let bookings = 0;
  let scanEnabled = scan;

  const fields = custom
    ? [
        {
          id: 1,
          name: "batch",
          caption: "Batch",
          type: "text-single-line",
          input_required: customRequired ? 1 : 0,
          default_value: null,
          config: null,
        },
      ]
    : [];

  const fetchData = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;

    if (init?.method === "POST" || init?.method === "PUT") {
      const body = JSON.parse(String(init.body ?? "{}"));
      writes.push({ path, body });

      if (path.endsWith("/scan_mode_purchase_enabled")) scanEnabled = body.value;

      if (path.endsWith("/objects/product_barcodes") && failBarcode)
        return Response.json({ error_message: "Barcode unavailable" }, { status: 400 });

      if (path.endsWith("/add")) {
        if (failSave && ++bookings === 1)
          return Response.json({ error_message: "Booking unavailable" }, { status: 503 });

        if (body.stock_label_type === "2")
          return Response.json(
            ["one", "two"].map((stock_id, index) => ({
              id: 90 + index,
              product_id: 7,
              amount: 1,
              transaction_id: "purchase-transaction",
              stock_id,
              transaction_type: "purchase",
            })),
          );

        return Response.json([
          {
            id: 90,
            product_id: 7,
            amount: Number(body.amount),
            transaction_id: "purchase-transaction",
            stock_id: "purchase-stock",
            transaction_type: "purchase",
          },
        ]);
      }

      if (
        path.endsWith("/api/userfields/stock/purchase-transaction") &&
        failField &&
        ++fieldWrites === 1
      )
        return Response.json({ error_message: "Batch unavailable" }, { status: 503 });

      return Response.json({});
    }

    if (path.endsWith("/api/v2/setup")) return Response.json({ needs_setup: false });

    if (path.endsWith("/api/user")) return Response.json([{ id: 1, username: "Owner" }]);

    if (path.endsWith("/api/user/settings"))
      return Response.json({
        stock_decimal_places_amounts: 2,
        stock_default_purchase_amount: 2,
        stock_decimal_places_prices_input: 3,
        stock_decimal_places_prices_display: 2,
        show_purchased_date_on_purchase: true,
        scan_mode_purchase_enabled: scanEnabled,
      });

    if (path.endsWith("/api/system/config"))
      return Response.json({
        FEATURE_FLAG_STOCK: true,
        FEATURE_FLAG_STOCK_PRICE_TRACKING: tracking,
        FEATURE_FLAG_STOCK_LOCATION_TRACKING: tracking,
        FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: tracking,
        FEATURE_FLAG_LABEL_PRINTER: labels,
        LABEL_PRINTER_RUN_SERVER: serverLabels,
        LABEL_PRINTER_WEBHOOK: "https://printer.example.test/labels",
        FEATURE_FLAG_DISABLE_BROWSER_BARCODE_CAMERA_SCANNING: true,
      });

    if (path.endsWith("/api/stock/transactions/purchase-transaction"))
      return Response.json([{ stock_id: "one" }, { stock_id: "two" }]);

    if (path.endsWith("/printlabel"))
      return Response.json({
        product: "Coffee",
        grocycode: `grcy:p:7:${path.includes("/one/") ? "one" : "two"}`,
      });

    if (path.endsWith("/api/v2/stock/purchase/editor"))
      return Response.json({
        barcode_lookup_plugin_name: "Demo",
        products: [
          { id: 7, name: "Coffee" },
          { id: 8, name: "Tare coffee" },
        ],
        locations: [
          { id: 1, name: "Shelf", is_freezer: 0 },
          { id: 2, name: "Freezer", is_freezer: 1 },
        ],
        stores: [
          { id: 1, name: "Market" },
          { id: 2, name: "Roaster" },
        ],
        units: [{ id: 1, name: "Piece", name_plural: "Pieces" }],
        barcodes: [{ product_id: 7, barcodes: "COFFEE-2" }],
        fields,
        conversions: [7, 8].flatMap((product_id) => [
          {
            product_id,
            from_qu_id: 1,
            to_qu_id: 1,
            factor: "99",
            to_qu_name: "Piece",
            to_qu_name_plural: "Pieces",
          },
          {
            product_id,
            from_qu_id: 1,
            to_qu_id: 3,
            factor: "0.125",
            to_qu_name: "Saved box",
            to_qu_name_plural: "Saved boxes",
          },
        ]),
      });

    if (path.includes("/shopping-lists/")) return Response.json({ items: [] });

    if (/\/api\/stock\/products\/[78]$/.test(path)) {
      if (failRead && ++reads === 1)
        return Response.json({ error_message: "Details unavailable" }, { status: 503 });
      const tare = path.endsWith("/8");

      return Response.json({
        ...productOverview,
        product: {
          ...productOverview.product,
          id: tare ? 8 : 7,
          name: tare ? "Tare coffee" : "Coffee",
          description: null,
          enable_tare_weight_handling: tare ? 1 : 0,
          tare_weight: 3,
          default_best_before_days: 5,
          default_best_before_days_after_freezing: -1,
          default_purchase_price_type: 3,
          default_stock_label_type: 0,
        },
        stock_amount: 5,
        quantity_unit_stock: {
          ...productOverview.quantity_unit_stock,
          id: 1,
          name: "Piece",
          name_plural: "Pieces",
        },
        default_quantity_unit_purchase: { id: 3, name: "Box", name_plural: "Boxes" },
        location: { id: 1, name: "Shelf", is_freezer: 0 },
        last_price: 1,
        last_shopping_location_id: 1,
        default_shopping_location_id: null,
        next_due_date: "2999-12-31",
      });
    }

    if (path.endsWith("/api/objects/product_barcodes_view"))
      return Response.json(
        url.search.includes("COFFEE-2")
          ? [
              {
                id: 77,
                amount: 1.5,
                qu_id: 3,
                shopping_location_id: 2,
                last_price: 9,
                note: "Barcode note",
              },
            ]
          : [],
      );

    return Response.json([]);
  });

  vi.stubGlobal("fetch", fetchData);

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

  return { writes, router };
}

test("purchase uses cached units, saves custom fields, resets, and undoes", async () => {
  const { writes } = mount("/purchase", { custom: true });
  fireEvent.change(await screen.findByLabelText("Product"), { target: { value: "Coffee" } });
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.disabled).toBe(false));
  expect(amount.value).toBe("2");
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("3");
  expect(screen.getByRole("option", { name: "Saved box" })).toBeTruthy();
  expect(screen.getByText("This equals 16 Pieces")).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>("Price").value).toBe("8.00");
  expect(screen.getByLabelText<HTMLInputElement>("Due date").value).toBe(isoDay(5));
  await waitFor(() => expect(document.activeElement).toBe(amount));
  await userEvent.type(screen.getByLabelText("Batch"), "Lot one");
  fireEvent.change(screen.getByLabelText("Price"), { target: { value: "4" } });
  expect(screen.getByText("means 0.25 per Piece")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Purchased date"), { target: { value: "2026-10-01" } });
  await userEvent.type(screen.getByLabelText("Note"), "Weekly purchase");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe(""));
  const bookings = writes.filter((row) => row.path.endsWith("/add"));
  expect(bookings).toHaveLength(1);
  expect(bookings[0]?.body).toEqual({
    amount: "16.",
    price: "0.250",
    purchased_date: "2026-10-01",
    best_before_date: isoDay(5),
    location_id: "1",
    shopping_location_id: "1",
    note: "Weekly purchase",
  });
  expect(writes.filter((row) => row.path.includes("/userfields/"))).toHaveLength(1);
  expect(writes.find((row) => row.path.includes("/userfields/"))?.body).toEqual({
    batch: "Lot one",
  });
  expect(amount.value).toBe("2");
  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(writes.some((row) => row.path.endsWith("/transactions/purchase-transaction/undo"))).toBe(
      true,
    ),
  );
});

test("a failed custom-field save retains the booked stock and locks the purchase form", async () => {
  const { writes } = mount("/purchase?embedded&product=7", { custom: true, failField: true });
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  await userEvent.type(screen.getByLabelText("Batch"), "Lot one");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Batch unavailable");
  expect(amount.matches(":disabled")).toBe(true);
  const save = screen.getByRole<HTMLButtonElement>("button", { name: "OK" });
  expect(save.disabled).toBe(true);
  await userEvent.click(save);
  expect(writes.filter((row) => row.path.endsWith("/add"))).toHaveLength(1);
  expect(writes.filter((row) => row.path.includes("/userfields/"))).toHaveLength(1);
});

test("a full-page product bookmark retains the native uninitialized purchase fields", async () => {
  mount("/purchase?product=7");
  await screen.findByRole("region", { name: "Price history" });
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("Coffee");
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("");
  expect(screen.getByLabelText<HTMLInputElement>("Due date").value).toBe("");
  await userEvent.type(screen.getByLabelText("Product"), "{Enter}");
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("3"),
  );
});

test("barcode values fill purchase amount, price, store and note and save the barcode price", async () => {
  const { writes } = mount("/purchase?embedded");
  const product = await screen.findByLabelText("Product");
  fireEvent.change(product, { target: { value: "COFFEE-2" } });
  await userEvent.type(product, "{Enter}");
  const amount = screen.getByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.value).toBe("1.5"));
  expect(screen.getByLabelText<HTMLSelectElement>("Store").value).toBe("2");
  expect(screen.getByLabelText<HTMLInputElement>("Note").value).toBe("Barcode note");
  expect(screen.getByLabelText<HTMLInputElement>("Price").value).toBe("9");
  await userEvent.selectOptions(screen.getByLabelText("Location"), "2");
  expect(screen.getByLabelText<HTMLInputElement>("Due date").readOnly).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(writes.some((row) => row.path.endsWith("/product_barcodes/77"))).toBe(true),
  );
  expect(writes.find((row) => row.path.endsWith("/add"))?.body).toMatchObject({
    amount: "12.",
    price: "0.750",
    best_before_date: "2999-12-31",
    shopping_location_id: "2",
    note: "Barcode note",
  });
  expect(writes.find((row) => row.path.endsWith("/product_barcodes/77"))?.body).toEqual({
    last_price: "9",
  });
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Product").disabled).toBe(true),
  );
});

test("tare purchases retain gross weight and disabled tracking save rules through retry", async () => {
  const { writes } = mount("/purchase?embedded&product=8", {
    tracking: false,
    failRead: true,
    failSave: true,
  });

  await screen.findByText("Details unavailable");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  const amount = screen.getByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.disabled).toBe(false));
  expect(amount.min).toBe("8");
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").disabled).toBe(true);
  fireEvent.change(amount, { target: { value: "15" } });
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Booking unavailable");
  expect(amount.value).toBe("15");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Added 7 Pieces of Tare coffee to stock");
  expect(writes.filter((row) => row.path.endsWith("/add"))).toHaveLength(2);
  expect(writes.at(-1)?.body).toEqual({
    amount: "15.",
    price: 0,
    best_before_date: null,
    note: "",
    purchased_date: isoDay(),
  });
});

test("purchase scan mode saves its setting and books one selected unit", async () => {
  const { writes } = mount("/purchase");
  await screen.findByLabelText("Product");
  await userEvent.click(screen.getByRole("button", { name: "Scan mode off" }));
  await screen.findByRole("button", { name: "Scan mode on" });
  fireEvent.change(screen.getByLabelText("Product"), { target: { value: "Coffee" } });
  await waitFor(() => expect(writes.some((row) => row.path.endsWith("/add"))).toBe(true));
  expect(writes.find((row) => row.path.endsWith("/add"))?.body.amount).toBe("8.");
});

test("embedded purchase disables saved scan mode and waits for an explicit booking", async () => {
  const { writes } = mount("/purchase?embedded&product=7", { scan: true });
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  expect(amount.value).toBe("2");
  expect(writes).toEqual([]);
  expect(screen.queryByRole("button", { name: /Scan mode/ })).toBeNull();
});

test("purchase barcode assignment follows the booking and retains its purchase metadata", async () => {
  const { writes } = mount("/purchase?embedded");
  const product = await screen.findByLabelText("Product");
  fireEvent.change(product, { target: { value: "NEW-COFFEE" } });
  await userEvent.type(product, "{Enter}");
  await userEvent.click(
    await screen.findByRole("button", { name: /Add as barcode to existing product/ }),
  );
  fireEvent.change(product, { target: { value: "Coffee" } });
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Amount").disabled).toBe(false),
  );
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(writes.some((row) => row.path.endsWith("/product_barcodes"))).toBe(true),
  );
  expect(writes.map((row) => row.path)).toEqual([
    "/api/stock/products/7/add",
    "/api/objects/product_barcodes",
  ]);
  expect(writes[1]?.body).toEqual({
    barcode: "NEW-COFFEE",
    product_id: "7",
    qu_id: "3",
    amount: "2",
    note: "",
    shopping_location_id: "1",
  });
});

test("purchase product creation returns through the purchase barcode workflow", async () => {
  const { router } = mount("/purchase?embedded");
  const product = await screen.findByLabelText("Product");
  fireEvent.change(product, { target: { value: "NEW-COFFEE" } });
  await userEvent.type(product, "{Enter}");
  await userEvent.click(
    await screen.findByRole("button", { name: /Add as new product and prefill barcode/ }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe("/product/new"));
  expect(router.state.location.search).toMatchObject({
    flow: "InplaceNewProductWithBarcode",
    barcode: "NEW-COFFEE",
    returnto: "/purchase?embedded&flow=InplaceAddBarcodeToExistingProduct&barcode=NEW-COFFEE",
  });
});

test("a failed barcode assignment permits custom fields and keeps the remaining query values", async () => {
  const { writes, router } = mount(
    "/purchase?product=7&flow=InplaceAddBarcodeToExistingProduct&barcode=NEW-COFFEE&amount=16&quId=3&listitemid=10",
    { custom: true, failBarcode: true },
  );

  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  await userEvent.type(screen.getByLabelText("Batch"), "Lot one");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(writes.some((row) => row.path.includes("/userfields/"))).toBe(true));
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe(""));
  await screen.findByText("Barcode unavailable");
  expect(writes.map((row) => row.path)).toEqual([
    "/api/stock/products/7/add",
    "/api/objects/product_barcodes",
    "/api/userfields/stock/purchase-transaction",
  ]);
  expect(router.state.location.search).toEqual({
    product: "7",
    amount: "16",
    quId: "3",
    listitemid: "10",
  });
});

test.each([true, false])(
  "purchase label-per-unit uses the configured print runtime (%s)",
  async (serverLabels) => {
    const { writes } = mount("/purchase?embedded&product=7", { labels: true, serverLabels });
    const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
    await waitFor(() => expect(amount.disabled).toBe(false));
    fireEvent.change(amount, { target: { value: "0.25" } });
    await userEvent.selectOptions(screen.getByLabelText("Stock entry label"), "2");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>("Product").disabled).toBe(true),
    );
    expect(writes.find((row) => row.path.endsWith("/add"))?.body).toMatchObject({
      amount: "2.",
      stock_label_type: "2",
    });
    const prints = writes.filter((row) => row.path === "/labels");
    expect(prints.map((row) => row.body.grocycode)).toEqual(
      serverLabels ? [] : ["grcy:p:7:one", "grcy:p:7:two"],
    );
  },
);

test("untouched optional stock fields retain their native unsaved state", async () => {
  const { writes } = mount("/purchase?embedded&product=7", { custom: true, customRequired: false });
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.disabled).toBe(false));
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Product").disabled).toBe(true),
  );
  expect(writes.map((row) => row.path)).toEqual(["/api/stock/products/7/add"]);
});
