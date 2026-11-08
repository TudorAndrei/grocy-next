import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test } from "vitest";
import type { JsonObject } from "@/lib/json";
import { mountNativeEditor } from "./fixtures/native-editor";
import { overviewFixture } from "./fixtures/stock-overview";
import { productOverview } from "./fixtures/product-overview";

function mount(
  path: string,
  config: JsonObject = {},
  basepath?: string,
  holds: { transaction?: Promise<Response>; receipt?: Promise<Response> } = {},
) {
  const writes: { path: string; body: JsonObject }[] = [];
  const reads: string[] = [];
  const transactionSignals: (AbortSignal | null | undefined)[] = [];
  let stock = 10;
  let awaitingReceipt = false;
  let precision = 2;
  let location = "Shelf";
  let barcodeFails = false;

  const details = (id: number) => ({
    ...productOverview,
    product: {
      ...productOverview.product,
      id,
      name: id === 7 ? "Coffee" : "Tea",
      description: null,
      enable_tare_weight_handling: 0,
      tare_weight: 0,
      default_best_before_days: 5,
      default_stock_label_type: holds.transaction ? 1 : 0,
    },
    stock_amount: stock,
    quantity_unit_stock: { id: 1, name: "Piece", name_plural: "Pieces" },
    location: { id: 1, name: location, is_freezer: 0 },
    last_price: 1,
    last_shopping_location_id: 1,
  });

  const app = mountNativeEditor(
    path,
    async (url, init) => {
      const pathname = new URL(url, "http://localhost").pathname;

      if (init?.method === "POST" || init?.method === "PUT") {
        const body = JSON.parse(String(init.body ?? "{}"));
        writes.push({ path: pathname, body });

        if (pathname.endsWith("/inventory")) {
          stock = Number(body.new_amount);
          awaitingReceipt = true;

          return Response.json([
            {
              id: 90,
              product_id: pathname.endsWith("/8/inventory") ? 8 : 7,
              amount: 2,
              transaction_id: "inventory-document",
              stock_id: "document-stock",
              best_before_date: "2030-12-24",
            },
          ]);
        }

        if (pathname.endsWith("/product_barcodes") && barcodeFails)
          return Response.json({ error_message: "Barcode unavailable" }, { status: 503 });

        return Response.json({});
      }

      reads.push(pathname);

      if (pathname.endsWith("/api/v2/user/permissions"))
        return Response.json({ STOCK_INVENTORY: true });

      if (pathname.endsWith("/api/user/settings"))
        return Response.json({
          stock_decimal_places_amounts: precision,
          stock_decimal_places_prices_input: 3,
          stock_decimal_places_prices_display: 2,
        });

      if (pathname.endsWith("/api/system/config"))
        return Response.json({
          FEATURE_FLAG_STOCK: true,
          FEATURE_FLAG_SHOPPINGLIST: false,
          FEATURE_FLAG_RECIPES: false,
          FEATURE_FLAG_STOCK_LOCATION_TRACKING: true,
          FEATURE_FLAG_STOCK_PRICE_TRACKING: true,
          FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: true,
          FEATURE_FLAG_LABEL_PRINTER: Boolean(holds.transaction),
          LABEL_PRINTER_RUN_SERVER: false,
          LABEL_PRINTER_WEBHOOK: "https://printer.example.test/labels",
          ...config,
        });

      if (pathname.endsWith("/api/v2/stock/overview"))
        return Response.json(
          overviewFixture([{ product_id: 7, product: { id: 7, name: "Coffee" }, amount: stock }]),
        );

      if (pathname.endsWith("/api/stock")) return Response.json([]);

      if (pathname.endsWith("/api/stock/volatile"))
        return Response.json({
          due_products: [],
          overdue_products: [],
          expired_products: [],
          missing_products: [],
        });

      if (pathname.endsWith("/api/v2/stock/inventory/editor"))
        return Response.json({
          barcode_lookup_plugin_name: "Demo",
          products: [
            { id: 7, name: "Coffee" },
            { id: 8, name: "Tea" },
          ],
          locations: [{ id: 1, name: location, is_freezer: 0 }],
          stores: [{ id: 1, name: "Market" }],
          units: [{ id: 1, name: "Piece", name_plural: "Pieces" }],
          barcodes: [],
          fields: [],
          conversions: [7, 8].map((product_id) => ({
            product_id,
            from_qu_id: 1,
            to_qu_id: 1,
            factor: "1",
            to_qu_name: "Piece",
            to_qu_name_plural: "Pieces",
          })),
        });

      if (/\/api\/stock\/products\/[78]$/.test(pathname)) {
        if (awaitingReceipt) {
          awaitingReceipt = false;

          if (holds.receipt) return await holds.receipt;
        }

        return Response.json(details(pathname.endsWith("/8") ? 8 : 7));
      }

      if (pathname.endsWith("/api/objects/product_barcodes_view")) return Response.json([]);

      if (pathname.endsWith("/api/stock/transactions/inventory-document")) {
        transactionSignals.push(init?.signal);

        return holds.transaction ? await holds.transaction : Response.json([]);
      }

      return undefined;
    },
    {},
    { basepath },
  );

  return {
    ...app,
    writes,
    reads,
    transactionSignals,
    details,
    refreshChildDefaults: () => {
      precision = 1;
      location = "New shelf";
    },
    failBarcode: () => {
      barcodeFails = true;
    },
  };
}

async function ready(container = document.body) {
  const ui = within(container);
  await waitFor(() => {
    expect(ui.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("1");
    expect(ui.getByLabelText<HTMLSelectElement>("Location").value).toBe("1");
  });

  return ui.getByLabelText<HTMLInputElement>("New stock amount");
}

async function choose(container = document.body) {
  const ui = within(container);
  const product = await ui.findByLabelText<HTMLInputElement>("Product");
  fireEvent.change(product, { target: { value: "Coffee" } });
  await ready(container);

  return product;
}

async function count(container = document.body) {
  const ui = within(container);
  const amount = await ready(container);
  fireEvent.change(amount, { target: { value: "12" } });
  fireEvent.keyUp(amount, { key: "2" });
  await ui.findByText("This means 2 Pieces will be added to stock");
  await userEvent.click(ui.getByRole("button", { name: "OK" }));

  return amount;
}

test("Inventory reads the first literal duplicate product at the routed booking boundary", async () => {
  const app = mount("/inventory?embedded&product=7&product=8");
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("Coffee"),
  );
  await count();
  await waitFor(() =>
    expect(app.writes.find((write) => write.path.endsWith("/inventory"))?.path).toBe(
      "/api/stock/products/7/inventory",
    ),
  );
});

test("PHP-embedded Inventory markup does not replay the literal-key product bootstrap", async () => {
  const app = mount("/inventory?%65mbedded&product=7");
  const product = await screen.findByLabelText<HTMLInputElement>("Product");
  await act(async () => {
    await new Promise(requestAnimationFrame);
  });
  expect(document.querySelector(".embedded-main")).not.toBeNull();
  expect(product.value).toBe("Coffee");
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("");
  expect(app.reads.filter((path) => /\/stock\/products\/[78]$/.test(path))).toEqual([]);
  expect(app.writes).toEqual([]);
});

test.each([
  { query: "flow=InplaceNewProductWithName", bootstrap: true },
  { query: "flow=InplaceAddBarcodeToExistingProduct", bootstrap: true },
  { query: "flow=OtherFlow", bootstrap: false },
  { query: "flow", bootstrap: false },
  { query: "%66low=InplaceNewProductWithName", bootstrap: false },
])(
  "Inventory startup recognizes only native literal flows ($query)",
  async ({ query, bootstrap }) => {
    const app = mount(`/inventory?product=7&${query}`);
    const product = await screen.findByLabelText<HTMLInputElement>("Product");

    if (bootstrap) await ready();
    else {
      await act(async () => {
        await new Promise(requestAnimationFrame);
      });
      expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("");
      expect(app.reads.filter((path) => /\/stock\/products\/[78]$/.test(path))).toEqual([]);
    }

    expect(product.value).toBe("Coffee");
  },
);

test.each([
  {
    query: "flow=InplaceNewProductWithName&barcode=OLD&product-name=Coffee",
    expected: "/inventory?",
  },
  {
    query:
      "flow=InplaceNewProductWithName&product-name=Coffee&payload=a%26flow%3Dstill-here&keep=one&keep=two&flag#gone",
    expected: "/inventory?payload=a&flow=still-here&keep=one&keep=two&flag=",
  },
])(
  "Inventory completion retains three-pass FinishFlow history ($expected)",
  async ({ query, expected }) => {
    const app = mount(`/inventory?${query}`);
    await choose();
    const amount = await count();
    await screen.findByText("Stock amount of Coffee is now 12 Pieces");
    await waitFor(() => expect(app.router.history.location.href).toBe(expected));
    expect(screen.getByLabelText("New stock amount")).toBe(amount);
    expect(amount.value).toBe("");
    expect(app.writes.filter((write) => write.path.endsWith("/inventory"))).toHaveLength(1);
  },
);

test.each([
  { basepath: "/house.hold", rewrite: false, canonical: "/house.hold/inventory" },
  {
    basepath: "/house.hold/index.php",
    rewrite: true,
    canonical: "/house.hold/index.php/inventory",
  },
])(
  "embedded Inventory barcode completion replaces history without replacing its document ($basepath)",
  async ({ basepath, rewrite, canonical }) => {
    const app = mount(
      "/house.hold/index.php/inventory?embedded&product=7&flow=InplaceAddBarcodeToExistingProduct&barcode=NEW&keep=one#gone",
      { BASE_URL: "/house.hold", DISABLE_URL_REWRITING: rewrite },
      basepath,
    );

    const amount = await count();
    await waitFor(() => expect(app.router.history.location.href).toBe(canonical));
    expect(app.writes.find((write) => write.path.endsWith("/product_barcodes"))?.body.barcode).toBe(
      "NEW",
    );
    expect(screen.getByLabelText("New stock amount")).toBe(amount);
    expect(amount.matches(":disabled")).toBe(true);
  },
);

test("an inline Inventory reads its own logical URI and leaves the parent Stock query unchanged", async () => {
  const path =
    "/stock?flow=InplaceAddBarcodeToExistingProduct&barcode=PARENT&keep=one&keep=two&flag#parent";

  const app = mount(path);
  const open = await screen.findByRole<HTMLButtonElement>("button", { name: "Inventory Coffee" });
  await waitFor(() => expect(open.disabled).toBe(false));
  await userEvent.click(open);
  const dialog = await screen.findByRole("dialog", { name: "Inventory" });
  await count(dialog);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Inventory" })).toBeNull());
  expect(app.writes.some((write) => write.path.endsWith("/product_barcodes"))).toBe(false);
  expect(app.router.history.location.href).toBe(path);
});

test("inline barcode assignment refreshes only its Inventory catalog, settings, and draft", async () => {
  const path = "/stock?flow=ParentFlow&barcode=PARENT&keep=one#parent";
  const app = mount(path);
  const original = Object.getOwnPropertyDescriptor(globalThis, "value");

  Object.defineProperty(globalThis, "value", {
    configurable: true,
    writable: true,
    value: "parent-binding",
  });
  onTestFinished(() => {
    if (original) Object.defineProperty(globalThis, "value", original);
    else Reflect.deleteProperty(globalThis, "value");
  });
  const open = await screen.findByRole<HTMLButtonElement>("button", { name: "Inventory Coffee" });
  await waitFor(() => expect(open.disabled).toBe(false));
  await userEvent.click(open);
  const dialog = await screen.findByRole("dialog", { name: "Inventory" });
  const ui = within(dialog);
  await ready(dialog);
  await userEvent.type(ui.getByLabelText("Note"), "Old document draft");
  const old = ui.getByLabelText<HTMLInputElement>("Product");
  app.refreshChildDefaults();
  fireEvent.change(old, { target: { value: "NEW-INLINE" } });
  await userEvent.type(old, "{Enter}");
  await userEvent.click(
    await screen.findByRole("button", { name: /Add as barcode to existing product/ }),
  );
  await waitFor(() => expect(ui.getByLabelText("Product")).not.toBe(old));
  expect(ui.getByLabelText<HTMLInputElement>("Note").value).toBe("");
  expect(ui.getByLabelText<HTMLInputElement>("New stock amount").step).toBe("0.1");
  expect(ui.getByRole("option", { name: "New shelf" })).toBeTruthy();
  expect(ui.getByLabelText<HTMLInputElement>("Product").value).toBe("");
  expect(app.router.history.location.href).toBe(path);
  expect(Object.getOwnPropertyDescriptor(globalThis, "value")?.value).toBe("parent-binding");
  await choose(dialog);
  await count(dialog);
  await waitFor(() =>
    expect(app.writes.find((write) => write.path.endsWith("/product_barcodes"))?.body.barcode).toBe(
      "NEW-INLINE",
    ),
  );
  expect(app.router.history.location.href).toBe(path);
});

test("native barcode assignment reloads the physical Inventory document and retires its pending printer", async () => {
  let releaseTransaction!: (response: Response) => void;

  const transaction = new Promise<Response>((resolve) => {
    releaseTransaction = resolve;
  });

  const app = mount("/inventory", {}, undefined, { transaction });
  onTestFinished(() => releaseTransaction(Response.json([])));
  await choose();
  fireEvent.change(screen.getByLabelText("Stock entry label"), { target: { value: "2" } });
  await count();
  await screen.findByText("Stock amount of Coffee is now 12 Pieces");
  await waitFor(() => expect(app.transactionSignals).toHaveLength(1));
  const oldSignal = app.transactionSignals[0]!;
  expect(oldSignal.aborted).toBe(false);
  const old = screen.getByLabelText<HTMLInputElement>("Product");
  fireEvent.change(old, { target: { value: "NEXT-DOCUMENT" } });
  await userEvent.type(old, "{Enter}");
  await userEvent.click(
    await screen.findByRole("button", { name: /Add as barcode to existing product/ }),
  );
  await waitFor(() => expect(screen.getByLabelText("Product")).not.toBe(old));
  await waitFor(() => expect(oldSignal.aborted).toBe(true));
  expect(app.router.history.location.href).toBe(
    "/inventory?flow=InplaceAddBarcodeToExistingProduct&barcode=NEXT-DOCUMENT&",
  );
  const writesBeforeRelease = app.writes.length;
  await act(async () => {
    releaseTransaction(Response.json([{ stock_id: "document-stock" }]));
  });
  expect(app.writes).toHaveLength(writesBeforeRelease);
  expect(app.writes.some((write) => write.path === "/labels")).toBe(false);
});
