import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";
import { overviewFixture } from "./fixtures/stock-overview";
import { productOverview } from "./fixtures/product-overview";
import type { JsonObject } from "@/lib/json";

function mount(
  path: string,
  config: JsonObject = {},
  basepath?: string,
  settings: JsonObject = {},
) {
  const writes: { path: string; body: JsonObject }[] = [];
  const reads: string[] = [];
  let stock = 10;

  const app = mountNativeEditor(
    path,
    (url, init) => {
      const pathname = new URL(url, "http://localhost").pathname;

      if (init?.method === "POST" || init?.method === "PUT") {
        const body = JSON.parse(String(init.body ?? "{}"));
        writes.push({ path: pathname, body });

        if (/\/products\/[78]\/consume$/.test(pathname)) {
          stock -= Number(body.amount);

          return Response.json([
            { id: 90, product_id: 7, transaction_id: "consume-query", stock_id: "query-stock" },
          ]);
        }

        return Response.json({});
      }

      reads.push(pathname);

      if (pathname.endsWith("/api/v2/user/permissions"))
        return Response.json({ STOCK_CONSUME: true, STOCK_OPEN: true });

      if (pathname.endsWith("/api/user/settings"))
        return Response.json({ stock_default_consume_amount: 2, ...settings });

      if (pathname.endsWith("/api/system/config"))
        return Response.json({
          FEATURE_FLAG_STOCK: true,
          FEATURE_FLAG_SHOPPINGLIST: false,
          FEATURE_FLAG_STOCK_LOCATION_TRACKING: true,
          FEATURE_FLAG_RECIPES: false,
          FEATURE_FLAG_STOCK_PRODUCT_OPENED_TRACKING: true,
          FEATURE_FLAG_DISABLE_BROWSER_BARCODE_CAMERA_SCANNING: true,
          ...config,
        });

      if (pathname.endsWith("/api/v2/stock/overview"))
        return Response.json(
          overviewFixture(
            [{ product_id: 7, product: { id: 7, name: "Coffee" }, amount: stock }],
            "Shelf",
          ),
        );

      if (pathname.endsWith("/api/stock")) return Response.json([]);

      if (pathname.endsWith("/api/stock/volatile"))
        return Response.json({
          due_products: [],
          overdue_products: [],
          expired_products: [],
          missing_products: [],
        });

      if (pathname.endsWith("/api/v2/stock/consume/editor"))
        return Response.json({
          barcode_lookup_plugin_name: "Demo",
          products: [
            { id: 7, name: "Coffee" },
            { id: 8, name: "Tea" },
          ],
          locations: [{ id: 1, name: "Shelf", is_freezer: 0 }],
          recipes: [],
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
            picture_file_name: null,
            enable_tare_weight_handling: 0,
            tare_weight: 0,
            default_consume_location_id: 1,
            quick_consume_amount: 1,
            disable_open: 0,
            move_on_open: 0,
          },
          stock_amount: stock,
          stock_amount_opened: 0,
          has_childs: false,
          quantity_unit_stock: { id: 1, name: "Piece", name_plural: "Pieces" },
          default_quantity_unit_consume: { id: 1, name: "Piece", name_plural: "Pieces" },
          location: { id: 1 },
          default_consume_location: { name: "Shelf" },
        });
      }

      if (/\/api\/stock\/products\/[78]\/locations$/.test(pathname))
        return Response.json([{ location_id: 1, location_name: "Shelf", amount: stock }]);

      if (/\/api\/stock\/products\/[78]\/entries$/.test(pathname))
        return Response.json([
          {
            id: 101,
            stock_id: "query-stock",
            amount: stock,
            amount_aggregated: stock,
            location_id: 1,
            best_before_date: "2030-12-24",
            purchased_date: "2026-11-01",
            open: 0,
            note: null,
          },
        ]);

      return undefined;
    },
    {},
    { basepath },
  );

  return { ...app, writes, reads };
}

async function choose() {
  const product = await screen.findByLabelText<HTMLInputElement>("Product");
  await userEvent.clear(product);
  fireEvent.change(product, { target: { value: "Coffee" } });
  await ready();

  return screen.getByLabelText<HTMLInputElement>("Amount");
}

async function ready(container = document.body) {
  const ui = within(container);
  await waitFor(() => {
    expect(ui.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("1");
    expect(ui.getByLabelText<HTMLSelectElement>("Location").value).toBe("1");
    expect(
      Array.from(
        ui.getByLabelText<HTMLSelectElement>("Specific stock item").options,
        (option) => option.value,
      ),
    ).toContain("query-stock");
    expect(ui.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(false);
  });

  return ui.getByRole<HTMLButtonElement>("button", { name: "OK" });
}

test("Consume initial product selection uses the first literal duplicate parameter", async () => {
  const app = mount("/consume?embedded&product=7&product=8");
  await waitFor(async () =>
    expect((await screen.findByLabelText<HTMLInputElement>("Product")).value).toBe("Coffee"),
  );
  await ready();
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(app.writes.find((write) => write.path.endsWith("/consume"))?.path).toBe(
      "/api/stock/products/7/consume",
    ),
  );
});

test("PHP-embedded markup does not replay Consume's literal-key bootstrap for an encoded key", async () => {
  const app = mount("/consume?%65mbedded&product=7", {}, undefined, {
    scan_mode_consume_enabled: true,
  });

  const product = await screen.findByLabelText<HTMLInputElement>("Product");
  await act(async () => {
    await new Promise(requestAnimationFrame);
  });
  expect(product.value).toBe("Coffee");
  expect(screen.queryByRole("button", { name: /Scan mode/ })).toBeNull();
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("");
  expect(app.reads.filter((path) => /\/stock\/products\/[78]$/.test(path))).toEqual([]);
  expect(app.writes).toEqual([]);
});

test.each([
  {
    query: "flow=InplaceNewProductWithName&barcode=OLD&product-name=Coffee",
    expected: "/consume?",
  },
  {
    query:
      "flow=InplaceNewProductWithName&product-name=Coffee&payload=a%26flow%3Dstill-here&keep=one&keep=two&flag#gone",
    expected: "/consume?payload=a&flow=still-here&keep=one&keep=two&flag=",
  },
])(
  "Consume FinishFlow preserves native three-pass history ($expected)",
  async ({ query, expected }) => {
    const app = mount(`/consume?${query}`);
    await choose();
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Removed 2 Pieces of Coffee from stock");
    await waitFor(() => expect(app.router.history.location.href).toBe(expected));
    expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("");
    expect(app.writes.filter((write) => write.path.endsWith("/consume"))).toHaveLength(1);
  },
);

test.each([
  { basepath: "/house.hold", rewrite: false, canonical: "/house.hold/consume" },
  { basepath: "/house.hold/index.php", rewrite: true, canonical: "/house.hold/index.php/consume" },
])(
  "embedded Consume barcode completion changes history without replacing its document ($basepath)",
  async ({ basepath, rewrite, canonical }) => {
    const app = mount(
      "/house.hold/index.php/consume?embedded&product=7&flow=InplaceAddBarcodeToExistingProduct&barcode=NEW&keep=one#gone",
      {
        BASE_URL: "/house.hold",
        DISABLE_URL_REWRITING: rewrite,
      },
      basepath,
    );

    const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(app.router.history.location.href).toBe(canonical));
    expect(app.writes.find((write) => write.path.endsWith("/product_barcodes"))?.body.barcode).toBe(
      "NEW",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Amount")).toBe(amount);
    expect(amount.matches(":disabled")).toBe(true);
  },
);

test("an inline Consume does not read or replace its parent Stock document query", async () => {
  const path =
    "/stock?flow=InplaceAddBarcodeToExistingProduct&barcode=PARENT&keep=one&keep=two&flag#parent";

  const app = mount(path);
  const open = await screen.findByRole<HTMLButtonElement>("button", { name: "Consume Coffee" });
  await waitFor(() => expect(open.disabled).toBe(false));
  await userEvent.click(open);
  const dialog = await screen.findByRole("dialog", { name: "Consume" });
  const save = await ready(dialog);
  await userEvent.click(save);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Consume" })).toBeNull());
  expect(app.writes.some((write) => write.path.endsWith("/product_barcodes"))).toBe(false);
  expect(app.router.history.location.href).toBe(path);
});

test("inline barcode assignment replaces only the Consume child document", async () => {
  const path = "/stock?flow=ParentFlow&barcode=PARENT&keep=one#parent";
  const app = mount(path);
  const user = userEvent.setup();
  const open = await screen.findByRole<HTMLButtonElement>("button", { name: "Consume Coffee" });
  await waitFor(() => expect(open.disabled).toBe(false));
  await user.click(open);
  const dialog = await screen.findByRole("dialog", { name: "Consume" });
  const product = within(dialog).getByLabelText<HTMLInputElement>("Product");
  await ready(dialog);
  await user.click(within(dialog).getByLabelText("Spoiled"));
  fireEvent.change(product, { target: { value: "NEW-INLINE" } });
  await user.type(product, "{Enter}");
  await user.click(
    await screen.findByRole("button", { name: /Add as barcode to existing product/ }),
  );
  await waitFor(() => expect(within(dialog).getByLabelText("Product")).not.toBe(product));
  expect(within(dialog).getByLabelText<HTMLInputElement>("Spoiled").checked).toBe(false);
  expect(app.router.history.location.href).toBe(path);
  fireEvent.change(within(dialog).getByLabelText("Product"), { target: { value: "Coffee" } });
  const save = await ready(dialog);
  await user.click(save);
  await waitFor(() =>
    expect(app.writes.find((write) => write.path.endsWith("/product_barcodes"))?.body.barcode).toBe(
      "NEW-INLINE",
    ),
  );
  expect(app.router.history.location.href).toBe(path);
});
