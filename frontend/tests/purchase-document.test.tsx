import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";
import { overviewFixture } from "./fixtures/stock-overview";
import { productOverview } from "./fixtures/product-overview";
import type { JsonObject } from "@/lib/json";

function mount(path: string, config: JsonObject = {}, basepath?: string) {
  const writes: { path: string; body: JsonObject }[] = [];
  let stock = 2;
  let catalogProducts = [{ id: 7, name: "Coffee" }];

  const app = mountNativeEditor(
    path,
    (url, init) => {
      const pathname = new URL(url, "http://localhost").pathname;

      if (init?.method === "POST" || init?.method === "PUT") {
        const body = JSON.parse(String(init.body ?? "{}"));
        writes.push({ path: pathname, body });

        if (pathname.endsWith("/products/7/add")) {
          stock += Number(body.amount);

          return Response.json([
            {
              id: 90,
              product_id: 7,
              transaction_id: "purchase-query",
              stock_id: "query-stock",
              best_before_date: null,
            },
          ]);
        }

        return Response.json({});
      }

      if (pathname.endsWith("/api/v2/user/permissions"))
        return Response.json({ STOCK_PURCHASE: true });

      if (pathname.endsWith("/api/user/settings"))
        return Response.json({ stock_default_purchase_amount: 2 });

      if (pathname.endsWith("/api/system/config"))
        return Response.json({
          FEATURE_FLAG_STOCK: true,
          FEATURE_FLAG_SHOPPINGLIST: false,
          FEATURE_FLAG_STOCK_PRICE_TRACKING: false,
          FEATURE_FLAG_STOCK_LOCATION_TRACKING: false,
          FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: false,
          FEATURE_FLAG_DISABLE_BROWSER_BARCODE_CAMERA_SCANNING: true,
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

      if (pathname.endsWith("/api/v2/stock/purchase/editor"))
        return Response.json({
          barcode_lookup_plugin_name: "Demo",
          products: catalogProducts,
          locations: [{ id: 1, name: "Shelf", is_freezer: 0 }],
          stores: [],
          units: [{ id: 1, name: "Piece", name_plural: "Pieces" }],
          barcodes: [],
          fields: [],
          conversions: [
            {
              product_id: 7,
              from_qu_id: 1,
              to_qu_id: 1,
              factor: "1",
              to_qu_name: "Piece",
              to_qu_name_plural: "Pieces",
            },
          ],
        });

      if (pathname.endsWith("/api/stock/products/7"))
        return Response.json({
          ...productOverview,
          product: {
            ...productOverview.product,
            id: 7,
            name: "Coffee",
            description: null,
            picture_file_name: null,
            enable_tare_weight_handling: 0,
            tare_weight: 0,
            default_best_before_days: 0,
            default_best_before_days_after_freezing: 0,
            default_purchase_price_type: 1,
            default_stock_label_type: 0,
          },
          stock_amount: stock,
          quantity_unit_stock: { id: 1, name: "Piece", name_plural: "Pieces" },
          default_quantity_unit_purchase: { id: 1, name: "Piece", name_plural: "Pieces" },
          location: { id: 1, is_freezer: 0 },
          last_price: null,
          last_shopping_location_id: null,
          default_shopping_location_id: null,
          next_due_date: null,
        });

      return undefined;
    },
    {},
    { basepath },
  );

  return {
    ...app,
    writes,
    addCatalogProduct: () => {
      catalogProducts = [...catalogProducts, { id: 8, name: "Fresh tea" }];
    },
  };
}

test("an inline stock Purchase owns its embedded query without consuming or rewriting the parent history", async () => {
  const path =
    "/stock?flow=InplaceAddBarcodeToExistingProduct&barcode=PARENT&keep=one&keep=two&flag#parent";

  const app = mount(path);
  const open = await screen.findByRole<HTMLButtonElement>("button", { name: "Purchase Coffee" });
  await waitFor(() => expect(open.disabled).toBe(false));
  await userEvent.click(open);
  const dialog = await screen.findByRole("dialog", { name: "Purchase" });
  const product = within(dialog).getByLabelText<HTMLInputElement>("Product");
  await waitFor(() => expect(product.value).toBe("Coffee"));
  await userEvent.click(within(dialog).getByRole("button", { name: "OK" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Purchase" })).toBeNull());
  expect(app.writes.filter((write) => write.path.endsWith("/add"))).toHaveLength(1);
  expect(app.writes.some((write) => write.path.endsWith("/product_barcodes"))).toBe(false);
  expect(app.router.history.location.href).toBe(path);
});

test("direct Purchase completion applies all three native query transforms without reinitializing the form", async () => {
  const app = mount(
    "/purchase?product=7&flow=InplaceNewProductWithName&payload=a%26flow%3Dstill-here&keep=one&keep=two&flag#gone",
  );

  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.value).toBe("2"));
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Added 2 Pieces of Coffee to stock");
  await waitFor(() =>
    expect(app.router.history.location.href).toBe(
      "/purchase?product=7&payload=a&flow=still-here&keep=one&keep=two&flag=",
    ),
  );
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("");
  expect(app.writes.filter((write) => write.path.endsWith("/add"))).toHaveLength(1);
});

test.each([
  {
    basepath: "/house.hold",
    initial: "/house.hold/index.php/purchase",
    rewrite: false,
    canonical: "/house.hold/purchase",
  },
  {
    basepath: "/house.hold/index.php",
    initial: "/house.hold/index.php/purchase",
    rewrite: true,
    canonical: "/house.hold/index.php/purchase",
  },
])(
  "barcode completion uses configured canonical Purchase URL ($basepath, rewrite=$rewrite)",
  async ({ basepath, initial, rewrite, canonical }) => {
    const app = mount(
      `${initial}?embedded&product=7&flow=InplaceAddBarcodeToExistingProduct&barcode=NEW&keep=one#gone`,
      { BASE_URL: "/house.hold", DISABLE_URL_REWRITING: rewrite },
      basepath,
    );

    const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
    await waitFor(() => expect(amount.value).toBe("2"));
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(app.router.history.location.href).toBe(canonical));
    expect(app.writes.find((write) => write.path.endsWith("/product_barcodes"))?.body.barcode).toBe(
      "NEW",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Amount")).toBe(amount);
    expect(amount.value).toBe("2");
    expect(amount.matches(":disabled")).toBe(true);
  },
);

test("starting barcode assignment replaces the inline Purchase document and keeps the parent's query isolated", async () => {
  const path = "/stock?barcode=PARENT&flow=ParentFlow&keep=one&keep=two&flag#parent";
  const app = mount(path);
  const user = userEvent.setup();
  const open = await screen.findByRole<HTMLButtonElement>("button", { name: "Purchase Coffee" });
  await waitFor(() => expect(open.disabled).toBe(false));
  await user.click(open);
  const dialog = await screen.findByRole("dialog", { name: "Purchase" });
  const originalProduct = within(dialog).getByLabelText<HTMLInputElement>("Product");
  await waitFor(() => expect(originalProduct.value).toBe("Coffee"));
  await user.type(within(dialog).getByLabelText("Note"), "Discard this old document draft");
  app.addCatalogProduct();
  fireEvent.change(originalProduct, { target: { value: "NEW-INLINE" } });
  await user.type(originalProduct, "{Enter}");
  await user.click(
    await screen.findByRole("button", { name: /Add as barcode to existing product/ }),
  );
  await waitFor(() => expect(within(dialog).getByLabelText("Product")).not.toBe(originalProduct));
  expect(within(dialog).getByLabelText<HTMLInputElement>("Note").value).toBe("");
  expect(app.router.history.location.href).toBe(path);
  const nextProduct = within(dialog).getByLabelText<HTMLInputElement>("Product");
  expect(Array.from(nextProduct.list?.options ?? [], (option) => option.value)).toContain(
    "Fresh tea",
  );
  fireEvent.change(nextProduct, { target: { value: "Coffee" } });
  await waitFor(() =>
    expect(within(dialog).getByLabelText<HTMLInputElement>("Amount").disabled).toBe(false),
  );
  await user.click(within(dialog).getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(app.writes.find((write) => write.path.endsWith("/product_barcodes"))?.body.barcode).toBe(
      "NEW-INLINE",
    ),
  );
  expect(app.router.history.location.href).toBe(path);
  expect(app.writes.filter((write) => write.path.endsWith("/add"))).toHaveLength(1);
});

test("native FinishFlow retains the empty query marker after removing every parameter", async () => {
  const app = mount("/purchase");
  fireEvent.change(await screen.findByLabelText("Product"), { target: { value: "Coffee" } });
  const amount = screen.getByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Added 2 Pieces of Coffee to stock");
  await waitFor(() => expect(app.router.history.location.href).toBe("/purchase?"));
});
