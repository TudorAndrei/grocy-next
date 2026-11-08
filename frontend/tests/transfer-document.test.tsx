import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test } from "vitest";
import type { JsonObject } from "@/lib/json";
import { mountNativeEditor } from "./fixtures/native-editor";
import { overviewFixture } from "./fixtures/stock-overview";
import { productOverview } from "./fixtures/product-overview";

function mount(
  path: string,
  options: { basepath?: string; config?: JsonObject; barcode?: Promise<Response> } = {},
) {
  const reads: string[] = [];
  const writes: { path: string; body: JsonObject }[] = [];
  const barcodeSignals: (AbortSignal | null | undefined)[] = [];
  let precision = 2;
  let destination = "Pantry";

  const entries = [
    {
      stock_id: "stock-a",
      amount: 6,
      location_id: 1,
      best_before_date: "2030-12-24",
      purchased_date: "2026-11-01",
      open: 0,
      note: null,
    },
    {
      stock_id: "stock-b",
      amount: 4,
      location_id: 2,
      best_before_date: "2031-12-24",
      purchased_date: "2026-11-02",
      open: 0,
      note: null,
    },
  ];

  const app = mountNativeEditor(
    path,
    async (url, init) => {
      const pathname = new URL(url, "http://localhost").pathname;

      if (init?.method === "POST" || init?.method === "PUT") {
        const body = JSON.parse(String(init.body ?? "{}"));
        writes.push({ path: pathname, body });

        if (pathname.endsWith("/transfer")) {
          const amount = Number(body.amount);
          const from = entries.find((entry) => String(entry.location_id) === body.location_id_from);
          const to = entries.find((entry) => String(entry.location_id) === body.location_id_to);

          if (from) from.amount -= amount;

          if (to) to.amount += amount;

          return Response.json([
            {
              id: 90,
              product_id: 7,
              amount,
              transaction_id: "transfer-document",
              transaction_type: "transfer_from",
            },
          ]);
        }

        if (pathname.endsWith("/product_barcodes")) {
          barcodeSignals.push(init.signal);

          return options.barcode ? await options.barcode : Response.json({});
        }

        return Response.json({});
      }

      reads.push(pathname);

      if (pathname.endsWith("/api/v2/user/permissions"))
        return Response.json({ STOCK_TRANSFER: true });

      if (pathname.endsWith("/api/user/settings"))
        return Response.json({
          stock_decimal_places_amounts: precision,
          stock_default_transfer_amount: 3,
        });

      if (pathname.endsWith("/api/system/config"))
        return Response.json({
          FEATURE_FLAG_STOCK: true,
          FEATURE_FLAG_SHOPPINGLIST: false,
          FEATURE_FLAG_RECIPES: false,
          FEATURE_FLAG_STOCK_LOCATION_TRACKING: true,
          FEATURE_FLAG_DISABLE_BROWSER_BARCODE_CAMERA_SCANNING: true,
          ...options.config,
        });

      if (pathname.endsWith("/api/v2/stock/transfer/editor"))
        return Response.json({
          barcode_lookup_plugin_name: "Demo",
          products: [
            { id: 7, name: "Coffee" },
            { id: 8, name: "Tea" },
          ],
          locations: [
            { id: 1, name: "Shelf", is_freezer: 0 },
            { id: 2, name: destination, is_freezer: 0 },
          ],
          units: [{ id: 1, name: "Piece", name_plural: "Pieces" }],
          barcodes: [],
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
        const id = pathname.endsWith("/8") ? 8 : 7;

        return Response.json({
          ...productOverview,
          product: {
            ...productOverview.product,
            id,
            name: id === 7 ? "Coffee" : "Tea",
            description: null,
            enable_tare_weight_handling: 0,
            should_not_be_frozen: 0,
          },
          stock_amount: 10,
          quantity_unit_stock: { id: 1, name: "Piece", name_plural: "Pieces" },
          location: { id: 1 },
        });
      }

      if (/\/api\/stock\/products\/[78]\/locations$/.test(pathname))
        return Response.json([
          { location_id: 1, location_name: "Shelf", location_is_freezer: 0 },
          { location_id: 2, location_name: destination, location_is_freezer: 0 },
        ]);

      if (/\/api\/stock\/products\/[78]\/entries$/.test(pathname)) return Response.json(entries);

      if (pathname.endsWith("/api/objects/product_barcodes_view")) return Response.json([]);

      if (pathname.endsWith("/api/objects/products")) return Response.json([]);

      if (pathname.endsWith("/api/v2/stock/overview"))
        return Response.json(
          overviewFixture([
            { product_id: 7, product: { id: 7, name: "Coffee", location_id: 1 }, amount: 10 },
          ]),
        );

      if (pathname.endsWith("/api/stock")) return Response.json([]);

      if (pathname.endsWith("/api/stock/volatile"))
        return Response.json({
          due_products: [],
          overdue_products: [],
          expired_products: [],
          missing_products: [],
        });

      return undefined;
    },
    {},
    { basepath: options.basepath },
  );

  return {
    ...app,
    reads,
    writes,
    barcodeSignals,
    refreshDefaults: () => {
      precision = 1;
      destination = "New pantry";
    },
  };
}

async function ready(container = document.body) {
  const ui = within(container);
  await waitFor(() => {
    expect(ui.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("1");
    expect(ui.getByLabelText<HTMLSelectElement>("From location").value).toBe("1");
    expect(
      [...ui.getByLabelText<HTMLSelectElement>("Specific stock item").options].map(
        (option) => option.value,
      ),
    ).toContain("stock-a");
  });

  return ui.getByLabelText<HTMLInputElement>("Amount");
}

async function choose(container = document.body) {
  const product = await within(container).findByLabelText<HTMLInputElement>("Product");
  fireEvent.change(product, { target: { value: "Coffee" } });
  fireEvent.keyDown(product, { key: "Enter" });
  await ready(container);

  return product;
}

async function move(container = document.body) {
  const ui = within(container);
  const amount = await ready(container);
  fireEvent.change(amount, { target: { value: "2" } });
  await userEvent.selectOptions(ui.getByLabelText("To location"), "2");
  await userEvent.click(ui.getByRole("button", { name: "OK" }));

  return amount;
}

test("Transfer uses first literal product, source, and stock parameters for its selected booking", async () => {
  const app = mount(
    "/transfer?embedded&product=7&product=8&locationId=1&locationId=2&stockId=stock-a&stockId=stock-b",
  );

  await ready();
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("Coffee");
  expect(screen.getByLabelText<HTMLInputElement>("Use a specific stock item").checked).toBe(true);
  expect(screen.getByLabelText<HTMLSelectElement>("Specific stock item").value).toBe("stock-a");
  await move();
  await waitFor(() =>
    expect(app.writes.find((write) => write.path.endsWith("/transfer"))?.body).toEqual({
      amount: "2.",
      location_id_from: "1",
      location_id_to: "2",
      stock_entry_id: "stock-a",
    }),
  );
  expect(app.writes.find((write) => write.path.endsWith("/transfer"))?.path).toBe(
    "/api/stock/products/7/transfer",
  );
});

test.each([
  { query: "product=7", embeddedMarkup: false },
  { query: "product=7&flow=InplaceNewProductWithName", embeddedMarkup: false },
  { query: "product=7&flow=InplaceAddBarcodeToExistingProduct&barcode=NEW", embeddedMarkup: false },
  { query: "product=7&%65mbedded", embeddedMarkup: true },
])(
  "Transfer only prefills its picker without literal embedded bootstrap ($query)",
  async ({ query, embeddedMarkup }) => {
    const app = mount(`/transfer?${query}`);
    const product = await screen.findByLabelText<HTMLInputElement>("Product");
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    expect(product.value).toBe("Coffee");
    expect(Boolean(document.querySelector(".embedded-main"))).toBe(embeddedMarkup);
    expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("");
    expect(app.reads.filter((path) => /\/stock\/products\/[78]$/.test(path))).toEqual([]);
    expect(app.writes).toEqual([]);
  },
);

test("an explicit empty Transfer product name keeps the initial blank option", async () => {
  const app = mount("/transfer?embedded&product-name=");
  const product = await screen.findByLabelText<HTMLInputElement>("Product");
  await act(async () => {
    await new Promise(requestAnimationFrame);
  });
  expect(product.value).toBe("");
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("");
  expect(app.reads.filter((path) => /\/stock\/products\/[78]$/.test(path))).toEqual([]);
});

test("literal embedded Transfer initializes the selected product and source entries", async () => {
  const app = mount("/transfer?embedded&product=7");
  await ready();
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("Coffee");
  expect(screen.getByLabelText<HTMLInputElement>("Use a specific stock item").checked).toBe(false);
  expect(app.reads).toContain("/api/stock/products/7/locations");
  expect(app.reads).toContain("/api/stock/products/7/entries");
});

test("late Transfer barcode completion uses canonical history without replacing the embedded form", async () => {
  let release!: (response: Response) => void;

  const barcode = new Promise<Response>((resolve) => {
    release = resolve;
  });

  onTestFinished(() => release(Response.json({})));

  const app = mount(
    "/house.hold/index.php/transfer?embedded&product=7&flow=InplaceAddBarcodeToExistingProduct&barcode=NEW&keep=one#gone",
    {
      basepath: "/house.hold",
      config: { BASE_URL: "/house.hold", DISABLE_URL_REWRITING: false },
      barcode,
    },
  );

  const amount = await move();
  await waitFor(() => expect(app.barcodeSignals).toHaveLength(1));
  await waitFor(() => expect(amount.matches(":disabled")).toBe(true));
  await act(async () => {
    release(Response.json({}));
  });
  await waitFor(() => expect(app.router.history.location.href).toBe("/house.hold/transfer"));
  expect(screen.getByLabelText("Amount")).toBe(amount);
  expect(amount.matches(":disabled")).toBe(true);
  expect(app.writes.find((write) => write.path.endsWith("/product_barcodes"))?.body.barcode).toBe(
    "NEW",
  );
});

test("an inline Transfer never consumes or replaces the parent Stock query", async () => {
  const path =
    "/stock?flow=InplaceAddBarcodeToExistingProduct&barcode=PARENT&keep=one&keep=two&flag#parent";

  const app = mount(path);
  const open = await screen.findByRole<HTMLButtonElement>("button", { name: "Transfer Coffee" });
  await waitFor(() => expect(open.disabled).toBe(false));
  await userEvent.click(open);
  const dialog = await screen.findByRole("dialog", { name: "Transfer" });
  await move(dialog);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Transfer" })).toBeNull());
  expect(app.writes.some((write) => write.path.endsWith("/product_barcodes"))).toBe(false);
  expect(app.router.history.location.href).toBe(path);
});

test("Assign creates a fresh inline Transfer catalog, settings, and draft without changing its parent", async () => {
  const path = "/stock?flow=ParentFlow&barcode=PARENT&keep=one#parent";
  const app = mount(path);
  const open = await screen.findByRole<HTMLButtonElement>("button", { name: "Transfer Coffee" });
  await waitFor(() => expect(open.disabled).toBe(false));
  await userEvent.click(open);
  const dialog = await screen.findByRole("dialog", { name: "Transfer" });
  const ui = within(dialog);
  const amount = await ready(dialog);
  fireEvent.change(amount, { target: { value: "4" } });
  await userEvent.selectOptions(ui.getByLabelText("To location"), "2");
  const old = ui.getByLabelText<HTMLInputElement>("Product");
  app.refreshDefaults();
  fireEvent.change(old, { target: { value: "INLINE-NEW" } });
  await userEvent.type(old, "{Enter}");
  await userEvent.click(
    await screen.findByRole("button", { name: /Add as barcode to existing product/ }),
  );
  await waitFor(() => expect(ui.getByLabelText("Product")).not.toBe(old));
  expect(ui.getByLabelText<HTMLInputElement>("Amount").step).toBe("0.1");
  expect(ui.getByLabelText<HTMLInputElement>("Amount").value).not.toBe("4");
  expect(ui.getByLabelText<HTMLSelectElement>("To location").value).toBe("");
  expect(
    within(ui.getByLabelText("To location")).getByRole("option", { name: "New pantry" }),
  ).toBeTruthy();
  expect(app.router.history.location.href).toBe(path);
  await choose(dialog);
  await move(dialog);
  await waitFor(() =>
    expect(app.writes.find((write) => write.path.endsWith("/product_barcodes"))?.body.barcode).toBe(
      "INLINE-NEW",
    ),
  );
  expect(app.router.history.location.href).toBe(path);
});

test("physical Assign retires an older Transfer barcode request so it cannot rewrite the new document", async () => {
  let release!: (response: Response) => void;

  const barcode = new Promise<Response>((resolve) => {
    release = resolve;
  });

  onTestFinished(() => release(Response.json({})));

  const app = mount("/transfer?product=7&flow=InplaceAddBarcodeToExistingProduct&barcode=FIRST", {
    barcode,
  });

  await choose();
  await move();
  await screen.findByText(/^Transfered 2 Pieces of Coffee from .* to Pantry$/);
  await waitFor(() => expect(app.barcodeSignals).toHaveLength(1));
  const oldSignal = app.barcodeSignals[0]!;
  expect(oldSignal.aborted).toBe(false);
  const old = screen.getByLabelText<HTMLInputElement>("Product");
  fireEvent.change(old, { target: { value: "SECOND" } });
  await userEvent.type(old, "{Enter}");
  await userEvent.click(
    await screen.findByRole("button", { name: /Add as barcode to existing product/ }),
  );
  await waitFor(() => expect(screen.getByLabelText("Product")).not.toBe(old));
  await waitFor(() => expect(oldSignal.aborted).toBe(true));
  const next = "/transfer?flow=InplaceAddBarcodeToExistingProduct&barcode=SECOND&";
  expect(app.router.history.location.href).toBe(next);
  await act(async () => {
    release(Response.json({}));
  });
  expect(app.router.history.location.href).toBe(next);
  expect(app.writes.filter((write) => write.path.endsWith("/transfer"))).toHaveLength(1);
});
