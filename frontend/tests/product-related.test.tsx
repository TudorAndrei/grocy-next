import { supportProductOptions } from "./fixtures/product-options";
import { supportDescriptionEditors } from "./fixtures/editor";
import { z } from "zod";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import { writeApiConfig } from "@/lib/config";
import type { EntityRow } from "@/lib/entities";
import type { JsonObject } from "@/lib/json";
import { pictureBytes } from "./fixtures/picture";

beforeEach(() => {
  for (const method of ["showModal", "close"] as const) {
    const original = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method);
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = method === "showModal";
      },
    });
    onTestFinished(() => {
      if (original) Object.defineProperty(HTMLDialogElement.prototype, method, original);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
    });
  }
});

function mount(
  options: {
    creating?: boolean;
    copying?: boolean;
    copyFailure?: boolean;
    tare?: boolean;
    fieldFailure?: boolean;
    holdBarcode?: boolean;
    productFailure?: boolean;
    prices?: boolean;
  } = {},
) {
  writeApiConfig({ baseUrl: "/house", apiKey: "catalog-key" });
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:grocycode";
      static revokeObjectURL = () => {};
    },
  );

  const product: EntityRow = {
    id: 7,
    name: "Coffee",
    location_id: 1,
    qu_id_stock: 1,
    qu_id_purchase: 2,
    qu_id_consume: 1,
    qu_id_price: 1,
    active: 1,
  };

  if (options.copying)
    Object.assign(product, {
      active: 0,
      description: "<p>Source <strong>description</strong></p>",
      qu_id_consume: 3,
      qu_id_price: 2,
      default_best_before_days: 20,
      enable_tare_weight_handling: 1,
      tare_weight: 120,
      due_type: 2,
      should_not_be_frozen: 1,
      disable_open: 1,
      default_purchase_price_type: 3,
      treat_opened_as_out_of_stock: 0,
      picture_file_name: "source.png",
      userfields: { Owner: "Source owner" },
      parent_product_id: 9,
      min_stock_amount: 9,
    });

  if (options.tare) Object.assign(product, { enable_tare_weight_handling: 0, tare_weight: 120 });

  const products: EntityRow[] = options.creating ? [] : [product];

  const barcodes: EntityRow[] = [
    {
      id: 21,
      product_id: 7,
      barcode: "CODE",
      amount: 2,
      qu_id: 2,
      shopping_location_id: 3,
      note: "Saved note",
      userfields: { Origin: "Domestic" },
    },
    { id: 99, product_id: 99, barcode: "OTHER", amount: 1, qu_id: 1 },
  ];

  const conversions: EntityRow[] = [
    { id: 10, product_id: 7, from_qu_id: 2, to_qu_id: 1, factor: 6 },
    { id: 11, product_id: null, from_qu_id: 3, to_qu_id: 2, factor: 4 },
  ];

  const units = [
    { id: 1, name: "Piece", active: 1 },
    { id: 2, name: "Box", active: 1 },
    { id: 3, name: "Crate", active: 1 },
    { id: 4, name: "Inactive", active: 0 },
    { id: 5, name: "Unconnected", active: 1 },
  ];

  const resolved = [
    { id: 1, product_id: 7, from_qu_id: 1, to_qu_id: 1, factor: 1 },
    { id: 2, product_id: 7, from_qu_id: 1, to_qu_id: 2, factor: 1 / 6 },
    { id: 3, product_id: 7, from_qu_id: 1, to_qu_id: 3, factor: 1 / 24 },
    { id: 4, product_id: 7, from_qu_id: 2, to_qu_id: 1, factor: 6 },
    { id: 5, product_id: 7, from_qu_id: 2, to_qu_id: 3, factor: 1 / 4 },
    { id: 6, product_id: 7, from_qu_id: 2, to_qu_id: 4, factor: 3 },
    { id: 7, product_id: 7, from_qu_id: 3, to_qu_id: 2, factor: 4 },
  ];

  const fields = [
    ...(options.copying
      ? [
          {
            id: 3,
            entity: "products",
            name: "Owner",
            caption: "Owner",
            type: "text-single-line",
            input_required: 1,
            default_value: "Preset owner",
            config: null,
            show_as_column_in_tables: 0,
          },
        ]
      : []),
    {
      id: 1,
      entity: "product_barcodes",
      name: "Origin",
      caption: "Origin",
      type: "text-single-line",
      input_required: 0,
      default_value: null,
      config: null,
      show_as_column_in_tables: 1,
    },
    {
      id: 2,
      entity: "quantity_unit_conversions",
      name: "Reason",
      caption: "Reason",
      type: "text-single-line",
      input_required: 0,
      default_value: null,
      config: null,
      show_as_column_in_tables: 0,
    },
  ];

  const writes: { path: string; method: string; body: JsonObject }[] = [];
  let copyAttempts = 0;
  let fieldAttempts = 0;
  let productAttempts = 0;
  let releaseBarcode: (() => void) | undefined;

  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), "http://test.invalid");
    const path = url.pathname.replace(/^\/house/, "");
    const method = init?.method ?? "GET";
    const body: JsonObject = init?.body ? JSON.parse(String(init.body)) : {};

    if (method !== "GET") writes.push({ path, method, body });

    if (path === "/api/v2/shopping-lists/1")
      return Response.json({ id: 1, name: "Groceries", items: [] });

    if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

    if (path === "/api/user") return Response.json([{ id: 1, username: "test" }]);

    if (path === "/api/system/config")
      return Response.json({ FEATURE_FLAG_STOCK_PRICE_TRACKING: options.prices !== false });

    if (path === "/api/user/settings")
      return Response.json({
        product_presets_location_id: 1,
        product_presets_qu_id: options.copying ? 3 : 1,
        product_presets_default_due_days: options.copying ? 99 : 0,
        product_presets_treat_opened_as_out_of_stock: true,
        stock_decimal_places_amounts: 4,
      });

    if (path === "/api/objects/locations") return Response.json([{ id: 1, name: "Shelf" }]);

    if (path === "/api/objects/shopping_locations")
      return Response.json([{ id: 3, name: "Corner store", active: 1 }]);

    if (path === "/api/objects/quantity_units") return Response.json(units);

    if (path === "/api/objects/userfields") return Response.json(fields);

    if (/^\/api\/v2\/products\/(7|8)\/grocycode$/.test(path))
      return new Response(pictureBytes, { headers: { "Content-Type": "image/png" } });

    if (path === "/api/objects/products" && method === "POST") {
      if (options.copying)
        products.push({ ...body, id: 8, tare_weight: 0, picture_file_name: null });
      else {
        Object.assign(product, body);
        products.push(product);
      }

      return Response.json({ created_object_id: options.copying ? "8" : "7" });
    }

    if (path === "/api/objects/products/7" && method === "PUT") {
      if (options.productFailure && ++productAttempts === 1)
        return Response.json({ error_message: "Product save failed" }, { status: 500 });
      Object.assign(product, body);

      return new Response(null, { status: 204 });
    }

    if (path === "/api/objects/products/7" && method === "GET" && options.copying) {
      if (options.copyFailure && ++copyAttempts === 1)
        return Response.json({ error_message: "Source load failed" }, { status: 503 });

      return Response.json(product);
    }

    if (path === "/api/objects/products/9")
      return Response.json({ id: 9, name: "Parent", cumulate_min_stock_amount_of_sub_products: 1 });

    if (path === "/api/objects/products")
      return Response.json(options.copying ? [...products, { id: 9, name: "Parent" }] : products);

    if (path.startsWith("/api/files/productpictures/"))
      return new Response(pictureBytes, { headers: { "Content-Type": "image/png" } });

    if (path === "/api/objects/products/8" && method === "PUT") {
      Object.assign(
        products.find((row) => row.id === 8)!,
        body,
      );

      return new Response(null, { status: 204 });
    }

    const tables = new Map<string, EntityRow[]>([
      ["products", products],
      ["product_barcodes", barcodes],
      ["quantity_unit_conversions", conversions],
      ["quantity_unit_conversions_resolved", resolved],
    ]);

    const object = /^\/api\/objects\/([^/]+)(?:\/(\d+))?$/.exec(path);
    const rows = object ? tables.get(object[1]) : undefined;

    if (object && rows) {
      const apiBody = { ...body };

      if (object[1] === "product_barcodes") {
        for (const key of ["amount", "qu_id", "shopping_location_id", "note"])
          if (apiBody[key] === "") apiBody[key] = null;
      }

      if (method === "POST") {
        rows.push({ ...apiBody, id: 22 });

        return Response.json({ created_object_id: "22" });
      }

      const index = rows.findIndex((row) => row.id === Number(object[2]));

      if (method === "PUT") {
        if (index < 0) return Response.json({ error_message: "Missing row" }, { status: 404 });
        Object.assign(rows[index]!, apiBody);

        if (options.holdBarcode && object[1] === "product_barcodes") {
          options.holdBarcode = false;
          await new Promise<void>((resolve) => {
            releaseBarcode = resolve;
          });
        }

        return new Response(null, { status: 204 });
      }

      if (method === "DELETE") {
        if (index < 0) return Response.json({ error_message: "Missing row" }, { status: 404 });
        rows.splice(index, 1);

        return new Response(null, { status: 204 });
      }

      const filter = url.searchParams.get("query[]");

      return Response.json(
        filter ? rows.filter((row) => row.product_id === Number(filter.split("=")[1])) : rows,
      );
    }

    const custom = /^\/api\/userfields\/([^/]+)\/(\d+)$/.exec(path);

    if (custom && method === "PUT") {
      if (options.fieldFailure && ++fieldAttempts === 1)
        return Response.json({ error_message: "Field save failed" }, { status: 500 });
      const row = tables.get(custom[1])?.find((row) => row.id === Number(custom[2]));

      if (row)
        row.userfields = {
          ...row.userfields,
          ...z.record(z.string(), z.string().nullable()).parse(body),
        };

      return new Response(null, { status: 204 });
    }

    return Response.json([]);
  });

  vi.stubGlobal("fetch", transport);
  supportProductOptions();
  supportDescriptionEditors();

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [
        options.copying ? "/products" : options.creating ? "/product/new" : "/product/7",
      ],
    }),
  });

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return {
    router,
    product,
    products,
    barcodes,
    conversions,
    writes,
    releaseBarcode: () => releaseBarcode?.(),
  };
}

async function availableButton(name: string | RegExp) {
  const button = await screen.findByRole<HTMLButtonElement>("button", { name });
  await waitFor(() => expect(button.disabled).toBe(false));

  return button;
}

test.each(["button", "keyboard"])(
  "%s saves continue after creation and return to the catalog after editing",
  async (mode) => {
    const { router, products } = mount({ creating: true });
    const user = userEvent.setup();
    const form = within(await screen.findByRole("form", { name: "Add product" }));
    expect(screen.queryByRole("button", { name: "Add barcode" })).toBeNull();
    await user.type(form.getByLabelText("Name"), "New coffee");

    if (mode === "button") await user.click(form.getByRole("button", { name: "Save & continue" }));
    else await user.keyboard("{Enter}");
    await availableButton("Add barcode");
    expect(router.state.location.pathname).toBe("/product/7");
    expect(products).toHaveLength(1);
    expect(await screen.findByRole("img", { name: "New coffee Grocycode" })).toBeTruthy();

    if (mode === "button") await user.click(await availableButton("Save & return to products"));
    else {
      await user.click(screen.getByLabelText("Name"));
      await user.keyboard("{Enter}");
    }

    await waitFor(() => expect(router.state.location.href).toBe("/products?product=7"));
  },
);

test("barcode creation uses product units and retries fields on the created barcode before reloading the parent", async () => {
  const { barcodes, product, writes } = mount({ fieldFailure: true });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Name"), " draft");
  await user.click(await availableButton("Add barcode"));
  const form = within(await screen.findByRole("dialog", { name: "Create Barcode" }));
  const unit = await form.findByLabelText<HTMLSelectElement>("Unit");
  expect(unit.value).toBe("");
  expect(form.getByLabelText<HTMLInputElement>("Amount").value).toBe("");
  expect(
    within(unit)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["None", "Box", "Piece", "Crate", "Inactive"]);
  await user.type(form.getByLabelText("Barcode"), "NEW");
  await user.type(form.getByLabelText("Amount"), "3");
  await user.selectOptions(unit, "3");
  await user.selectOptions(form.getByLabelText("Store"), "3");
  await user.type(form.getByLabelText("Origin"), "Imported");
  await user.click(form.getByRole("button", { name: "Save barcode" }));
  await form.findByText("Field save failed");
  expect(barcodes.filter((row) => row.barcode === "NEW")).toHaveLength(1);
  expect(product.name).toBe("Coffee");
  await user.click(form.getByRole("button", { name: "Save barcode" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Coffee");
  expect(barcodes.find((row) => row.barcode === "NEW")).toMatchObject({
    product_id: 7,
    amount: 3,
    qu_id: 3,
    shopping_location_id: 3,
    userfields: { Origin: "Imported" },
  });
  const row = screen.getByRole("row", { name: /NEW.*Corner store.*Crate.*3.*Imported/ });
  expect(row).toBeTruthy();
  expect(
    writes.filter(
      (write) => write.path === "/api/objects/product_barcodes" && write.method === "POST",
    ),
  ).toHaveLength(1);
});

test("barcode edits wait for both independent writes when a custom field fails", async () => {
  const { barcodes, releaseBarcode, writes } = mount({
    fieldFailure: true,
    holdBarcode: true,
    prices: false,
  });

  const user = userEvent.setup();
  const edit = await screen.findByRole<HTMLButtonElement>("button", { name: /Edit.*CODE/ });
  await waitFor(() => expect(edit.disabled).toBe(false));
  await user.click(edit);
  const form = within(await screen.findByRole("dialog", { name: "Edit Barcode" }));
  await user.clear(await form.findByLabelText("Amount"));
  await user.type(form.getByLabelText("Origin"), " changed");
  expect(form.queryByLabelText("Store")).toBeNull();
  await user.click(form.getByRole("button", { name: "Save barcode" }));
  await waitFor(() =>
    expect(writes.some((write) => write.path === "/api/userfields/product_barcodes/21")).toBe(true),
  );
  expect(barcodes[0]).toMatchObject({ amount: null, shopping_location_id: 1 });
  expect(
    writes.find((write) => write.path === "/api/objects/product_barcodes/21")?.body.amount,
  ).toBe("");
  expect(form.getByRole<HTMLButtonElement>("button", { name: "Save barcode" }).disabled).toBe(true);
  releaseBarcode();
  await form.findByText("Field save failed");
  await user.click(form.getByRole("button", { name: "Save barcode" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(barcodes[0]?.userfields?.Origin).toBe("Domestic changed");
});

test("product conversions use the stock unit, reject equal units, and save fields after the row", async () => {
  const { conversions, writes } = mount();
  const user = userEvent.setup();
  await user.click(await availableButton("Add conversion"));

  const form = within(
    await screen.findByRole("dialog", { name: "Create quantity unit conversion" }),
  );

  const from = await form.findByLabelText<HTMLSelectElement>("From unit");
  expect(from.value).toBe("1");
  expect(form.getByLabelText<HTMLInputElement>("Conversion factor").value).toBe("1");
  await user.selectOptions(form.getByLabelText("To unit"), "1");
  await user.click(form.getByRole("button", { name: "Save conversion" }));
  expect(writes).toEqual([]);
  await user.selectOptions(from, "3");
  await user.clear(form.getByLabelText("Conversion factor"));
  await user.type(form.getByLabelText("Conversion factor"), "24");
  await user.type(form.getByLabelText("Reason"), "Case size");
  await user.click(form.getByRole("button", { name: "Save conversion" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(conversions.find((row) => row.id === 22)).toMatchObject({
    product_id: 7,
    from_qu_id: 3,
    to_qu_id: 1,
    factor: 24,
    userfields: { Reason: "Case size" },
  });
  expect(writes.map((write) => write.path)).toEqual([
    "/api/objects/quantity_unit_conversions",
    "/api/userfields/quantity_unit_conversions/22",
  ]);
  await user.click(screen.getByRole("button", { name: "Show resolved conversions" }));
  const resolved = within(screen.getByRole("table", { name: "Resolved conversions" }));
  expect(resolved.getByRole("row", { name: "Crate Box 4" })).toBeTruthy();
  expect(resolved.queryByRole("button")).toBeNull();
});

test.each([
  ["barcode", /Delete.*CODE/, "/api/objects/product_barcodes/21"],
  ["conversion", /Delete.*Box.*Piece/, "/api/objects/quantity_unit_conversions/10"],
])(
  "deleting a %s saves the product draft and retries it without another deletion",
  async (_kind, button, path) => {
    const { product, writes } = mount({ productFailure: true });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), " changed");
    await user.click(await availableButton(button));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "No" }));
    expect(writes).toEqual([]);
    await user.click(screen.getByRole("button", { name: button }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes" }));
    const dialog = within(screen.getByRole("dialog"));
    await dialog.findByText("Product save failed");
    expect(product.name).toBe("Coffee");
    await user.click(dialog.getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(product.name).toBe("Coffee changed");
    expect(writes.map((write) => [write.path, write.method])).toEqual([
      [path, "DELETE"],
      ["/api/objects/products/7", "PUT"],
      ["/api/objects/products/7", "PUT"],
    ]);
  },
);

test("empty optional barcode fields retain the native explicit empty values", async () => {
  const { writes } = mount();
  const user = userEvent.setup();
  await user.click(await availableButton("Add barcode"));
  const form = within(await screen.findByRole("dialog", { name: "Create Barcode" }));
  await user.type(await form.findByLabelText("Barcode"), "EMPTY");
  await user.click(form.getByRole("button", { name: "Save barcode" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes.find((write) => write.path === "/api/objects/product_barcodes")?.body).toEqual({
    product_id: 7,
    barcode: "EMPTY",
    amount: "",
    qu_id: "",
    note: "",
    shopping_location_id: "",
  });
});

test("catalog copy links create a separate product with native copy fields and retain it on a field retry", async () => {
  const { router, products, product, writes, barcodes, conversions } = mount({
    copying: true,
    copyFailure: true,
    fieldFailure: true,
  });

  const user = userEvent.setup();
  await screen.findByRole("link", { name: "Copy Coffee" });
  await user.click(screen.getByRole("button", { name: "Edit catalog" }));
  const catalog = within(await screen.findByRole("region", { name: "Products" }));
  await catalog.findByRole("link", { name: "Copy Coffee" });
  expect(
    screen.getAllByRole("link", { name: "Copy Coffee" }).map((link) => link.getAttribute("href")),
  ).toEqual(["/product/new?copy-of=7", "/product/new?copy-of=7"]);
  await user.click(catalog.getByRole("link", { name: "Copy Coffee" }));
  await screen.findByText("Source load failed");
  expect(screen.queryByRole("form", { name: "Add product" })).toBeNull();
  expect(writes).toEqual([]);
  product.default_best_before_days = 21;
  await user.click(screen.getByRole("button", { name: "Retry" }));
  const form = within(await screen.findByRole("form", { name: "Add product" }));
  expect(form.getByLabelText<HTMLInputElement>("Name").value).toBe("");
  expect(form.getByLabelText<HTMLSelectElement>("Stock unit").value).toBe("1");
  expect(form.getByLabelText<HTMLSelectElement>("Purchase unit").value).toBe("2");
  expect(form.getByLabelText<HTMLInputElement>("Days before expiry").value).toBe("21");
  expect(form.getByLabelText<HTMLInputElement>("Active").checked).toBe(true);
  expect(form.getByLabelText<HTMLInputElement>("Treat opened stock as missing").checked).toBe(
    false,
  );
  expect(form.getByLabelText<HTMLInputElement>("Owner").value).toBe("");
  expect(form.getByLabelText<HTMLInputElement>("Container weight").value).toBe("120");
  expect(form.getByLabelText<HTMLInputElement>("Container weight").disabled).toBe(true);
  expect(form.getByLabelText<HTMLInputElement>("Minimum stock").disabled).toBe(false);
  expect(form.getByLabelText<HTMLInputElement>("Minimum stock").value).toBe("9");
  await user.type(form.getByLabelText("Name"), "New coffee");
  expect(form.getByLabelText<HTMLSelectElement>("Consume unit").value).toBe("1");
  expect(form.getByLabelText<HTMLSelectElement>("Price unit").value).toBe("1");
  await user.type(form.getByLabelText("Owner"), "New owner");
  await user.click(await availableButton("Save & continue"));
  await screen.findByText("Field save failed");
  expect(products).toHaveLength(2);
  expect(products[1]).toMatchObject({
    id: 8,
    name: "New coffee",
    active: 1,
    due_type: "1",
    should_not_be_frozen: 0,
    disable_open: 0,
    default_purchase_price_type: "1",
    description: "<p>Source <strong>description</strong></p>",
    tare_weight: 0,
    picture_file_name: null,
    parent_product_id: 9,
    min_stock_amount: 9,
  });
  await user.click(await availableButton("Save & continue"));
  await waitFor(() => expect(router.state.location.href).toBe("/product/8"));
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Minimum stock").disabled).toBe(true),
  );
  expect(products[1]?.userfields).toEqual({ Owner: "New owner" });
  expect(product).toMatchObject({
    id: 7,
    name: "Coffee",
    active: 0,
    userfields: { Owner: "Source owner" },
    tare_weight: 120,
  });
  expect(barcodes[0]).toMatchObject({ product_id: 7, barcode: "CODE" });
  expect(conversions[0]).toMatchObject({ product_id: 7, factor: 6 });
  expect(writes.map(({ path, method }) => `${method} ${path}`)).toEqual([
    "POST /api/objects/products",
    "PUT /api/userfields/products/8",
    "PUT /api/objects/products/8",
    "PUT /api/userfields/products/8",
  ]);
});

test("disabled product tare weight retains its stored value until the user enables its control", async () => {
  const { product, writes } = mount({ tare: true });
  const user = userEvent.setup();
  const weight = await screen.findByLabelText<HTMLInputElement>("Container weight");
  expect(weight.disabled).toBe(true);
  expect(weight.value).toBe("120");
  await user.click(await availableButton("Save & continue"));
  await waitFor(() =>
    expect(writes.some((write) => write.path === "/api/objects/products/7")).toBe(true),
  );
  expect(writes.find((write) => write.path === "/api/objects/products/7")?.body).not.toHaveProperty(
    "tare_weight",
  );
  await availableButton("Save & continue");
  await user.click(screen.getByLabelText("Use container weight"));
  const enabled = screen.getByLabelText<HTMLInputElement>("Container weight");
  expect(enabled.disabled).toBe(false);
  await user.clear(enabled);
  await user.type(enabled, "149");
  await user.click(await availableButton("Save & continue"));
  await waitFor(() => expect(product.tare_weight).toBe(149));
  expect(product.enable_tare_weight_handling).toBe(1);
});
