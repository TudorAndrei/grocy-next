import { overviewFixture } from "./fixtures/stock-overview";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import { isoDay } from "@/lib/format";
import type { JsonObject } from "@/lib/json";
import type { UserfieldDefinition } from "@/lib/userfields";
import { productOverview } from "./fixtures/product-overview";
import { supportDialogs } from "./fixtures/dialogs";

beforeEach(() => {
  supportDialogs();
  vi.stubGlobal("scrollTo", () => {});
});

function mount(
  path = "/inventory",
  {
    tracking = true,
    prices = tracking,
    priceInputPrecision = 3,
    priceDisplayPrecision = 2,
    lastPrice = 1,
    custom = false,
    failField = false,
    failSave = false,
    failRead = false,
    labels = false,
    serverLabels = true,
    inventoryAllowed = true,
    stockEnabled = true,
    dates = tracking,
    transaction,
    webhook,
    booking,
    afterBookingName,
    multipleBookings = false,
    definitions,
    fieldReply,
    receipt,
    failReceipt = false,
    uploadReply,
    clearReply,
    failBarcode = false,
    receiptReply,
    deleteReply,
    barcodeReply,
    barcodeLookupReply,
    purchasedSetting = true,
  }: {
    tracking?: boolean;
    prices?: boolean;
    priceInputPrecision?: number;
    priceDisplayPrecision?: number;
    lastPrice?: number;
    custom?: boolean;
    failField?: boolean;
    failSave?: boolean;
    failRead?: boolean;
    labels?: boolean;
    serverLabels?: boolean;
    inventoryAllowed?: boolean;
    stockEnabled?: boolean;
    dates?: boolean;
    transaction?: Promise<Response>;
    webhook?: Promise<Response>;
    booking?: Promise<unknown>;
    afterBookingName?: string;
    multipleBookings?: boolean;
    definitions?: UserfieldDefinition[];
    fieldReply?: (body: JsonObject) => Response | Promise<Response>;
    receipt?: Promise<Response>;
    failReceipt?: boolean;
    uploadReply?: Response | Promise<Response>;
    clearReply?: Promise<Response>;
    failBarcode?: boolean;
    receiptReply?: (index: number) => Response | Promise<Response>;
    deleteReply?: Response | Promise<Response>;
    barcodeReply?: Promise<Response>;
    barcodeLookupReply?: Promise<Response>;
    purchasedSetting?: string | boolean;
  } = {},
) {
  const writes: { path: string; body: JsonObject }[] = [];
  let stock = 10;
  let previous = stock;
  let saves = 0;
  let fieldWrites = 0;
  let reads = 0;
  let selectionReadFailed = false;
  let transactionReads = 0;
  let labelReads = 0;
  let name = "Coffee";
  let bookingCount = 0;
  let awaitingReceipt = false;
  let receiptReads = 0;
  let clearReads = 0;
  const uploads: { path: string; body: BodyInit | null | undefined }[] = [];
  const deletions: string[] = [];

  const customFields =
    definitions ??
    (custom
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
      : []);

  let nextDetails: Promise<Response> | undefined;
  const transactionSignals: (AbortSignal | null | undefined)[] = [];
  const webhookSignals: (AbortSignal | null | undefined)[] = [];

  function detailsResponse(
    overrides: { stock?: number; name?: string; unit?: { name: string; name_plural: string } } = {},
    tare = false,
  ) {
    return Response.json({
      ...productOverview,
      product: {
        ...productOverview.product,
        id: tare ? 8 : 7,
        name: overrides.name ?? (tare ? "Tare coffee" : name),
        enable_tare_weight_handling: tare ? 1 : 0,
        tare_weight: 3,
        default_best_before_days: 5,
        default_stock_label_type: 0,
      },
      stock_amount: overrides.stock ?? stock,
      quantity_unit_stock: {
        id: 1,
        ...(overrides.unit ?? { name: "Piece", name_plural: "Pieces" }),
      },
      location: { id: 1, name: "Shelf", is_freezer: 0 },
      last_price: lastPrice,
      last_shopping_location_id: 1,
    });
  }

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;

    if (path.includes("/api/user/settings/")) return Response.json({});

    if (path.startsWith("/api/files/userfiles/") && init?.method === "DELETE") {
      deletions.push(path);

      return deleteReply ? await deleteReply : Response.json({});
    }

    if (path.startsWith("/api/files/userfiles/") && init?.method === "PUT") {
      uploads.push({ path, body: init.body });

      return uploadReply ? await uploadReply : Response.json({});
    }

    if (
      path === "/api/objects/userfields" &&
      url.searchParams.getAll("query[]").includes("entity=stock")
    ) {
      if (bookingCount === 0) return Response.json(customFields);
      clearReads++;

      return clearReply ? (await clearReply).clone() : Response.json(customFields);
    }

    if (init?.method === "POST" || init?.method === "PUT") {
      const body = JSON.parse(String(init.body ?? "{}"));
      writes.push({ path, body });

      if (path === "/api/objects/product_barcodes" && barcodeReply) return await barcodeReply;

      if (path === "/api/objects/product_barcodes" && failBarcode)
        return Response.json({ error_message: "Barcode already assigned" }, { status: 409 });

      if (url.origin === "https://printer.example.test") {
        webhookSignals.push(init.signal);

        return webhook ? await webhook : Response.json({});
      }

      if (path.endsWith("/inventory")) {
        if (Number(body.new_amount) === stock + (path.endsWith("/8/inventory") ? 3 : 0))
          return Response.json(
            { error_message: "The new amount cannot equal the current stock amount" },
            { status: 400 },
          );

        if (failSave && ++saves === 1)
          return Response.json({ error_message: "Count unavailable" }, { status: 503 });
        previous = stock;
        stock = Number(body.new_amount) - (path.endsWith("/8/inventory") ? 3 : 0);

        if (booking) await booking;

        if (afterBookingName) name = afterBookingName;
        bookingCount++;
        awaitingReceipt = true;

        const transactionId =
          bookingCount === 1 ? "inventory-transaction" : `inventory-transaction-${bookingCount}`;

        return Response.json([
          {
            id: 90,
            product_id: path.endsWith("/8/inventory") ? 8 : 7,
            amount: stock - previous,
            stock_id: bookingCount === 1 ? "inventory-stock" : `inventory-stock-${bookingCount}`,
            transaction_id: transactionId,
            transaction_type: "inventory-correction",
            best_before_date: "2030-12-24",
          },
          ...(multipleBookings
            ? [
                {
                  id: 91,
                  product_id: 7,
                  amount: 1,
                  stock_id: "later-booking",
                  transaction_id: transactionId,
                  transaction_type: "inventory-correction",
                  best_before_date: "2040-01-01",
                },
              ]
            : []),
        ]);
      }

      if (path.endsWith("/inventory-transaction/undo")) stock = previous;

      if (path.includes("/userfields/stock/") && fieldReply) return await fieldReply(body);

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

    if (path.endsWith("/api/v2/localization"))
      return Response.json({
        locale: "en",
        direction: "ltr",
        languages: ["en"],
        catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
      });

    if (path.endsWith("/api/user/settings"))
      return Response.json({
        stock_decimal_places_amounts: 2,
        stock_decimal_places_prices_input: priceInputPrecision,
        stock_decimal_places_prices_display: priceDisplayPrecision,
        show_purchased_date_on_purchase: purchasedSetting,
      });

    if (path.endsWith("/api/system/config"))
      return Response.json({
        FEATURE_FLAG_STOCK: stockEnabled,
        FEATURE_FLAG_LABEL_PRINTER: labels,
        LABEL_PRINTER_RUN_SERVER: serverLabels,
        LABEL_PRINTER_WEBHOOK: "https://printer.example.test/labels",
        FEATURE_FLAG_STOCK_PRICE_TRACKING: prices,
        FEATURE_FLAG_STOCK_LOCATION_TRACKING: tracking,
        FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: dates,
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
        fields: customFields,
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

    if (path.endsWith("/api/objects/products")) {
      const name = url.searchParams.getAll("query[]").find((query) => query.startsWith("name="));

      return Response.json(
        name && name !== "name=Coffee"
          ? []
          : [{ ...productOverview.product, id: 7, name: "Coffee" }],
      );
    }

    if (path.endsWith("/api/objects/quantity_units"))
      return Response.json([{ id: 1, name: "Piece", name_plural: "Pieces" }]);

    if (path.endsWith("/api/objects/locations"))
      return Response.json([{ id: 1, name: "Shelf", is_freezer: 0 }]);

    if (path.endsWith("/api/v2/stock/overview"))
      return Response.json(
        overviewFixture([
          {
            product_id: 7,
            product: { ...productOverview.product, id: 7, name: "Coffee" },
            amount: stock,
            amount_aggregated: stock,
            amount_opened: 0,
            amount_opened_aggregated: 0,
            is_aggregated_amount: false,
          },
        ]),
      );

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

    if (path.endsWith("/api/stock/transactions/inventory-transaction")) {
      transactionReads++;
      transactionSignals.push(init?.signal);

      return transaction
        ? await transaction
        : Response.json([{ stock_id: "one" }, { stock_id: "two" }]);
    }

    if (path.endsWith("/printlabel")) {
      labelReads++;

      return Response.json(
        { error_message: "Native inventory must not read entry labels" },
        { status: 503 },
      );
    }

    if (/\/api\/stock\/products\/[78]$/.test(path)) {
      reads++;

      // The card reads the same URL independently; fail the native form's first reader.
      if (failRead && init?.cache === "default" && !selectionReadFailed) {
        selectionReadFailed = true;

        return Response.json({ error_message: "Details unavailable" }, { status: 503 });
      }

      if (awaitingReceipt) {
        awaitingReceipt = false;
        receiptReads++;

        if (receiptReply) return await receiptReply(receiptReads);

        if (failReceipt)
          return Response.json({ error_message: "Receipt unavailable" }, { status: 503 });

        if (receipt) return await receipt;
      }

      const pending = nextDetails;
      nextDetails = undefined;

      return pending ? await pending : detailsResponse({}, path.endsWith("/8"));
    }

    if (path.endsWith("/api/objects/product_barcodes_view")) {
      if (barcodeLookupReply && url.search.includes("COFFEE-2"))
        return (await barcodeLookupReply).clone();

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
    }

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

  return {
    writes,
    router,
    stock: () => stock,
    reads: () => reads,
    transactionReads: () => transactionReads,
    labelReads: () => labelReads,
    receiptReads: () => receiptReads,
    clearReads: () => clearReads,
    uploads,
    deletions,
    transactionSignals,
    webhookSignals,
    detailsResponse,
    holdDetails: (response: Promise<Response>) => {
      nextDetails = response;
    },
    setServer: (value: { stock?: number; name?: string }) => {
      if (value.stock !== undefined) stock = value.stock;

      if (value.name !== undefined) name = value.name;
    },
  };
}

function changeAndKeyup(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.keyUp(input, { key: "Shift" });
}

async function choose(value = "Coffee") {
  const picker = await screen.findByLabelText<HTMLInputElement>("Product");

  if (picker.value === value) fireEvent.change(picker, { target: { value: "" } });
  fireEvent.change(picker, { target: { value } });

  if (value.startsWith("COFFEE-") || value.startsWith("grcy:"))
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
    expect(screen.getByLabelText<HTMLInputElement>("Price").value).toBe("1.000");

    if (source === "barcode")
      expect(screen.getByLabelText<HTMLInputElement>("Note").value).toBe("Barcode note");
    fireEvent.change(screen.getByLabelText("Quantity unit"), { target: { value: "3" } });
    await userEvent.clear(amount);
    await userEvent.type(amount, "2");
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
      changeAndKeyup(amount, "11");
      await screen.findByText("This means 1 Piece will be added to stock");
      expect(due.required).toBe(true);
      expect(location.required).toBe(true);
      fireEvent.submit(screen.getByRole("form", { name: "Inventory" }));
      expect(writes).toEqual([]);
    }

    changeAndKeyup(amount, count);
    await screen.findByText(`This means ${removed} Pieces will be removed from stock`);
    expect(due.required).toBe(false);
    expect(location.required).toBe(false);
    expect(writes).toEqual([]);
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
      location_id: "",
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
  changeAndKeyup(amount, "1011");
  await screen.findByText("This means 1,001 Pieces will be added to stock");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock amount of Coffee is now 1011 Pieces");
  expect(writes[0]?.body).toEqual({
    new_amount: "1011.",
    best_before_date: "",
    price: "1.000",
    note: "",
    purchased_date: isoDay(),
  });
});

test("a final inventory metadata failure silently retains the committed count and keeps the form busy", async () => {
  const app = mount("/inventory", { custom: true, failField: true });
  await prepareLabelsForCount("12");
  fireEvent.change(screen.getByLabelText("Batch"), { target: { value: "Count-1" } });
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(app.writes.some((write) => write.path.includes("/userfields/"))).toBe(true),
  );
  await act(async () => {
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
  });
  expect(app.stock()).toBe(12);
  expect(screen.getByLabelText<HTMLInputElement>("Batch").value).toBe("Count-1");
  expect(screen.getByLabelText<HTMLInputElement>("Batch").matches(":disabled")).toBe(true);
  expect(screen.queryByText("Batch unavailable")).toBeNull();
  expect(screen.queryByText("Stock entry saved.")).toBeNull();
  expect(
    within(screen.getByRole("form", { name: "Inventory" })).queryByRole("button", {
      name: "Retry",
    }),
  ).toBeNull();
  expect(screen.queryByText("Stock amount of Coffee is now 12 Pieces")).toBeNull();
  expect(app.writes.filter((write) => write.path.endsWith("/inventory"))).toHaveLength(1);
});

test.each(["read", "booking"])(
  "inventory %s failure logs and unlocks the draft for a new attempt",
  async (stage) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = mount("/inventory", { failSave: stage === "booking" });
    const amount = await choose();
    changeAndKeyup(amount, "9");
    await screen.findByText("This means 1 Piece will be removed from stock");

    if (stage === "read")
      app.holdDetails(
        Promise.resolve(Response.json({ error_message: "Count unavailable" }, { status: 503 })),
      );
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(errors).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Count unavailable")).toBeNull();
    expect(
      within(screen.getByRole("form", { name: "Inventory" })).queryByRole("button", {
        name: "Retry",
      }),
    ).toBeNull();
    expect(amount.matches(":disabled")).toBe(false);
    expect(amount.value).toBe("9");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Stock amount of Coffee is now 9 Pieces");
    expect(app.writes.filter((row) => row.path.endsWith("/inventory"))).toHaveLength(
      stage === "read" ? 1 : 2,
    );
  },
);

test("inventory selection errors only log and a fresh selection retries without a stock write", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount("/inventory", { failRead: true });
  const picker = await screen.findByLabelText<HTMLInputElement>("Product");
  fireEvent.change(picker, { target: { value: "Coffee" } });
  await waitFor(() => expect(logged).toHaveBeenCalledOnce());
  expect(screen.queryByText("Details unavailable")).toBeNull();
  expect(
    within(screen.getByRole("form", { name: "Inventory" })).queryByRole("button", {
      name: "Retry",
    }),
  ).toBeNull();
  expect(picker.value).toBe("Coffee");
  fireEvent.change(picker, { target: { value: "" } });
  fireEvent.change(picker, { target: { value: "Coffee" } });
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("New stock amount").value).toBe("10"),
  );
  expect(app.writes).toEqual([]);
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

    changeAndKeyup(amount, "9");
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
  changeAndKeyup(amount, "9");
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
    changeAndKeyup(amount, count);
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
  changeAndKeyup(amount, "9");
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

test("native inventory remains readable with stock disabled while its navigation link is hidden", async () => {
  const { writes } = mount("/inventory", { stockEnabled: false });
  const amount = await choose();
  expect(amount.value).toBe("10");
  expect(
    within(screen.getByRole("navigation", { name: "Primary" })).queryByRole("link", {
      name: "Inventory",
    }),
  ).toBeNull();
  expect(writes).toEqual([]);
});

test("inventory retains relative due dates and advances from compact purchased dates before booking", async () => {
  const { writes } = mount();
  const amount = await choose();
  await waitFor(() => expect(document.activeElement).toBe(amount));
  changeAndKeyup(amount, "12");
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
  expect(document.activeElement).toBe(due);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock amount of Coffee is now 12 Pieces");
  expect(writes.find((row) => row.path.endsWith("/inventory"))?.body).toMatchObject({
    best_before_date: isoDay(2),
    purchased_date: "2032-02-29",
  });
});

function heldResponse() {
  let resolve = (_response: Response) => {};

  const promise = new Promise<Response>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

async function releaseInventoryRead(gate: ReturnType<typeof heldResponse>, response: Response) {
  await act(async () => {
    gate.resolve(response);
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
  });
}

async function prepareLabels(label = "2", custom = false) {
  const amount = await choose();
  await waitFor(() => expect(document.activeElement).toBe(amount));
  changeAndKeyup(amount, "12");
  await screen.findByText("This means 2 Pieces will be added to stock");
  await userEvent.selectOptions(screen.getByLabelText("Stock entry label"), label);

  if (custom)
    fireEvent.change(screen.getByLabelText("Batch"), { target: { value: "Count-printed" } });

  return amount;
}

const inventoryEntries = () =>
  Response.json([
    { id: 104, product_id: 99, stock_id: "two", best_before_date: "2041-01-01" },
    { id: 105, product_id: 8, stock_id: "one", best_before_date: "2042-02-02" },
    { id: 104, product_id: 99, stock_id: "two", best_before_date: "2041-01-01" },
  ]);

function printed(app: ReturnType<typeof mount>) {
  return app.writes.filter((write) => write.path === "/labels").map((write) => write.body);
}

test("inventory completes fields and resets before a held per-unit read, retaining the booking snapshot and duplicate entry order", async () => {
  const transaction = heldResponse();

  const app = mount("/inventory", {
    labels: true,
    serverLabels: false,
    custom: true,
    transaction: transaction.promise,
    afterBookingName: "Counted coffee",
    multipleBookings: true,
  });

  await prepareLabels("2", true);
  app.setServer({ name: "Pre-save coffee" });
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock amount of Counted coffee is now 12 Pieces");
  expect(app.transactionReads()).toBe(1);
  expect(app.writes.find((write) => write.path.includes("/userfields/"))?.body).toEqual({
    batch: "Count-printed",
  });
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("");
  expect(screen.getByLabelText<HTMLInputElement>("Batch").value).toBe("");
  expect(printed(app)).toEqual([]);
  const amount = await choose("Tare coffee");
  await waitFor(() => expect(amount.value).toBe("12"));
  fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2050-03-04" } });
  await releaseInventoryRead(transaction, inventoryEntries());
  await waitFor(() => expect(printed(app)).toHaveLength(3));
  expect(printed(app)).toEqual([
    { product: "Pre-save coffee", grocycode: "grcy:p:7:two", due_date: "DD: 2030-12-24" },
    { product: "Pre-save coffee", grocycode: "grcy:p:7:one", due_date: "DD: 2030-12-24" },
    { product: "Pre-save coffee", grocycode: "grcy:p:7:two", due_date: "DD: 2030-12-24" },
  ]);
  expect(app.labelReads()).toBe(0);
  expect(amount.value).toBe("12");
  expect(screen.getByLabelText<HTMLInputElement>("Due date").value).toBe("2050-03-04");
});

test("a failed independent inventory transaction read only logs after the successful count has reset", async () => {
  const transaction = heldResponse();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});

  const app = mount("/inventory", {
    labels: true,
    serverLabels: false,
    transaction: transaction.promise,
  });

  await prepareLabels();
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock amount of Coffee is now 12 Pieces");
  await releaseInventoryRead(
    transaction,
    Response.json({ error_message: "Transaction unavailable" }, { status: 503 }),
  );
  await waitFor(() => expect(errors).toHaveBeenCalledTimes(1));
  expect(printed(app)).toEqual([]);
  expect(screen.queryByText("Transaction unavailable")).toBeNull();
  expect(screen.queryByRole("button", { name: /Error while executing WebHook/ })).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("");
});

test.each([
  { label: "1", serverLabels: false, dates: true, codes: ["inventory-stock"], transactions: 0 },
  { label: "1", serverLabels: false, dates: false, codes: ["inventory-stock"], transactions: 0 },
  { label: "2", serverLabels: false, dates: false, codes: ["one", "two"], transactions: 1 },
  { label: "0", serverLabels: false, dates: true, codes: [], transactions: 0 },
  { label: "2", serverLabels: true, dates: true, codes: [], transactions: 0 },
])(
  "inventory label $label uses the native direct webhook (server=$serverLabels, dates=$dates)",
  async ({ label, serverLabels, dates, codes, transactions }) => {
    const app = mount("/inventory", { labels: true, serverLabels, dates });
    await prepareLabels(label);
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Stock amount of Coffee is now 12 Pieces");
    await waitFor(() => expect(printed(app)).toHaveLength(codes.length));
    expect(printed(app)).toEqual(
      codes.map((stockId) => {
        const payload: JsonObject = { product: "Coffee", grocycode: `grcy:p:7:${stockId}` };

        if (dates) payload.due_date = "DD: 2030-12-24";

        return payload;
      }),
    );
    expect(app.transactionReads()).toBe(transactions);
    expect(app.labelReads()).toBe(0);
  },
);

test.each([
  { count: "12", serverStock: 20, description: "2 Pieces will be added", prints: 1 },
  { count: "9", serverStock: 5, description: "1 Piece will be removed", prints: 0 },
])(
  "inventory printing follows the displayed estimate when save-time stock is $serverStock",
  async ({ count, serverStock, description, prints }) => {
    const app = mount("/inventory", { labels: true, serverLabels: false });
    const amount = await prepareLabels("1");
    changeAndKeyup(amount, count);
    await screen.findByText(`This means ${description} ${prints ? "to" : "from"} stock`);
    app.setServer({ stock: serverStock });
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText(`Stock amount of Coffee is now ${count} Pieces`);
    expect(printed(app)).toHaveLength(prints);
    expect(app.labelReads()).toBe(0);
  },
);

test("an estimate arriving while the count is being saved controls native printing", async () => {
  const estimate = heldResponse();
  let finishBooking = () => {};

  const booking = new Promise<void>((resolve) => {
    finishBooking = resolve;
  });

  const app = mount("/inventory", { labels: true, serverLabels: false, booking });
  const amount = await prepareLabels("1");
  const reads = app.reads();
  app.holdDetails(estimate.promise);
  changeAndKeyup(amount, "14");
  await waitFor(() => expect(app.reads()).toBeGreaterThan(reads));
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(app.writes.some((write) => write.path.endsWith("/inventory"))).toBe(true),
  );
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Saving…" }).disabled).toBe(true);
  await releaseInventoryRead(estimate, app.detailsResponse({ stock: 20 }));
  await screen.findByText("This means 6 Pieces will be removed from stock");
  await act(async () => {
    finishBooking();
  });
  await screen.findByText("Stock amount of Coffee is now 14 Pieces");
  expect(printed(app)).toEqual([]);
  expect(app.labelReads()).toBe(0);
});

test("native inventory estimates apply in response order even when an older amount finishes last", async () => {
  const older = heldResponse();
  const app = mount("/inventory", { labels: true, serverLabels: false });
  const amount = await prepareLabels("1");
  app.holdDetails(older.promise);
  const reads = app.reads();
  changeAndKeyup(amount, "13");
  await waitFor(() => expect(app.reads()).toBeGreaterThan(reads));
  changeAndKeyup(amount, "14");
  await screen.findByText("This means 4 Pieces will be added to stock");
  await releaseInventoryRead(older, app.detailsResponse({ stock: 20 }));
  await screen.findByText("This means 7 Pieces will be removed from stock");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock amount of Coffee is now 14 Pieces");
  expect(printed(app)).toEqual([]);
});

for (const owner of ["page", "dialog"] as const) {
  for (const outcome of ["success", "failure"] as const) {
    test(`inventory ${owner} retirement suppresses a late transaction ${outcome}`, async () => {
      const transaction = heldResponse();
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});

      const app = mount(owner === "page" ? "/inventory" : "/stock", {
        labels: true,
        serverLabels: false,
        transaction: transaction.promise,
      });

      if (owner === "dialog") {
        await userEvent.click(await screen.findByRole("button", { name: "Inventory Coffee" }));
        await waitFor(() =>
          expect(screen.getByLabelText<HTMLInputElement>("New stock amount").value).toBe("10"),
        );
        changeAndKeyup(screen.getByLabelText("New stock amount"), "12");
        await screen.findByText("This means 2 Pieces will be added to stock");
        await userEvent.selectOptions(screen.getByLabelText("Stock entry label"), "2");
      } else await prepareLabels();
      await userEvent.click(screen.getByRole("button", { name: "OK" }));
      await screen.findByText("Stock amount of Coffee is now 12 Pieces");

      if (owner === "dialog")
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Inventory" })).toBeNull());
      else {
        await act(async () => {
          await app.router.navigate({ to: "/stock", search: {} });
        });
        await screen.findByRole("button", { name: "Inventory Coffee" });
      }

      await releaseInventoryRead(
        transaction,
        outcome === "success"
          ? inventoryEntries()
          : Response.json({ error_message: "Retired transaction" }, { status: 503 }),
      );
      expect(printed(app)).toEqual([]);
      expect(errors).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: /Error while executing WebHook/ })).toBeNull();
      expect(app.transactionSignals[0]?.aborted).toBe(true);
    });
  }
}

test.each(["reset", "departure"])(
  "a held inventory webhook failure respects document %s",
  async (owner) => {
    const webhook = heldResponse();

    const app = mount("/inventory", {
      labels: true,
      serverLabels: false,
      webhook: webhook.promise,
    });

    await prepareLabels("1");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Stock amount of Coffee is now 12 Pieces");
    expect(printed(app)).toHaveLength(1);

    if (owner === "departure") {
      await act(async () => {
        await app.router.navigate({ to: "/stock", search: {} });
      });
      await screen.findByRole("button", { name: "Inventory Coffee" });
    }

    await releaseInventoryRead(webhook, new Response("Printer private failure", { status: 503 }));

    if (owner === "reset")
      await screen.findByRole("button", { name: /Error while executing WebHook/ });
    else expect(screen.queryByRole("button", { name: /Error while executing WebHook/ })).toBeNull();
    expect(screen.queryByText("Printer private failure")).toBeNull();
    expect(app.webhookSignals[0]?.aborted).toBe(owner === "departure");
  },
);

test("a superseded inventory estimate retains its response unit and tare rules after another product is selected", async () => {
  const earlier = heldResponse();
  const app = mount();
  const amount = await choose();
  await waitFor(() => expect(document.activeElement).toBe(amount));
  const reads = app.reads();
  app.holdDetails(earlier.promise);
  changeAndKeyup(amount, "1");
  await waitFor(() => expect(app.reads()).toBeGreaterThan(reads));
  await choose("Tare coffee");
  await waitFor(() => expect(amount.min).toBe("3"));
  await screen.findByText("This means 3 Pieces will be removed from stock");
  await releaseInventoryRead(
    earlier,
    app.detailsResponse({ stock: 0, unit: { name: "Earlier unit", name_plural: "Earlier units" } }),
  );
  await screen.findByText("This means 1 Earlier unit will be added to stock");
  expect(screen.getByLabelText<HTMLInputElement>("Due date").required).toBe(true);
  expect(amount.min).toBe("3");
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("Tare coffee");
  expect(
    screen.getByLabelText<HTMLSelectElement>("Quantity unit").selectedOptions[0]?.textContent,
  ).toBe("Piece");
  expect(app.writes).toEqual([]);
});

async function prepareLabelsForCount(count: string) {
  const amount = await choose();
  await waitFor(() => expect(document.activeElement).toBe(amount));
  changeAndKeyup(amount, count);
  await screen.findByText("This means 2 Pieces will be added to stock");

  return amount;
}

function inventoryField(
  id: number,
  name: string,
  caption: string,
  type = "text-single-line",
): UserfieldDefinition {
  return { id, name, caption, type, input_required: 0, default_value: null, config: null };
}

function uploadedText(body: BodyInit | null | undefined) {
  if (!(body instanceof Blob)) throw new Error("Expected uploaded file bytes");

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(body);
  });
}

test.each(["held", "failure"])(
  "the last dirty inventory field completes without waiting for an earlier %s metadata response",
  async (outcome) => {
    const earlier = heldResponse();

    const app = mount("/inventory", {
      definitions: [
        inventoryField(1, "batch", "Batch"),
        inventoryField(2, "checked", "Checked by"),
      ],
      fieldReply: (body) =>
        Object.hasOwn(body, "batch")
          ? outcome === "held"
            ? earlier.promise
            : Response.json({ error_message: "Earlier field rejected" }, { status: 503 })
          : Response.json({}),
    });

    await prepareLabelsForCount("12");
    fireEvent.change(screen.getByLabelText("Batch"), { target: { value: "Earlier" } });
    fireEvent.change(screen.getByLabelText("Checked by"), { target: { value: "Last" } });
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Stock amount of Coffee is now 12 Pieces");
    expect(app.writes.filter((write) => write.path.includes("/userfields/"))).toEqual([
      { path: "/api/userfields/stock/inventory-transaction", body: { batch: "Earlier" } },
      { path: "/api/userfields/stock/inventory-transaction", body: { checked: "Last" } },
    ]);
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Batch").value).toBe(""));
    fireEvent.change(screen.getByLabelText("Batch"), { target: { value: "Next count draft" } });

    if (outcome === "held") await releaseInventoryRead(earlier, Response.json({}));
    expect(screen.getByLabelText<HTMLInputElement>("Batch").value).toBe("Next count draft");
    expect(screen.queryByText("Earlier field rejected")).toBeNull();
    expect(
      within(screen.getByRole("form", { name: "Inventory" })).queryByRole("button", {
        name: "Retry",
      }),
    ).toBeNull();
    expect(app.writes.filter((write) => write.path.endsWith("/inventory"))).toHaveLength(1);
  },
);

test("the final inventory file upload gates completion, reports failure generically and leaves the count committed without Retry", async () => {
  const upload = heldResponse();

  const app = mount("/inventory", {
    definitions: [inventoryField(1, "attachment", "Attachment", "file")],
    uploadReply: upload.promise,
  });

  await prepareLabelsForCount("12");
  await userEvent.upload(
    screen.getByLabelText("Attachment"),
    new File(["count sheet"], "Count sheet.pdf", { type: "application/pdf" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.uploads).toHaveLength(1));
  expect(screen.queryByText("Stock amount of Coffee is now 12 Pieces")).toBeNull();
  expect(await uploadedText(app.uploads[0]!.body)).toBe("count sheet");
  await releaseInventoryRead(
    upload,
    Response.json({ error_message: "Upload rejected" }, { status: 503 }),
  );
  await screen.findByRole("button", {
    name: /Error while saving, probably this item already exists/,
  });
  expect(app.stock()).toBe(12);
  expect(screen.getByLabelText<HTMLInputElement>("Attachment").matches(":disabled")).toBe(true);
  expect(
    within(screen.getByRole("form", { name: "Inventory" })).queryByRole("button", {
      name: "Retry",
    }),
  ).toBeNull();
  expect(app.writes.filter((write) => write.path.endsWith("/inventory"))).toHaveLength(1);
  expect(app.clearReads()).toBe(0);
});

test("receipt-read failure logs silently after a committed inventory count and never starts fields or parent completion messages", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});

  const host = {
    IsGrocy: true,
    postMessage: vi.fn(),
    get parent() {
      return this;
    },
  };

  vi.stubGlobal("parent", host);
  const app = mount("/inventory?embedded&product=7", { custom: true, failReceipt: true });
  const amount = await screen.findByLabelText<HTMLInputElement>("New stock amount");
  await waitFor(() => expect(amount.value).toBe("10"));
  changeAndKeyup(amount, "12");
  await screen.findByText("This means 2 Pieces will be added to stock");
  fireEvent.change(screen.getByLabelText("Batch"), { target: { value: "Committed count" } });
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(errors).toHaveBeenCalledTimes(1));
  expect(app.stock()).toBe(12);
  expect(app.receiptReads()).toBe(1);
  expect(app.writes.filter((write) => write.path.includes("/userfields/"))).toEqual([]);
  expect(amount.matches(":disabled")).toBe(true);
  expect(
    within(screen.getByRole("form", { name: "Inventory" })).queryByRole("button", {
      name: "Retry",
    }),
  ).toBeNull();
  expect(screen.queryByText("Receipt unavailable")).toBeNull();
  expect(
    host.postMessage.mock.calls.filter(([message]) =>
      [
        "BroadcastMessage",
        "ShowSuccessMessage",
        "CloseLastModal",
        "Ready",
        "AfterItemAdded",
      ].includes(message.Message),
    ),
  ).toEqual([]);
});

test("barcode failure unlocks a committed inventory count for a new save while older receipt callbacks use live fields and the latest transaction", async () => {
  const firstReceipt = heldResponse();
  const secondReceipt = heldResponse();

  const host = {
    IsGrocy: true,
    postMessage: vi.fn(),
    get parent() {
      return this;
    },
  };

  vi.stubGlobal("parent", host);

  const app = mount(
    "/inventory?embedded&product=7&flow=InplaceAddBarcodeToExistingProduct&barcode=NEW-CODE",
    {
      custom: true,
      labels: true,
      serverLabels: false,
      failBarcode: true,
      receiptReply: (index) => (index === 1 ? firstReceipt.promise : secondReceipt.promise),
    },
  );

  const amount = await screen.findByLabelText<HTMLInputElement>("New stock amount");
  await waitFor(() => expect(amount.value).toBe("10"));
  await userEvent.clear(amount);
  await userEvent.type(amount, "12");
  await screen.findByText("This means 2 Pieces will be added to stock");
  await userEvent.type(screen.getByLabelText("Batch"), "First batch");
  await userEvent.selectOptions(screen.getByLabelText("Stock entry label"), "1");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.receiptReads()).toBe(1));
  await waitFor(() => expect(amount.matches(":disabled")).toBe(false));
  await screen.findByRole("button", {
    name: /Error while saving, probably this item already exists/,
  });
  expect(app.stock()).toBe(12);
  expect(app.writes.filter((write) => write.path.includes("/userfields/"))).toEqual([]);
  expect(printed(app)).toEqual([
    { product: "Coffee", grocycode: "grcy:p:7:inventory-stock", due_date: "DD: 2030-12-24" },
  ]);

  await userEvent.clear(amount);
  await userEvent.type(amount, "14");
  await screen.findByText("This means 2 Pieces will be added to stock");
  const batch = screen.getByLabelText<HTMLInputElement>("Batch");
  await userEvent.clear(batch);
  await userEvent.type(batch, "Second batch");
  app.setServer({ name: "Second save coffee" });
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.receiptReads()).toBe(2));
  expect(
    app.writes
      .filter((write) => write.path.endsWith("/inventory"))
      .map((write) => write.body.new_amount),
  ).toEqual(["12.", "14."]);
  expect(
    app.writes.filter((write) => write.path.endsWith("/objects/product_barcodes")),
  ).toHaveLength(2);
  expect(printed(app)).toEqual([
    { product: "Coffee", grocycode: "grcy:p:7:inventory-stock", due_date: "DD: 2030-12-24" },
    {
      product: "Second save coffee",
      grocycode: "grcy:p:7:inventory-stock-2",
      due_date: "DD: 2030-12-24",
    },
  ]);
  expect(app.writes.filter((write) => write.path.includes("/userfields/"))).toEqual([]);

  await releaseInventoryRead(
    firstReceipt,
    app.detailsResponse({ stock: 12, name: "First receipt coffee" }),
  );
  await waitFor(() =>
    expect(
      host.postMessage.mock.calls.some(([message]) => message.Message === "CloseLastModal"),
    ).toBe(true),
  );
  expect(app.writes.filter((write) => write.path.includes("/userfields/"))).toEqual([
    { path: "/api/userfields/stock/inventory-transaction-2", body: { batch: "Second batch" } },
  ]);
  expect(screen.queryByText("Stock amount of First receipt coffee is now 12 Pieces")).toBeNull();
  expect(
    host.postMessage.mock.calls.filter(([message]) =>
      [
        "BroadcastMessage",
        "ShowSuccessMessage",
        "CloseLastModal",
        "Ready",
        "AfterItemAdded",
      ].includes(message.Message),
    ),
  ).toEqual([
    [
      { Message: "BroadcastMessage", Payload: { Message: "ProductChanged", Payload: "7" } },
      window.location.origin,
    ],
    [
      {
        Message: "ShowSuccessMessage",
        Payload:
          'Stock amount of First receipt coffee is now 12 Pieces<br><a class="btn btn-secondary btn-sm mt-2" href="#" onclick="UndoStockTransaction(\'inventory-transaction\')"><i class="fa-solid fa-undo"></i> Undo</a>',
      },
      window.location.origin,
    ],
    [{ Message: "CloseLastModal", Payload: null }, window.location.origin],
  ]);

  await releaseInventoryRead(
    secondReceipt,
    app.detailsResponse({ stock: 14, name: "Second receipt coffee" }),
  );
  await waitFor(() =>
    expect(
      host.postMessage.mock.calls.filter(([message]) => message.Message === "CloseLastModal"),
    ).toHaveLength(2),
  );
  expect(app.writes.filter((write) => write.path.includes("/userfields/"))).toEqual([
    { path: "/api/userfields/stock/inventory-transaction-2", body: { batch: "Second batch" } },
    { path: "/api/userfields/stock/inventory-transaction-2", body: { batch: "Second batch" } },
  ]);
  expect(screen.queryByText("Stock amount of Second receipt coffee is now 14 Pieces")).toBeNull();
  expect(app.writes.filter((write) => write.path.endsWith("/inventory"))).toHaveLength(2);
});

test.each([true, false])(
  "two inventory counts retain dirty cleared text and selected files after date Clear (BBD=%s)",
  async (dates) => {
    const clear = heldResponse();

    const definitions = [
      inventoryField(1, "batch", "Batch"),
      { ...inventoryField(2, "attachment", "Attachment", "file"), input_required: 0 },
      inventoryField(3, "after", "After file"),
    ];

    const app = mount("/inventory", { definitions, dates, clearReply: clear.promise });
    await prepareLabelsForCount("12");
    fireEvent.change(screen.getByLabelText("Batch"), { target: { value: "First count" } });
    await userEvent.type(screen.getByLabelText("After file"), "Later text");

    const file = new File(["retained count attachment"], "Count Sheet.PDF", {
      type: "application/pdf",
    });

    const input = screen.getByLabelText<HTMLInputElement>("Attachment");
    await userEvent.upload(input, file);
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Stock amount of Coffee is now 12 Pieces");
    await waitFor(() => expect(app.clearReads()).toBe(1));
    expect(screen.getByLabelText<HTMLInputElement>("Batch").value).toBe("First count");
    expect(screen.getByLabelText<HTMLInputElement>("After file").value).toBe("Later text");

    if (dates) expect(screen.getByLabelText<HTMLInputElement>("Due date").value).toBe("");
    else {
      const hiddenDue = screen.getByLabelText<HTMLInputElement>("Due date");
      expect(hiddenDue.required).toBe(false);
      expect(hiddenDue.closest("[hidden]")).not.toBeNull();
    }

    await releaseInventoryRead(clear, Response.json(definitions));
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Batch").value).toBe(""));
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>("After file").value).toBe(""),
    );
    expect(input.files?.[0]).toBe(file);
    expect(input.required).toBe(false);
    expect(within(input.parentElement!).queryByText("Count Sheet.PDF")).toBeNull();
    expect(
      within(input.parentElement!).getByRole("link", { name: "Show" }).getAttribute("href"),
    ).toBe("/files/userfiles/");
    const amount = await choose();
    await waitFor(() => expect(document.activeElement).toBe(amount));
    changeAndKeyup(amount, "14");
    await screen.findByText("This means 2 Pieces will be added to stock");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Stock amount of Coffee is now 14 Pieces");
    expect(app.writes.filter((write) => write.path.endsWith("/inventory"))).toHaveLength(2);
    const metadata = app.writes.filter((write) => write.path.includes("/userfields/"));
    expect(metadata.filter((write) => Object.hasOwn(write.body, "batch"))).toEqual([
      { path: "/api/userfields/stock/inventory-transaction", body: { batch: "First count" } },
      { path: "/api/userfields/stock/inventory-transaction-2", body: { batch: "" } },
    ]);
    const attachments = metadata.filter((write) => Object.hasOwn(write.body, "attachment"));
    expect(attachments).toHaveLength(2);
    const names = attachments.map((write) => atob(String(write.body.attachment).split("_")[0]!));
    expect(names[0]).not.toBe(names[1]);
    expect(attachments.map((write) => atob(String(write.body.attachment).split("_")[1]!))).toEqual([
      "countsheet.pdf",
      "countsheet.pdf",
    ]);
    expect(app.uploads.map((upload) => atob(upload.path.split("/").at(-1)!))).toEqual(names);
    await waitFor(() => expect(app.uploads).toHaveLength(2));
    expect(await Promise.all(app.uploads.map((upload) => uploadedText(upload.body)))).toEqual([
      "retained count attachment",
      "retained count attachment",
    ]);
    expect(input.files?.[0]).toBe(file);
  },
);

test.each([true, false])(
  "Delete after native Clear keeps the File but sends an empty-file DELETE; only a final file failure blocks completion (fileLast=%s)",
  async (fileLast) => {
    // Make the already-defined empty source binding reachable even on the saved older caller.
    vi.stubGlobal("value", "");
    const batch = inventoryField(1, "batch", "Batch");

    const fileField = {
      ...inventoryField(2, "attachment", "Attachment", "file"),
      input_required: 0,
    };

    const after = inventoryField(3, "after", "After file");
    const definitions = fileLast ? [batch, after, fileField] : [batch, fileField, after];

    const app = mount("/inventory", {
      definitions,
      deleteReply: Response.json(
        { error_message: "Empty file deletion rejected" },
        { status: 503 },
      ),
    });

    await prepareLabelsForCount("12");
    await userEvent.type(screen.getByLabelText("Batch"), "First count");
    await userEvent.type(screen.getByLabelText("After file"), "Last dirty text");
    const input = screen.getByLabelText<HTMLInputElement>("Attachment");
    const file = new File(["retained bytes"], "Retained.pdf", { type: "application/pdf" });
    await userEvent.upload(input, file);
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Stock amount of Coffee is now 12 Pieces");
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>("After file").value).toBe(""),
    );
    await screen.findByText("Show");
    await userEvent.click(within(input.parentElement!).getByRole("button", { name: "Delete" }));
    expect(input.files?.[0]).toBe(file);
    expect(input.required).toBe(false);
    expect(within(input.parentElement!).getByText("No file selected")).toBeTruthy();
    const amount = await choose();
    await waitFor(() => expect(document.activeElement).toBe(amount));
    changeAndKeyup(amount, "14");
    await screen.findByText("This means 2 Pieces will be added to stock");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByRole("button", {
      name: /Error while saving, probably this item already exists/,
    });
    expect(app.deletions).toEqual(["/api/files/userfiles/"]);
    expect(app.uploads).toHaveLength(1);
    expect(await uploadedText(app.uploads[0]!.body)).toBe("retained bytes");
    expect(app.writes.filter((write) => write.path.endsWith("/inventory"))).toHaveLength(2);
    expect(input.files?.[0]).toBe(file);
    expect(
      within(screen.getByRole("form", { name: "Inventory" })).queryByRole("button", {
        name: "Retry",
      }),
    ).toBeNull();

    if (fileLast) {
      expect(screen.queryByText("Stock amount of Coffee is now 14 Pieces")).toBeNull();
      expect(input.matches(":disabled")).toBe(true);
    } else {
      await screen.findByText("Stock amount of Coffee is now 14 Pieces");
      expect(input.matches(":disabled")).toBe(false);
    }
  },
);

test("Inventory date Clear supplies the file value without inventing the separate link data binding", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});

  const app = mount("/inventory", {
    definitions: [
      inventoryField(1, "attachment", "Attachment", "file"),
      inventoryField(2, "reference", "Reference", "link-with-title"),
      inventoryField(3, "after", "After link"),
    ],
  });

  await prepareLabelsForCount("12");
  const input = screen.getByLabelText<HTMLInputElement>("Attachment");
  await userEvent.upload(input, new File(["data"], "One.pdf", { type: "application/pdf" }));
  await userEvent.type(screen.getByLabelText("Title"), "Kept title");
  await userEvent.type(screen.getByLabelText("After link"), "Kept later text");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock amount of Coffee is now 12 Pieces");
  await waitFor(() => expect(logged).toHaveBeenCalledOnce());
  expect(logged.mock.calls[0]?.[0]).toBeInstanceOf(ReferenceError);
  expect(String(logged.mock.calls[0]?.[0])).toContain("data is not defined");
  expect(within(input.parentElement!).getByRole("link", { name: "Show" })).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>("After link").value).toBe("Kept later text");
  expect(app.clearReads()).toBe(1);
});

test("an older barcode failure unlocks a pending Inventory GET so its price uses the live factor while raw count, note and label stay captured", async () => {
  const barcode = heldResponse();
  const details = heldResponse();

  const app = mount(
    "/inventory?product=7&flow=InplaceAddBarcodeToExistingProduct&barcode=OLD-CODE",
    { labels: true, serverLabels: false, barcodeReply: barcode.promise },
  );

  const amount = await screen.findByLabelText<HTMLInputElement>("New stock amount");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  await userEvent.clear(amount);
  await userEvent.type(amount, "12");
  await screen.findByText("This means 2 Pieces will be added to stock");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock amount of Coffee is now 12 Pieces");
  await choose();
  await waitFor(() => expect(document.activeElement).toBe(amount));
  await userEvent.selectOptions(screen.getByLabelText("Quantity unit"), "3");
  await userEvent.clear(amount);
  await userEvent.type(amount, "2");
  await screen.findByText("This means 4 Pieces will be added to stock");
  fireEvent.change(screen.getByLabelText("Price"), { target: { value: "4" } });
  await userEvent.type(screen.getByLabelText("Note"), "Captured count");
  await userEvent.selectOptions(screen.getByLabelText("Stock entry label"), "1");
  app.holdDetails(details.promise);
  const reads = app.reads();
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.reads()).toBeGreaterThan(reads));
  expect(amount.matches(":disabled")).toBe(true);
  await releaseInventoryRead(
    barcode,
    Response.json({ error_message: "Older barcode rejected" }, { status: 409 }),
  );
  await screen.findByRole("button", {
    name: /Error while saving, probably this item already exists/,
  });
  await waitFor(() => expect(amount.matches(":disabled")).toBe(false));
  await userEvent.selectOptions(screen.getByLabelText("Quantity unit"), "1");
  await userEvent.clear(amount);
  await userEvent.type(amount, "18");
  await screen.findByText("This means 6 Pieces will be added to stock");
  fireEvent.change(screen.getByLabelText("Price"), { target: { value: "99" } });
  await userEvent.clear(screen.getByLabelText("Note"));
  await userEvent.type(screen.getByLabelText("Note"), "Later count");
  await userEvent.selectOptions(screen.getByLabelText("Stock entry label"), "2");
  fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2030-02-03" } });
  fireEvent.change(screen.getByLabelText("Purchased date"), { target: { value: "2029-01-02" } });
  await userEvent.selectOptions(screen.getByLabelText("Store"), "2");
  await userEvent.selectOptions(screen.getByLabelText("Location"), "2");
  await releaseInventoryRead(details, app.detailsResponse({ stock: 12 }));
  await screen.findByText("Stock amount of Coffee is now 16 Pieces");
  expect(app.writes.filter((write) => write.path.endsWith("/inventory"))[1]?.body).toEqual({
    new_amount: "16.",
    price: "4.000",
    note: "Captured count",
    stock_label_type: "1",
    best_before_date: "2030-02-03",
    purchased_date: "2029-01-02",
    shopping_location_id: "2",
    location_id: "2",
  });
  expect(
    app.writes.filter((write) => write.path.endsWith("/objects/product_barcodes")),
  ).toHaveLength(1);
  expect(printed(app)).toEqual([
    { product: "Coffee", grocycode: "grcy:p:7:inventory-stock-2", due_date: "DD: 2030-12-24" },
  ]);
  expect(app.transactionReads()).toBe(0);
});

test.each([true, false])(
  "Inventory reads flow at booking, chooses embedded after receipt, and retains that branch through the last field (embedded=%s)",
  async (embedded) => {
    const booking = heldResponse();
    const receipt = heldResponse();
    const field = heldResponse();
    const barcode = heldResponse();

    const host = {
      IsGrocy: true,
      postMessage: vi.fn(),
      get parent() {
        return this;
      },
    };

    vi.stubGlobal("parent", host);

    const app = mount("/inventory?embedded&product=7", {
      custom: true,
      booking: booking.promise,
      receipt: receipt.promise,
      fieldReply: () => field.promise,
      barcodeReply: barcode.promise,
    });

    const amount = await screen.findByLabelText<HTMLInputElement>("New stock amount");
    await waitFor(() => expect(document.activeElement).toBe(amount));
    await userEvent.clear(amount);
    await userEvent.type(amount, "12");
    await screen.findByText("This means 2 Pieces will be added to stock");
    await userEvent.type(screen.getByLabelText("Note"), "Captured note");
    await userEvent.type(screen.getByLabelText("Batch"), "Receipt fields");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(app.writes.some((write) => write.path.endsWith("/inventory"))).toBe(true),
    );
    await act(async () => {
      app.router.history.replace(
        "/inventory?embedded&flow=InplaceAddBarcodeToExistingProduct&flow=wrong&barcode=FIRST+RAW=ignored&barcode=SECOND",
      );
    });
    await releaseInventoryRead(booking, Response.json({}));
    await waitFor(() => expect(app.receiptReads()).toBe(1));
    expect(
      app.writes.find((write) => write.path.endsWith("/objects/product_barcodes"))?.body,
    ).toEqual({
      barcode: "FIRST+RAW",
      product_id: "7",
      note: "Captured note",
      shopping_location_id: "1",
    });
    expect(app.writes.filter((write) => write.path.includes("/userfields/"))).toEqual([]);
    await act(async () => {
      app.router.history.replace(
        `/inventory?${embedded ? "embedded&" : ""}barcode=LATER&keep=receipt`,
      );
    });
    await releaseInventoryRead(receipt, app.detailsResponse({ stock: 12 }));
    await waitFor(() =>
      expect(app.writes.some((write) => write.path.includes("/userfields/"))).toBe(true),
    );
    await act(async () => {
      app.router.history.replace(`/inventory?${embedded ? "" : "embedded&"}keep=last-field`);
    });
    await releaseInventoryRead(field, Response.json({}));

    if (embedded) {
      await waitFor(() =>
        expect(host.postMessage.mock.calls.some(([bag]) => bag.Message === "CloseLastModal")).toBe(
          true,
        ),
      );
      expect(screen.queryByText("Stock amount of Coffee is now 12 Pieces")).toBeNull();
    } else {
      await screen.findByText("Stock amount of Coffee is now 12 Pieces");
      expect(host.postMessage.mock.calls.some(([bag]) => bag.Message === "CloseLastModal")).toBe(
        false,
      );
      expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("");
    }

    expect(app.writes.filter((write) => write.path.includes("/userfields/"))).toEqual([
      { path: "/api/userfields/stock/inventory-transaction", body: { batch: "Receipt fields" } },
    ]);
    await releaseInventoryRead(barcode, Response.json({}));
    await waitFor(() => expect(app.router.history.location.search).toBe(""));
    expect(app.router.history.location.pathname).toBe("/inventory");
    expect(screen.getByLabelText("New stock amount")).toBe(amount);
  },
);

test.each([
  { setting: "false", visible: true, posts: true },
  { setting: false, visible: false, posts: true },
  { setting: "0", visible: false, posts: false },
])(
  "Inventory purchased-date template and callback retain PHP/JavaScript truthiness for '$setting'",
  async ({ setting, visible, posts }) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = mount("/inventory", { purchasedSetting: setting });
    const amount = await choose();
    await waitFor(() => expect(document.activeElement).toBe(amount));
    expect(!!screen.queryByLabelText("Purchased date")).toBe(visible);
    await userEvent.clear(amount);
    await userEvent.type(amount, "12");
    await screen.findByText("This means 2 Pieces will be added to stock");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));

    if (!posts) {
      await waitFor(() => expect(logged).toHaveBeenCalledOnce());
      expect(logged.mock.calls[0]?.[0]).toBeInstanceOf(TypeError);
      expect(app.writes.filter((write) => write.path.endsWith("/inventory"))).toEqual([]);
      expect(amount.matches(":disabled")).toBe(true);
      expect(screen.queryByText("Stock amount of Coffee is now 12 Pieces")).toBeNull();
    } else {
      await screen.findByText("Stock amount of Coffee is now 12 Pieces");
      const body = app.writes.find((write) => write.path.endsWith("/inventory"))?.body;

      if (visible) expect(body?.purchased_date).toBe(isoDay());
      else expect(Object.hasOwn(body!, "purchased_date")).toBe(false);
      expect(logged).not.toHaveBeenCalled();
    }
  },
);

test.each([
  { stock: 5.006, direction: "added to", required: true },
  { stock: 5.014, direction: "removed from", required: false },
])(
  "Inventory displays rounded zero for a raw $direction comparison and updates required flags",
  async ({ stock, direction, required }) => {
    const app = mount("/inventory");
    const amount = await choose();
    await waitFor(() => expect(document.activeElement).toBe(amount));
    app.setServer({ stock });
    await userEvent.clear(amount);
    await userEvent.type(amount, "5.01");
    await waitFor(() => expectEstimateVisible(`This means 0 Pieces will be ${direction} stock`));
    expect(screen.getByLabelText<HTMLInputElement>("Due date").required).toBe(required);
    expect(screen.getByLabelText<HTMLSelectElement>("Location").required).toBe(required);
    expect(app.writes).toEqual([]);
  },
);

function expectEstimateVisible(message: string) {
  const node = screen.getByText(message);
  expect(node.closest("[hidden]")).toBeNull();
  expect(getComputedStyle(node).display).not.toBe("none");
}

function expectEstimateHidden() {
  for (const node of screen.queryAllByText(/^This means .+ will be (added to|removed from) stock$/))
    expect(node.closest("[hidden]") !== null || getComputedStyle(node).display === "none").toBe(
      true,
    );
}

test("neutral tare gross and under-tare estimates preserve the prior add text and required flags", async () => {
  const app = mount("/inventory");
  app.setServer({ stock: 5 });
  const amount = await choose("Tare coffee");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  await userEvent.clear(amount);
  await userEvent.type(amount, "10");
  const message = "This means 2 Pieces will be added to stock";
  await screen.findByText(message);
  await userEvent.clear(amount);
  await userEvent.type(amount, "8");
  await act(async () => {
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
  });
  await waitFor(() => expectEstimateVisible(message));
  expect(screen.getByLabelText<HTMLInputElement>("Due date").required).toBe(true);
  expect(screen.getByLabelText<HTMLSelectElement>("Location").required).toBe(true);
  await userEvent.clear(amount);
  await userEvent.type(amount, "2");
  await act(async () => {
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
  });
  expectEstimateHidden();
  expect(screen.getByLabelText<HTMLInputElement>("Due date").required).toBe(true);
  expect(screen.getByLabelText<HTMLSelectElement>("Location").required).toBe(true);
  await userEvent.clear(amount);
  await userEvent.type(amount, "8");
  await waitFor(() => expectEstimateVisible(message));
  expect(app.writes).toEqual([]);
});

test("an equal-stock estimate hides only the prior info and retains its required fields", async () => {
  const app = mount("/inventory");
  app.setServer({ stock: 5 });
  const amount = await choose();
  await waitFor(() => expect(document.activeElement).toBe(amount));
  await userEvent.clear(amount);
  await userEvent.type(amount, "7");
  const message = "This means 2 Pieces will be added to stock";
  await screen.findByText(message);
  // Replace the selected value atomically: clearing first would issue a separate zero estimate.
  changeAndKeyup(amount, "5");
  await act(async () => {
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
  });
  expectEstimateHidden();
  expect(screen.getByLabelText<HTMLInputElement>("Due date").required).toBe(true);
  expect(screen.getByLabelText<HTMLSelectElement>("Location").required).toBe(true);
  expect(app.writes).toEqual([]);
});

test("a held positive estimate arriving after Inventory reset redisplays its info while the amount remains empty", async () => {
  const earlier = heldResponse();
  const app = mount("/inventory");
  const amount = await choose();
  await waitFor(() => expect(document.activeElement).toBe(amount));
  await userEvent.clear(amount);
  await userEvent.type(amount, "12");
  await screen.findByText("This means 2 Pieces will be added to stock");
  app.holdDetails(earlier.promise);
  const reads = app.reads();
  changeAndKeyup(amount, "14");
  await waitFor(() => expect(app.reads()).toBeGreaterThan(reads));
  changeAndKeyup(amount, "12");
  await screen.findByText("This means 2 Pieces will be added to stock");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock amount of Coffee is now 12 Pieces");
  expect(amount.value).toBe("");
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("");
  await releaseInventoryRead(earlier, app.detailsResponse({ stock: 10 }));
  await waitFor(() => expectEstimateVisible("This means 4 Pieces will be added to stock"));
  expect(amount.value).toBe("");
  expect(screen.getByLabelText<HTMLInputElement>("Due date").required).toBe(true);
  expect(screen.getByLabelText<HTMLSelectElement>("Location").required).toBe(true);
  expect(app.writes.filter((write) => write.path.endsWith("/inventory"))).toHaveLength(1);
});

test.each([
  { stock: 9.996, display: "10", wire: "10.", estimate: "0 Pieces" },
  { stock: 2.675, display: "2.68", wire: "2.68", estimate: "0.01 Pieces" },
])(
  "Inventory formats selected stock before conversion, validation, and estimate (stock=$stock)",
  async ({ stock, display, wire, estimate }) => {
    const app = mount("/inventory");
    app.setServer({ stock });
    const amount = await choose();
    await waitFor(() => expect(amount.value).toBe(display));
    await screen.findByText(`This means ${estimate} will be added to stock`);
    expect(amount.checkValidity()).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>("Due date").required).toBe(true);
    expect(screen.getByLabelText<HTMLSelectElement>("Location").required).toBe(true);
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(false),
    );
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText(`Stock amount of Coffee is now ${display} Pieces`);
    expect(app.writes.find((write) => write.path.endsWith("/inventory"))?.body.new_amount).toBe(
      wire,
    );
    expect(app.stock()).toBe(Number(display));
  },
);

test("Inventory barcode formatting preserves the already converted amount and does not request an estimate", async () => {
  const barcode = heldResponse();
  const app = mount("/inventory", { barcodeLookupReply: barcode.promise });
  const amount = await choose("COFFEE-2");
  await waitFor(() => expect(amount.value).toBe("10"));
  await waitFor(() => expect(document.activeElement).toBe(amount));
  await userEvent.clear(amount);
  await userEvent.type(amount, "12");
  await screen.findByText("This means 2 Pieces will be added to stock");
  await userEvent.click(screen.getByLabelText("Note"));
  await act(async () => {
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
  });
  const reads = app.reads();
  await releaseInventoryRead(
    barcode,
    Response.json([{ amount: 2.675, qu_id: 3, note: "Overprecision barcode" }]),
  );
  await waitFor(() => expect(amount.value).toBe("2.68"));
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("3");
  expect(screen.getByText("This equals 21.4 Pieces")).toBeTruthy();
  expect(amount.checkValidity()).toBe(true);
  expect(app.reads()).toBe(reads);
  expectEstimateVisible("This means 2 Pieces will be added to stock");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock amount of Coffee is now 21.4 Pieces");
  expect(app.writes.find((write) => write.path.endsWith("/inventory"))?.body).toMatchObject({
    new_amount: "21.4",
    note: "Overprecision barcode",
  });
});

test.each(["InplaceNewProductWithName", "InplaceAddBarcodeToExistingProduct"])(
  "Inventory FinishFlow permits the next unknown barcode while preserving initial hints (%s)",
  async (flow) => {
    const barcode = heldResponse();
    onTestFinished(() => barcode.resolve(Response.json({})));

    const app = mount(`/inventory?product=7&flow=${flow}&barcode=NEW-CODE`, {
      barcodeReply: barcode.promise,
    });

    const amount = await choose();
    await waitFor(() => expect(document.activeElement).toBe(amount));
    changeAndKeyup(amount, "12");
    await screen.findByText("This means 2 Pieces will be added to stock");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Stock amount of Coffee is now 12 Pieces");
    expect(app.router.history.location.search).toBe("?product=7");
    expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("");
    expect(app.writes.filter((write) => write.path.endsWith("/product_barcodes"))).toHaveLength(
      flow === "InplaceAddBarcodeToExistingProduct" ? 1 : 0,
    );

    if (flow === "InplaceAddBarcodeToExistingProduct")
      expect(screen.getByText(/NEW-CODE.*will be added to the list of barcodes/)).toBeTruthy();

    const product = screen.getByLabelText<HTMLInputElement>("Product");
    fireEvent.change(product, { target: { value: "NEXT-UNLISTED" } });
    fireEvent.keyDown(product, { key: "Enter" });
    expect(
      await screen.findByRole("button", { name: /Add as barcode to existing product/ }),
    ).toBeTruthy();
  },
);

test("Inventory captures the selected hidden price when price tracking is disabled", async () => {
  const app = mount("/inventory", {
    prices: false,
    lastPrice: 2.6751,
    priceDisplayPrecision: 4,
    priceInputPrecision: 2,
  });

  const amount = await choose();
  await waitFor(() => expect(document.activeElement).toBe(amount));
  expect(screen.queryByLabelText("Price")).toBeNull();
  changeAndKeyup(amount, "12");
  await screen.findByText("This means 2 Pieces will be added to stock");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock amount of Coffee is now 12 Pieces");
  expect(app.writes.find((write) => write.path.endsWith("/inventory"))?.body.price).toBe("2.68");
  expect(
    app.writes.find((write) => write.path.endsWith("/inventory"))?.body.shopping_location_id,
  ).toBeUndefined();
});

test("Inventory formats the selected visible price to input precision before a changed count", async () => {
  const app = mount("/inventory", {
    lastPrice: 2.6751,
    priceDisplayPrecision: 4,
    priceInputPrecision: 2,
  });

  const amount = await choose();
  const price = screen.getByLabelText<HTMLInputElement>("Price");
  await waitFor(() => expect(price.value).toBe("2.68"));
  expect(price.checkValidity()).toBe(true);
  changeAndKeyup(amount, "12");
  await screen.findByText("This means 2 Pieces will be added to stock");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock amount of Coffee is now 12 Pieces");
  expect(app.writes.find((write) => write.path.endsWith("/inventory"))?.body.price).toBe("2.68");
});

test.each([false, true])(
  "Inventory barcode currency formatting preserves its earlier hint until a source refresh event (unitEvent=%s)",
  async (unitEvent) => {
    const lookup = heldResponse();

    const app = mount("/inventory", {
      barcodeLookupReply: lookup.promise,
      priceDisplayPrecision: 4,
      priceInputPrecision: 2,
    });

    const amount = await choose("COFFEE-2");
    await waitFor(() => expect(document.activeElement).toBe(amount));
    const price = screen.getByLabelText<HTMLInputElement>("Price");
    await userEvent.clear(amount);
    await userEvent.type(amount, "12");
    await screen.findByText("This means 2 Pieces will be added to stock");
    await userEvent.click(price);
    fireEvent.change(price, { target: { value: "2.6751" } });
    expect(price.checkValidity()).toBe(false);
    await act(async () => {
      await new Promise<void>((resolve) => notifyManager.schedule(resolve));
    });
    const reads = app.reads();
    await releaseInventoryRead(lookup, Response.json([{ amount: 2.675, qu_id: 3, note: null }]));
    await waitFor(() => expect(price.value).toBe("2.68"));
    expect(price.checkValidity()).toBe(true);
    expect(amount.value).toBe("2.68");
    const oldHint = "means 0.3344 per Piece";
    expect(screen.getByText(oldHint)).toBeTruthy();
    expect(app.reads()).toBe(reads);
    expectEstimateVisible("This means 2 Pieces will be added to stock");
    fireEvent.change(price, { target: { value: "5.36" } });
    expect(screen.getByText(oldHint)).toBeTruthy();

    if (unitEvent) {
      await userEvent.selectOptions(screen.getByLabelText("Quantity unit"), "1");
      expect(screen.queryByText(oldHint)).toBeNull();
      await userEvent.selectOptions(screen.getByLabelText("Quantity unit"), "3");
      expect(screen.getByText("means 0.6700 per Piece")).toBeTruthy();
    }

    expect(app.reads()).toBe(reads);
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    const expected = unitEvent ? "21.44" : "21.4";
    await screen.findByText(`Stock amount of Coffee is now ${expected} Pieces`);
    expect(app.writes.find((write) => write.path.endsWith("/inventory"))?.body).toMatchObject({
      new_amount: expected,
      price: "0.67",
    });
  },
);

test("Inventory hidden price is not currency-formatted by a later barcode callback", async () => {
  const lookup = heldResponse();

  const app = mount("/inventory", {
    prices: false,
    lastPrice: 1.23456,
    priceDisplayPrecision: 5,
    priceInputPrecision: 2,
    barcodeLookupReply: lookup.promise,
  });

  const amount = await choose("COFFEE-2");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  await userEvent.clear(amount);
  await userEvent.type(amount, "12");
  await screen.findByText("This means 2 Pieces will be added to stock");
  await userEvent.click(screen.getByLabelText("Note"));
  await releaseInventoryRead(lookup, Response.json([{ amount: 2.675, qu_id: 3, note: null }]));
  await waitFor(() => expect(amount.value).toBe("2.68"));
  expect(screen.queryByLabelText("Price")).toBeNull();

  const hidden = screen
    .getByRole("form", { name: "Inventory" })
    .querySelector<HTMLInputElement>('input[type="hidden"][name="price"]');

  expect(hidden?.value).toBe("1.23456");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock amount of Coffee is now 21.4 Pieces");
  expect(app.writes.find((write) => write.path.endsWith("/inventory"))?.body.price).toBe("0.15");
});

test("Inventory global currency refresh formats a dirty userfield even while price tracking is disabled", async () => {
  const lookup = heldResponse();

  const app = mount("/inventory", {
    prices: false,
    definitions: [inventoryField(1, "fee", "Fee", "number-currency")],
    priceInputPrecision: 2,
    barcodeLookupReply: lookup.promise,
  });

  const amount = await choose("COFFEE-2");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  const fee = screen.getByLabelText<HTMLInputElement>("Fee");
  await userEvent.clear(amount);
  await userEvent.type(amount, "12");
  await screen.findByText("This means 2 Pieces will be added to stock");
  await userEvent.click(fee);
  fireEvent.change(fee, { target: { value: "9.1234" } });
  expect(fee.value).toBe("9.1234");
  expect(fee.step).toBe("0.0001");
  await releaseInventoryRead(lookup, Response.json([{ amount: 2.675, qu_id: 3, note: null }]));
  await waitFor(() => expect(fee.value).toBe("9.12"));
  expect(amount.value).toBe("2.68");
  expect(screen.queryByLabelText("Price")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock amount of Coffee is now 21.4 Pieces");
  expect(app.writes.find((write) => write.path.includes("/userfields/stock/"))?.body).toEqual({
    fee: "9.12",
  });
});

test("Inventory keeps an unchanged-count custom error through a programmatic barcode until real keyup", async () => {
  const lookup = heldResponse();
  const app = mount("/inventory", { barcodeLookupReply: lookup.promise });
  const amount = await choose("COFFEE-2");
  await waitFor(() => expect(amount.value).toBe("10"));
  await waitFor(() => expect(amount.validity.customError).toBe(true));
  expect(amount.validity.stepMismatch).toBe(false);
  await releaseInventoryRead(lookup, Response.json([{ amount: 3, qu_id: 1, note: null }]));
  await waitFor(() => expect(amount.value).toBe("3"));
  expect(amount.validity.customError).toBe(true);
  expect(amount.validity.stepMismatch).toBe(false);
  expect(amount.checkValidity()).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(app.writes).toEqual([]);
  fireEvent.keyUp(amount, { key: "Shift" });
  expect(amount.value).toBe("3");
  expect(amount.validity.customError).toBe(false);
  await screen.findByText("This means 7 Pieces will be removed from stock");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock amount of Coffee is now 3 Pieces");
  expect(app.writes.find((write) => write.path.endsWith("/inventory"))?.body.new_amount).toBe("3.");
});

test("Inventory native change without keyup updates its wire amount but retains validation and estimate state", async () => {
  const app = mount("/inventory");
  const amount = await choose();
  await waitFor(() => expect(amount.value).toBe("10"));
  await waitFor(() => expect(amount.validity.customError).toBe(true));
  await act(async () => {
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
  });
  const reads = app.reads();
  // A context-menu edit commits a native change on blur without a keyboard event.
  fireEvent.change(amount, { target: { value: "3" } });
  expect(amount.value).toBe("3");
  expect(
    screen
      .getByRole("form", { name: "Inventory" })
      .querySelector<HTMLInputElement>('input[name="amount"]')?.value,
  ).toBe("3.");
  expect(amount.validity.customError).toBe(true);
  expect(app.reads()).toBe(reads);
  expectEstimateHidden();
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(app.writes).toEqual([]);
  expect(app.reads()).toBe(reads);
  fireEvent.keyUp(amount, { key: "Shift" });
  expect(amount.validity.customError).toBe(false);
  await screen.findByText("This means 7 Pieces will be removed from stock");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock amount of Coffee is now 3 Pieces");
  expect(app.writes.find((write) => write.path.endsWith("/inventory"))?.body.new_amount).toBe("3.");
});

test("Inventory QU changes retain an existing custom error until amount keyup", async () => {
  const app = mount("/inventory");
  const amount = await choose();
  await waitFor(() => expect(amount.validity.customError).toBe(true));
  await userEvent.selectOptions(screen.getByLabelText("Quantity unit"), "3");
  expect(amount.value).toBe("10");
  expect(amount.validity.customError).toBe(true);
  expect(amount.getAttribute("data-not-equal")).toBe("1.25");
  fireEvent.keyUp(amount, { key: "Shift" });
  expect(amount.validity.customError).toBe(false);
  await screen.findByText("This means 70 Pieces will be added to stock");
  expect(app.writes).toEqual([]);
});

test("Inventory QU attribute equality does not add a custom error or block the native rejected attempt before keyup", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount("/inventory");
  const amount = await choose();
  await waitFor(() => expect(document.activeElement).toBe(amount));
  changeAndKeyup(amount, "1.25");
  await screen.findByText("This means 8.75 Pieces will be removed from stock");
  expect(amount.validity.customError).toBe(false);
  await userEvent.selectOptions(screen.getByLabelText("Quantity unit"), "3");
  expect(amount.validity.customError).toBe(false);
  expect(amount.getAttribute("data-not-equal")).toBe("1.25");
  expect(amount.checkValidity()).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(app.writes.find((write) => write.path.endsWith("/inventory"))?.body.new_amount).toBe(
      "10.",
    ),
  );
  await waitFor(() => expect(errors).toHaveBeenCalledTimes(1));
  expect(app.stock()).toBe(10);
  expect(screen.queryByText("Stock amount of Coffee is now 10 Pieces")).toBeNull();
  fireEvent.keyUp(amount, { key: "Shift" });
  expect(amount.validity.customError).toBe(true);
  fireEvent.submit(screen.getByRole("form", { name: "Inventory" }));
  expect(app.writes.filter((write) => write.path.endsWith("/inventory"))).toHaveLength(1);
});

test("Inventory forbidden-count keyup compares raw strings rather than equivalent numeric values", async () => {
  const app = mount("/inventory");
  const amount = await choose();
  await waitFor(() => expect(amount.validity.customError).toBe(true));
  changeAndKeyup(amount, "10.00");
  expect(amount.value).toBe("10.00");
  expect(amount.validity.customError).toBe(false);
  expect(amount.checkValidity()).toBe(true);
  changeAndKeyup(amount, "10");
  expect(amount.validity.customError).toBe(true);
  expect(app.writes).toEqual([]);
});

test.each(["buttons", "arrows"])(
  "Inventory %s run native step keyup validation and estimates",
  async (control) => {
    const app = mount("/inventory");
    const amount = await choose();
    await waitFor(() => expect(amount.validity.customError).toBe(true));

    if (control === "arrows") await userEvent.click(amount);

    if (control === "buttons")
      await userEvent.click(screen.getByRole("button", { name: "Increase New stock amount" }));
    else await userEvent.keyboard("{ArrowUp}");

    expect(amount.value).toBe("11");
    expect(amount.validity.customError).toBe(false);
    await screen.findByText("This means 1 Piece will be added to stock");

    if (control === "buttons")
      await userEvent.click(screen.getByRole("button", { name: "Decrease New stock amount" }));
    else await userEvent.keyboard("{ArrowDown}");

    expect(amount.value).toBe("10");
    expect(amount.validity.customError).toBe(true);
    expect(app.writes).toEqual([]);
  },
);

test("Inventory waits for its receipt before reading native dirty fields and current custom textarea DOM", async () => {
  const receipt = heldResponse();

  const app = mount("/inventory", {
    receipt: receipt.promise,
    definitions: [
      inventoryField(1, "same", "Same blank"),
      inventoryField(2, "notes", "Count notes", "text-multi-line"),
      inventoryField(3, "clean", "Untouched"),
    ],
  });

  await prepareLabelsForCount("12");

  const same = screen.getByLabelText<HTMLInputElement>("Same blank");
  same.focus();
  await userEvent.keyboard("{ArrowLeft}");
  expect(same.value).toBe("");
  const notes = screen.getByLabelText<HTMLTextAreaElement>("Count notes");
  fireEvent.change(notes, { target: { value: "Before receipt" } });
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.receiptReads()).toBe(1));
  expect(notes.matches(":disabled")).toBe(true);
  expect(app.writes.filter((write) => write.path.includes("/userfields/"))).toEqual([]);

  // Controlled mutation of a disabled control isolates native Save's late DOM
  // read. This is not presented as natural user editing while the form is busy.
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setValue.call(notes, "At receipt\r\nSecond line");
  await releaseInventoryRead(receipt, app.detailsResponse({ stock: 12 }));
  await screen.findByText("Stock amount of Coffee is now 12 Pieces");
  expect(app.writes.filter((write) => write.path.includes("/userfields/"))).toEqual([
    { path: "/api/userfields/stock/inventory-transaction", body: { same: "" } },
    {
      path: "/api/userfields/stock/inventory-transaction",
      body: { notes: "At receipt\nSecond line" },
    },
  ]);
  expect(app.writes.filter((write) => write.path.endsWith("/inventory"))).toHaveLength(1);
});

test.each([false, true])(
  "Inventory preset click and packed-link keyup govern metadata independently of display changes (native events=%s)",
  async (nativeEvents) => {
    const app = mount("/inventory", {
      definitions: [
        { ...inventoryField(1, "priority", "Priority", "preset-list"), config: "Routine\nUrgent" },
        inventoryField(2, "resource", "Resource", "link-with-title"),
        inventoryField(3, "clean", "Untouched"),
      ],
    });

    await prepareLabelsForCount("12");
    const priority = screen.getByLabelText<HTMLSelectElement>("Priority");
    fireEvent.change(priority, { target: { value: "Urgent" } });
    const title = screen.getByLabelText<HTMLInputElement>("Title");
    fireEvent.change(title, { target: { value: "Packed title" } });
    fireEvent.change(screen.getByLabelText("Link"), {
      target: { value: "https://example.test/count" },
    });

    if (nativeEvents) {
      await userEvent.click(priority);
      title.focus();
      await userEvent.keyboard("{ArrowLeft}");
    }

    fireEvent.change(title, { target: { value: "Display-only later title" } });
    expect(title.value).toBe("Display-only later title");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Stock amount of Coffee is now 12 Pieces");
    expect(app.writes.filter((write) => write.path.includes("/userfields/"))).toEqual(
      nativeEvents
        ? [
            { path: "/api/userfields/stock/inventory-transaction", body: { priority: "Urgent" } },
            {
              path: "/api/userfields/stock/inventory-transaction",
              body: { resource: '{"title":"Packed title","link":"https://example.test/count"}' },
            },
          ]
        : [],
    );
    expect(app.writes.filter((write) => write.path.endsWith("/inventory"))).toHaveLength(1);
  },
);
