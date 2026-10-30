import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import { isoDay } from "@/lib/format";
import type { JsonObject } from "@/lib/json";
import { productOverview } from "./fixtures/product-overview";
import { supportDialogs } from "./fixtures/dialogs";

beforeEach(supportDialogs);

function mount(
  path = "/inventory",
  {
    tracking = true,
    custom = false,
    failField = false,
    failSave = false,
    failRead = false,
    labels = false,
    serverLabels = true,
    inventoryAllowed = true,
    stockEnabled = true,
  } = {},
) {
  const writes: { path: string; body: JsonObject }[] = [];
  let stock = 10;
  let previous = stock;
  let saves = 0;
  let fieldWrites = 0;
  let reads = 0;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;

    if (init?.method === "POST" || init?.method === "PUT") {
      const body = JSON.parse(String(init.body ?? "{}"));
      writes.push({ path, body });

      if (path.endsWith("/inventory")) {
        if (failSave && ++saves === 1)
          return Response.json({ error_message: "Count unavailable" }, { status: 503 });
        previous = stock;
        stock = Number(body.new_amount) - (path.endsWith("/8/inventory") ? 3 : 0);

        return Response.json([
          {
            id: 90,
            product_id: path.endsWith("/8/inventory") ? 8 : 7,
            amount: stock - previous,
            stock_id: "inventory-stock",
            transaction_id: "inventory-transaction",
            transaction_type: "inventory-correction",
          },
        ]);
      }

      if (path.endsWith("/inventory-transaction/undo")) stock = previous;

      if (
        path.endsWith("/userfields/stock/inventory-transaction") &&
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
        stock_decimal_places_prices_input: 3,
        stock_decimal_places_prices_display: 2,
        show_purchased_date_on_purchase: true,
      });

    if (path.endsWith("/api/system/config"))
      return Response.json({
        FEATURE_FLAG_STOCK: stockEnabled,
        FEATURE_FLAG_LABEL_PRINTER: labels,
        LABEL_PRINTER_RUN_SERVER: serverLabels,
        LABEL_PRINTER_WEBHOOK: "https://printer.example.test/labels",
        FEATURE_FLAG_STOCK_PRICE_TRACKING: tracking,
        FEATURE_FLAG_STOCK_LOCATION_TRACKING: tracking,
        FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: tracking,
        FEATURE_FLAG_DISABLE_BROWSER_BARCODE_CAMERA_SCANNING: true,
      });

    if (path.endsWith("/api/v2/stock/inventory/editor"))
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
        fields: custom
          ? [
              {
                id: 1,
                name: "batch",
                caption: "Batch",
                type: "text-single-line",
                input_required: 1,
                default_value: null,
                config: null,
              },
            ]
          : [],
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

    if (path.endsWith("/api/v2/user/permissions"))
      return Response.json({ STOCK_INVENTORY: inventoryAllowed });

    if (path.endsWith("/api/objects/products"))
      return Response.json([{ ...productOverview.product, id: 7, name: "Coffee" }]);

    if (path.endsWith("/api/objects/quantity_units"))
      return Response.json([{ id: 1, name: "Piece", name_plural: "Pieces" }]);

    if (path.endsWith("/api/objects/locations"))
      return Response.json([{ id: 1, name: "Shelf", is_freezer: 0 }]);

    if (path.endsWith("/api/stock"))
      return Response.json([
        {
          product_id: 7,
          product: { ...productOverview.product, id: 7, name: "Coffee" },
          amount: stock,
          amount_aggregated: stock,
          amount_opened: 0,
          amount_opened_aggregated: 0,
          is_aggregated_amount: false,
        },
      ]);

    if (path.endsWith("/api/stock/transactions/inventory-transaction"))
      return Response.json([{ stock_id: "one" }, { stock_id: "two" }]);

    if (path.endsWith("/printlabel"))
      return Response.json({
        product: "Coffee",
        grocycode: `grcy:p:7:${path.includes("/one/") ? "one" : "two"}`,
      });

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
          enable_tare_weight_handling: tare ? 1 : 0,
          tare_weight: 3,
          default_best_before_days: 5,
          default_stock_label_type: 0,
        },
        stock_amount: stock,
        quantity_unit_stock: { id: 1, name: "Piece", name_plural: "Pieces" },
        location: { id: 1, name: "Shelf", is_freezer: 0 },
        last_price: 1,
        last_shopping_location_id: 1,
      });
    }

    if (path.endsWith("/api/objects/product_barcodes_view"))
      return Response.json(
        url.search.includes("COFFEE-2")
          ? [
              {
                id: 77,
                amount: 2,
                qu_id: 3,
                note: "Barcode note",
                shopping_location_id: 2,
                last_price: 9,
              },
            ]
          : [],
      );

    if (path.includes("/shopping-lists/")) return Response.json({ items: [] });

    return Response.json([]);
  });

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

  return { writes, router, stock: () => stock };
}

async function choose(value = "Coffee") {
  const picker = await screen.findByLabelText("Product");
  fireEvent.change(picker, { target: { value } });
  fireEvent.keyDown(picker, { key: "Enter" });
  const amount = screen.getByLabelText<HTMLInputElement>("New stock amount");
  await waitFor(() => expect(amount.disabled).toBe(false));

  return amount;
}

test.each(["name", "barcode"])(
  "inventory books the converted total from a %s, resets, and supports Undo",
  async (source) => {
    const { writes, stock } = mount();
    const amount = await choose(source === "barcode" ? "COFFEE-2" : "Coffee");
    expect(amount.value).toBe(source === "barcode" ? "2" : "10");
    expect(amount.min).toBe("0");
    expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe(
      source === "barcode" ? "3" : "1",
    );
    expect(screen.getByLabelText<HTMLSelectElement>("Store").value).toBe("1");
    expect(screen.getByLabelText<HTMLInputElement>("Price").value).toBe("1.00");

    if (source === "barcode")
      expect(screen.getByLabelText<HTMLInputElement>("Note").value).toBe("Barcode note");
    fireEvent.change(screen.getByLabelText("Quantity unit"), { target: { value: "3" } });
    fireEvent.change(amount, { target: { value: "2" } });
    await screen.findByText("This means 6 Pieces will be added to stock");
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2030-01-02" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Counted today" } });
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Stock amount of Coffee is now 16 Pieces");
    expect(writes[0]).toEqual({
      path: "/api/stock/products/7/inventory",
      body: {
        new_amount: "16.",
        best_before_date: "2030-01-02",
        purchased_date: isoDay(),
        price: "0.125",
        shopping_location_id: "1",
        location_id: "1",
        note: "Counted today",
      },
    });
    expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("New stock amount").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("Purchased date").value).toBe(isoDay());
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(stock()).toBe(10));
  },
);

test.each([
  { product: "Coffee", count: "0", gross: "0.", final: 0, removed: 10, minimum: "0" },
  { product: "Tare coffee", count: "8", gross: "8.", final: 5, removed: 5, minimum: "3" },
])(
  "inventory counts $product down to $final with the native location and due-date guards",
  async ({ product, count, gross, final, removed, minimum }) => {
    const { writes, stock } = mount();
    const amount = await choose(product);
    const due = screen.getByLabelText<HTMLInputElement>("Due date");
    const location = screen.getByLabelText<HTMLSelectElement>("Location");
    expect(amount.min).toBe(minimum);
    expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").disabled).toBe(false);
    fireEvent.change(due, { target: { value: "" } });
    fireEvent.change(location, { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "" } });

    if (product === "Coffee") {
      fireEvent.change(amount, { target: { value: "11" } });
      await screen.findByText("This means 1 Piece will be added to stock");
      expect(due.required).toBe(true);
      expect(location.required).toBe(true);
      fireEvent.submit(screen.getByRole("form", { name: "Inventory" }));
      expect(writes).toEqual([]);
    }

    fireEvent.change(amount, { target: { value: count } });
    await screen.findByText(`This means ${removed} Pieces will be removed from stock`);
    expect(due.required).toBe(false);
    expect(location.required).toBe(true);
    fireEvent.submit(screen.getByRole("form", { name: "Inventory" }));
    expect(writes).toEqual([]);
    fireEvent.change(location, { target: { value: "1" } });
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText(`Stock amount of ${product} is now ${final} Pieces`);
    expect(stock()).toBe(final);
    expect(writes[0]?.body).toEqual({
      new_amount: gross,
      best_before_date: "",
      price: "",
      note: "",
      purchased_date: isoDay(),
      shopping_location_id: "1",
      location_id: "1",
    });
  },
);

test("inventory retains the native unchanged-count, minimum, and precision guards", async () => {
  const { writes } = mount();
  const amount = await choose();

  for (const value of ["10", "-1", "1.001"]) {
    fireEvent.change(amount, { target: { value } });
    expect(amount.checkValidity()).toBe(false);
    fireEvent.submit(screen.getByRole("form", { name: "Inventory" }));
  }

  expect(writes).toEqual([]);
});

test("inventory uses the native request values when tracking fields are disabled", async () => {
  const { writes } = mount("/inventory", { tracking: false });
  const amount = await choose();
  fireEvent.change(amount, { target: { value: "1011" } });
  await screen.findByText("This means 1,001 Pieces will be added to stock");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock amount of Coffee is now 1011 Pieces");
  expect(writes[0]?.body).toEqual({
    new_amount: "1011.",
    best_before_date: "",
    price: "0.000",
    note: "",
    purchased_date: isoDay(),
  });
});

test("inventory retries a failed custom field write without repeating the saved count", async () => {
  const { writes } = mount("/inventory", { custom: true, failField: true });
  const amount = await choose();
  fireEvent.change(amount, { target: { value: "12" } });
  await screen.findByText("This means 2 Pieces will be added to stock");
  fireEvent.submit(screen.getByRole("form", { name: "Inventory" }));
  expect(writes).toEqual([]);
  fireEvent.change(screen.getByLabelText("Batch"), { target: { value: "Count-1" } });
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Batch unavailable");
  expect(screen.getByText("Stock entry saved.")).toBeTruthy();
  await userEvent.click(
    within(screen.getByRole("form", { name: "Inventory" })).getByRole("button", { name: "Retry" }),
  );
  await screen.findByText("Stock amount of Coffee is now 12 Pieces");
  expect(writes.filter((row) => row.path.endsWith("/inventory"))).toHaveLength(1);
  expect(
    writes
      .filter((row) => row.path.endsWith("/userfields/stock/inventory-transaction"))
      .map((row) => row.body),
  ).toEqual([{ batch: "Count-1" }, { batch: "Count-1" }]);
});

test("inventory retains input for a failed booking and permits a retry", async () => {
  const { writes } = mount("/inventory", { failSave: true });
  const amount = await choose();
  fireEvent.change(amount, { target: { value: "9" } });
  await screen.findByText("This means 1 Piece will be removed from stock");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Count unavailable");
  expect(amount.value).toBe("9");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock amount of Coffee is now 9 Pieces");
  expect(writes.filter((row) => row.path.endsWith("/inventory"))).toHaveLength(2);
});

test("inventory permits a new details read after its first read fails", async () => {
  mount("/inventory", { failRead: true });
  await choose();
  await screen.findByText("Details unavailable");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("New stock amount").value).toBe("10"),
  );
});

test.each([false, true])(
  "inventory retains native product-link initialization (embedded=%s)",
  async (embedded) => {
    const { writes } = mount(`/inventory?product=7${embedded ? "&embedded" : ""}`);
    const amount = await screen.findByLabelText<HTMLInputElement>("New stock amount");

    if (embedded) await waitFor(() => expect(amount.value).toBe("10"));
    else {
      expect(amount.value).toBe("");
      fireEvent.submit(screen.getByRole("form", { name: "Inventory" }));
      expect(writes).toEqual([]);
      await choose();
    }

    fireEvent.change(amount, { target: { value: "9" } });
    await screen.findByText("This means 1 Piece will be removed from stock");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Stock amount of Coffee is now 9 Pieces");
    expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe(embedded ? "Coffee" : "");
  },
);

test("inventory barcode assignment writes inventory metadata and ends the full-page flow", async () => {
  const { writes, router } = mount(
    "/inventory?product=7&flow=InplaceAddBarcodeToExistingProduct&barcode=NEW-CODE",
  );

  const amount = await screen.findByLabelText<HTMLInputElement>("New stock amount");
  await waitFor(() => expect(amount.value).toBe("10"));
  fireEvent.change(amount, { target: { value: "9" } });
  fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Count note" } });
  await screen.findByText("This means 1 Piece will be removed from stock");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock amount of Coffee is now 9 Pieces");
  expect(writes.find((row) => row.path.endsWith("/objects/product_barcodes"))?.body).toEqual({
    barcode: "NEW-CODE",
    product_id: "7",
    note: "Count note",
    shopping_location_id: "1",
  });
  await waitFor(() => expect(router.state.location.search).toEqual({}));
});

test.each([
  { count: "12", serverLabels: false, prints: ["grcy:p:7:one", "grcy:p:7:two"] },
  { count: "12", serverLabels: true, prints: [] },
  { count: "9", serverLabels: false, prints: [] },
])(
  "inventory label-per-unit follows the count and print runtime ($count, $serverLabels)",
  async ({ count, serverLabels, prints }) => {
    const { writes } = mount("/inventory?embedded&product=7", { labels: true, serverLabels });
    const amount = await screen.findByLabelText<HTMLInputElement>("New stock amount");
    await waitFor(() => expect(amount.value).toBe("10"));
    fireEvent.change(amount, { target: { value: count } });
    await screen.findByText(
      count === "12"
        ? "This means 2 Pieces will be added to stock"
        : "This means 1 Piece will be removed from stock",
    );
    await userEvent.selectOptions(screen.getByLabelText("Stock entry label"), "2");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText(`Stock amount of Coffee is now ${count} Pieces`);
    expect(writes.find((row) => row.path.endsWith("/inventory"))?.body.stock_label_type).toBe("2");
    expect(writes.filter((row) => row.path === "/labels").map((row) => row.body.grocycode)).toEqual(
      prints,
    );
  },
);

test("the stock inventory dialog keeps filters and focus and completes a count", async () => {
  const { writes } = mount("/stock");

  const trigger = await screen.findByRole<HTMLButtonElement>("button", {
    name: "Inventory Coffee",
  });

  await waitFor(() => expect(trigger.disabled).toBe(false));
  const search = screen.getByRole<HTMLInputElement>("searchbox", { name: "Search stock" });
  await userEvent.type(search, "Coffee");
  await userEvent.click(trigger);
  await screen.findByRole("dialog", { name: "Inventory" });
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("New stock amount").value).toBe("10"),
  );
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(document.activeElement).toBe(trigger);
  expect(search.value).toBe("Coffee");
  expect(writes).toEqual([]);
  await userEvent.click(trigger);
  const amount = await screen.findByLabelText<HTMLInputElement>("New stock amount");
  await waitFor(() => expect(amount.value).toBe("10"));
  fireEvent.change(amount, { target: { value: "9" } });
  await screen.findByText("This means 1 Piece will be removed from stock");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Inventory" })).toBeNull());
  expect(writes.map((row) => row.path)).toEqual(["/api/stock/products/7/inventory"]);
});

test("inventory row actions use the inventory permission", async () => {
  mount("/stock", { inventoryAllowed: false });

  const trigger = await screen.findByRole<HTMLButtonElement>("button", {
    name: "Inventory Coffee",
  });

  expect(trigger.disabled).toBe(true);
});

test("the stock feature flag controls the inventory route and navigation", async () => {
  const { writes } = mount("/inventory", { stockEnabled: false });
  await screen.findByRole("heading", { name: "Feature disabled" });
  expect(
    within(screen.getByRole("navigation", { name: "Primary" })).queryByRole("link", {
      name: "Inventory",
    }),
  ).toBeNull();
  expect(writes).toEqual([]);
});

test("inventory books relative due dates and compact purchase dates without moving focus", async () => {
  const { writes } = mount();
  const amount = await choose();
  await waitFor(() => expect(document.activeElement).toBe(amount));
  fireEvent.change(amount, { target: { value: "12" } });
  await screen.findByText("This means 2 Pieces will be added to stock");
  const due = screen.getByLabelText<HTMLInputElement>("Due date");
  await userEvent.clear(due);
  await userEvent.type(due, "+2d");
  expect(due.value).toBe(isoDay(2));
  expect(document.activeElement).toBe(due);
  const purchased = screen.getByLabelText<HTMLInputElement>("Purchased date");
  await userEvent.clear(purchased);
  await userEvent.type(purchased, "20320229");
  expect(purchased.value).toBe("2032-02-29");
  expect(document.activeElement).toBe(purchased);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock amount of Coffee is now 12 Pieces");
  expect(writes.find((row) => row.path.endsWith("/inventory"))?.body).toMatchObject({
    best_before_date: isoDay(2),
    purchased_date: "2032-02-29",
  });
});
