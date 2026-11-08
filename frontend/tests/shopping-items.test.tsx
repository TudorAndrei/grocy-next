import { supportProductOptions } from "./fixtures/product-options";
import { supportDescriptionEditors } from "./fixtures/editor";
import { nativeProductContext } from "./fixtures/native-product";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import { writeApiConfig } from "@/lib/config";
import type { UserfieldDefinition } from "@/lib/userfields";

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
  path = "/shopping?list=1",
  multiple = true,
  sourceList = 1,
  fail?: "barcode" | "row" | "lookup",
  responses: {
    fields?: UserfieldDefinition[];
    amountPrecision?: number;
    unitNames?: { singular: string; plural: string | null };
    primary?: (index: number) => Response | Promise<Response>;
    metadata?: (body: Record<string, string>) => Response | Promise<Response>;
    receipt?: () => Response | Promise<Response>;
    barcode?: (index: number) => Response | Promise<Response>;
  } = {},
) {
  writeApiConfig({ baseUrl: "/house", apiKey: "item-key" });
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener() {},
    removeEventListener() {},
  }));

  let saved = {
    id: 51,
    shopping_list_id: sourceList,
    product_id: 1,
    amount: 12,
    qu_id: 2,
    note: "Keep cool",
    done: true,
  };

  let fieldWrites = 0;
  let barcodeWrites = 0;
  let releaseBarcode: (() => void) | undefined;
  let rowWrites = 0;
  let lookups = 0;
  const writes: { path: string; method: string; body: string }[] = [];
  const signals: { path: string; signal: AbortSignal | null | undefined }[] = [];
  const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});

  const products = [
    { id: 1, name: "Milk", qu_id_stock: 1, qu_id_purchase: 2, location_id: 1, active: 1 },
  ];

  const units = [
    { id: 1, name: "Piece", name_plural: "Pieces" },
    {
      id: 2,
      name: responses.unitNames?.singular ?? "Case",
      name_plural: responses.unitNames ? responses.unitNames.plural : "Cases",
    },
  ];

  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input).replace(/^\/house/, "");
    const method = init?.method ?? "GET";

    if (path === "/api/objects/userfields?query[]=entity=shopping_list" && method === "GET")
      return Response.json(
        responses.fields ?? [
          {
            id: 1,
            name: "priority",
            caption: "Priority",
            type: "text-single-line",
            input_required: 0,
            default_value: null,
            config: null,
          },
        ],
      );

    if (path === "/api/userfields/shopping_list/51" && method === "GET")
      return Response.json({ priority: "Normal" });

    if (method !== "GET") {
      writes.push({ path, method, body: String(init?.body ?? "") });
      signals.push({ path, signal: init?.signal });
    }

    if (path === "/api/stock/products/1")
      return responses.receipt
        ? await responses.receipt()
        : Response.json({
            product: products[0],
            quantity_unit_stock: units[0],
            default_quantity_unit_purchase: units[1],
          });

    if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

    if (path === "/api/user") return Response.json([{ id: 1, username: "test" }]);

    if (path === "/api/v2/user/permissions") return Response.json({});

    if (path.startsWith("/api/v2/localization"))
      return Response.json({
        locale: "en",
        direction: "ltr",
        languages: ["en"],
        catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
      });

    if (path === "/api/system/config")
      return Response.json({
        FEATURE_FLAG_SHOPPINGLIST_MULTIPLE_LISTS: multiple,
        STOCK_BARCODE_LOOKUP_PLUGIN: "TestLookup",
      });

    if (path === "/api/user/settings")
      return Response.json({
        product_presets_location_id: 1,
        product_presets_qu_id: 1,
        stock_decimal_places_amounts: responses.amountPrecision ?? 2,
      });

    if (path.startsWith("/api/v2/products/native-editor?")) {
      const id = new URL(path, "http://grocy.test").searchParams.get("row");
      const selected = products.find((row) => String(row.id) === id);

      return Response.json(
        nativeProductContext({
          product: selected
            ? {
                min_stock_amount: 0,
                default_best_before_days: 0,
                default_best_before_days_after_open: 0,
                default_best_before_days_after_freezing: 0,
                default_best_before_days_after_thawing: 0,
                quick_consume_amount: 1,
                quick_open_amount: 1,
                qu_id_consume: 1,
                qu_id_price: 1,
                ...selected,
                userfields: null,
              }
            : null,
          references: {
            locations: [{ id: 1, name: "Fridge" }],
            quantity_units: units,
            products: products.filter((row) => String(row.id) !== id),
            product_groups: [],
            shopping_locations: [],
          },
          user_settings: { product_presets_location_id: 1, product_presets_qu_id: 1 },
          config: {
            FEATURE_FLAG_SHOPPINGLIST_MULTIPLE_LISTS: multiple,
            STOCK_BARCODE_LOOKUP_PLUGIN: "TestLookup",
          },
        }),
      );
    }

    if (path === "/api/objects/locations") return Response.json([{ id: 1, name: "Fridge" }]);

    if (path === "/api/objects/products" && method === "POST") {
      const body = JSON.parse(String(init?.body));
      products.push({
        id: 2,
        name: body.name,
        qu_id_stock: body.qu_id_stock,
        qu_id_purchase: body.qu_id_purchase,
        location_id: body.location_id,
        active: body.active,
      });

      return Response.json({ created_object_id: "2" });
    }

    if (path === "/api/objects/products/2" && method === "PUT") {
      Object.assign(products[1], JSON.parse(String(init?.body)));

      return new Response(null, { status: 204 });
    }

    if (path === "/api/objects/products") return Response.json(products);

    if (path.startsWith("/api/stock/barcodes/external-lookup/")) {
      if (path.includes("EXT-ERROR"))
        return Response.json({ error_message: "Plugin failed" }, { status: 503 });

      if (path.includes("EXT-MISS")) return Response.json(null);
      products.push({
        id: 2,
        name: "External tea",
        qu_id_stock: 1,
        qu_id_purchase: 1,
        location_id: 1,
        active: 1,
      });

      return Response.json({ id: 2, name: "External tea" });
    }

    if (path.startsWith("/api/objects/product_barcodes_view?") && path.includes("Retired"))
      return Response.json([{ id: 9 }]);

    if (path === "/api/objects/quantity_units") return Response.json(units);

    if (path.startsWith("/api/v2/shopping-lists/native-context")) {
      const selected = new URL(path, "http://grocy.test").searchParams.get("list") ?? 1;

      const lists = [
        { id: 1, name: "Groceries", description: null, item_count: 1 },
        { id: 7, name: "Trip", description: null, item_count: 1 },
      ];

      return Response.json({
        list_id: selected,
        list: lists.find((row) => row.id === Number(selected)) ?? null,
        lists,
        items: [],
        products,
        units: units.map((unit) => ({ ...unit, plural_forms: null })),
        notes_document: "<html><body></body></html>",
      });
    }

    if (path.startsWith("/api/v2/shopping-lists/items/editor"))
      return Response.json({
        barcode_lookup_plugin_name: "Test lookup",
        item: path.includes("item_id=") ? saved : null,
        lists: [
          { id: 1, name: "Groceries" },
          { id: 7, name: "Trip" },
        ],
        products,
        units,
        barcodes: [{ product_id: 1, barcodes: "MILK-CODE,123" }],
        conversions: [
          ...products.slice(1).map((product) => ({
            product_id: product.id,
            from_qu_id: 1,
            to_qu_id: 1,
            factor: 1,
            to_qu_name: "Piece",
            to_qu_name_plural: "Pieces",
          })),
          {
            product_id: 1,
            from_qu_id: 1,
            to_qu_id: 1,
            factor: 1,
            to_qu_name: "Piece",
            to_qu_name_plural: "Pieces",
          },
          {
            product_id: 1,
            from_qu_id: 1,
            to_qu_id: 2,
            factor: 1 / 6,
            to_qu_name: units[1].name,
            to_qu_name_plural: units[1].name_plural,
          },
        ],
        fields: responses.fields ?? [
          {
            id: 1,
            name: "priority",
            caption: "Priority",
            type: "text-single-line",
            input_required: 0,
            default_value: null,
            config: null,
          },
        ],
        values: { priority: "Normal" },
      });

    if (path === "/api/v2/shopping-lists")
      return Response.json([
        { id: 1, name: "Groceries", item_count: 1 },
        { id: 7, name: "Trip", item_count: 0 },
      ]);

    if (/^\/api\/v2\/shopping-lists\/\d+$/.test(path)) {
      const id = Number(path.split("/").at(-1));

      return Response.json({
        id,
        name: id === 1 ? "Groceries" : "Trip",
        description: "",
        items: saved.shopping_list_id === id ? [{ ...saved, amount: saved.amount / 6 }] : [],
      });
    }

    if (path === "/api/objects/shopping_list/51" && method === "PUT") {
      saved = { ...saved, ...JSON.parse(String(init?.body)) };

      if (responses.primary) return await responses.primary(++rowWrites);

      return new Response(null, { status: 204 });
    }

    if (path === "/api/objects/product_barcodes" && method === "POST") {
      barcodeWrites++;

      if (responses.barcode) return await responses.barcode(barcodeWrites);

      if (fail === "barcode" && barcodeWrites === 1)
        return new Promise<Response>((resolve) => {
          releaseBarcode = () =>
            resolve(Response.json({ error_message: "Barcode write failed" }, { status: 503 }));
        });

      return Response.json({ created_object_id: "8" });
    }

    if (path === "/api/stock/shoppinglist/add-product" && method === "POST")
      return new Response(null, { status: 204 });

    if (path.startsWith("/api/objects/shopping_list?") && method === "GET") {
      lookups++;

      if (fail === "lookup" && lookups === 1)
        return Response.json({ error_message: "Item lookup failed" }, { status: 503 });

      return Response.json([{ id: "51" }]);
    }

    if (path === "/api/objects/shopping_list" && method === "POST") {
      rowWrites++;

      if (responses.primary) return await responses.primary(rowWrites);

      if (fail === "row" && rowWrites === 1)
        return Response.json({ error_message: "Item write failed" }, { status: 503 });

      return Response.json({ created_object_id: "52" });
    }

    if (path.startsWith("/api/userfields/shopping_list/")) {
      fieldWrites++;

      if (responses.metadata) return await responses.metadata(JSON.parse(String(init?.body)));

      if (fieldWrites === 1)
        return Response.json({ error_message: "Field write failed" }, { status: 503 });

      return new Response(null, { status: 204 });
    }

    return Response.json([]);
  });

  vi.stubGlobal("fetch", transport);
  supportProductOptions();
  supportDescriptionEditors();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
  });

  const app = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  onTestFinished(() => {
    app.unmount();
    client.clear();
  });

  return {
    writes,
    router,
    transport,
    signals,
    parent,
    messages: () =>
      parent.mock.calls
        .map(([message]) => message)
        .filter((message) =>
          ["ShoppingListChanged", "ShowSuccessMessage", "CloseLastModal"].includes(
            message?.Message,
          ),
        ),
    releaseBarcode: () => releaseBarcode?.(),
  };
}

test("editing a row converts display units, moves the item, and retries custom fields after the row write", async () => {
  const { writes, router, transport } = mount();

  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit Milk" }));
  const form = within(await screen.findByRole("dialog", { name: "Edit shopping list item" }));
  const amount = await form.findByRole<HTMLInputElement>("spinbutton", { name: "Amount" });
  expect(amount.value).toBe("2");
  expect(document.activeElement).toBe(amount);
  expect(form.getByRole<HTMLSelectElement>("combobox", { name: "Quantity unit" }).value).toBe("2");
  await user.clear(amount);
  await user.type(amount, "3");
  await form.findByText("This equals 18 Pieces");
  await user.selectOptions(form.getByRole("combobox", { name: "Shopping list" }), "7");
  await user.clear(form.getByRole("textbox", { name: "Note" }));
  await user.type(form.getByRole("textbox", { name: "Note" }), "Line one\nLine two");
  await user.type(form.getByRole("textbox", { name: "Priority" }), " first");
  await user.click(form.getByRole("button", { name: "Save" }));
  await form.findByText("Field write failed");
  expect(amount.value).toBe("3");
  await user.click(form.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(new URLSearchParams(router.history.location.search).get("list")).toBe("7"),
  );
  expect(writes.map((write) => write.path)).toEqual([
    "/api/objects/shopping_list/51",
    "/api/userfields/shopping_list/51",
    "/api/objects/shopping_list/51",
    "/api/userfields/shopping_list/51",
  ]);
  expect(JSON.parse(writes[0].body)).toEqual({
    shopping_list_id: 7,
    product_id: "1",
    amount: 18,
    qu_id: "2",
    note: "Line one\nLine two",
  });

  for (const [, init] of transport.mock.calls)
    expect(new Headers(init?.headers).get("GROCY-API-KEY")).toBe("item-key");
});

test("a detailed note creation keeps one new item after a custom field failure", async () => {
  const { writes, router } = mount();

  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Create shopping list item" }));
  const form = within(await screen.findByRole("dialog", { name: "Create shopping list item" }));
  const note = await form.findByRole<HTMLTextAreaElement>("textbox", { name: "Note" });
  expect(note.required).toBe(true);
  await user.type(note, "Bags\nLabels");
  await user.type(form.getByRole("textbox", { name: "Priority" }), "First");
  await user.click(form.getByRole("button", { name: "Save" }));
  await form.findByText("Field write failed");
  await user.click(form.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(new URLSearchParams(router.history.location.search).get("list")).toBe("1");
  expect(writes.filter((write) => write.method === "POST")).toHaveLength(1);
  expect(JSON.parse(writes[0].body)).toEqual({
    shopping_list_id: 1,
    product_id: "",
    amount: 1,
    qu_id: "",
    note: "Bags\nLabels",
  });
});

test("a native item link keeps its addressable hidden list and departing without Save writes nothing", async () => {
  const { writes, router } = mount("/shoppinglistitem/51?list=7", false, 7);

  const user = userEvent.setup();
  const form = within(await screen.findByRole("form", { name: "Edit shopping list item" }));
  await form.findByRole("spinbutton", { name: "Amount" });
  expect(form.queryByRole("combobox", { name: "Shopping list" })).toBeNull();
  expect(form.queryByRole("button", { name: "Cancel" })).toBeNull();
  await user.type(form.getByRole("textbox", { name: "Note" }), " draft");

  await act(async () => router.navigate({ href: "/shoppinglist?list=7" }));
  await screen.findByRole("heading", { name: "Shopping list" });
  expect(writes).toHaveLength(0);

  await act(async () =>
    router.navigate({
      to: "/shoppinglistitem/$itemId",
      params: { itemId: "51" },
      search: { list: 7 },
    }),
  );
  const reopened = within(await screen.findByRole("form", { name: "Edit shopping list item" }));
  await reopened.findByRole("spinbutton", { name: "Amount" });
  await user.click(reopened.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/shoppinglist"));
  expect(JSON.parse(writes[0].body).shopping_list_id).toBe("7");
});

test("a native merge link uses its real 204 response and returns without lookup or field gating", async () => {
  const { writes, router, transport } = mount(
    "/shoppinglistitem/new?product-name=milk-code&list=7&amount=3&updateexistingproduct=false",
    true,
    7,
    "lookup",
  );

  const user = userEvent.setup();
  const form = within(await screen.findByRole("form", { name: "Create shopping list item" }));
  const amount = await form.findByRole<HTMLInputElement>("spinbutton", { name: "Amount" });
  expect(form.getByRole<HTMLInputElement>("combobox", { name: "Product" }).value).toBe("Milk");
  expect(amount.value).toBe("1");
  await user.clear(amount);
  await user.type(amount, "3");
  await user.type(form.getByRole("textbox", { name: "Note" }), "Trip milk");
  await user.type(form.getByRole("textbox", { name: "Priority" }), "Urgent");
  await user.click(form.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/shoppinglist"));
  expect(new URLSearchParams(router.history.location.search).get("list")).toBe("7");
  expect(writes.map((write) => write.path)).toEqual([
    "/api/stock/shoppinglist/add-product",
    "/api/userfields/shopping_list/undefined",
  ]);
  expect(JSON.parse(writes[0].body)).toEqual({
    product_id: "1",
    product_amount: "18.",
    qu_id: "2",
    list_id: "7",
    note: "Trip milk",
  });
  expect(JSON.parse(writes[1].body)).toEqual({ priority: "Urgent" });
  expect(transport.mock.calls.some(([url]) => String(url).includes("query%5B%5D"))).toBe(false);
});

test("an edit link retains the saved product and applies list and stock-amount overrides", async () => {
  const { writes, router } = mount("/shoppinglistitem/51?product=999&list=7&amount=3units");

  const user = userEvent.setup();
  const form = within(await screen.findByRole("form", { name: "Edit shopping list item" }));
  const amount = await form.findByRole<HTMLInputElement>("spinbutton", { name: "Amount" });
  expect(amount.value).toBe("0.5");
  expect(form.getByRole<HTMLInputElement>("combobox", { name: "Product" }).value).toBe("Milk");
  expect(form.getByRole<HTMLSelectElement>("combobox", { name: "Shopping list" }).value).toBe("7");
  await user.click(form.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/shoppinglist"));
  expect(JSON.parse(writes[0].body)).toEqual({
    shopping_list_id: "7",
    product_id: "1",
    amount: "3.",
    qu_id: "2",
    note: "Keep cool",
  });
});

test.each(["barcode", "row"] as const)(
  "the additional ShoppingPage barcode workflow retains partial saves and retries a failed %s write",
  async (failure) => {
    const { writes, releaseBarcode } = mount("/shopping?list=7", true, 1, failure);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Create shopping list item" }));
    const form = within(await screen.findByRole("dialog", { name: "Create shopping list item" }));
    const product = await form.findByRole<HTMLInputElement>("combobox", { name: "Product" });
    await user.type(product, "555{Enter}");
    const chooser = within(await screen.findByRole("dialog", { name: "Create or assign product" }));
    chooser.getByRole("button", { name: "Cancel" }).focus();
    await user.keyboard("b");
    await waitFor(() => expect(document.activeElement).toBe(product));
    await user.type(product, "Milk{Enter}");
    await form.findByText(
      "will be added to the list of barcodes for the selected product on submit",
    );
    await user.click(form.getByRole("button", { name: "Save" }));

    if (failure === "barcode") {
      try {
        await waitFor(() =>
          expect(writes.some((write) => write.path === "/api/objects/shopping_list")).toBe(true),
        );
      } finally {
        releaseBarcode();
      }
    }

    await form.findByText(failure === "barcode" ? "Barcode write failed" : "Item write failed");
    expect(product.matches(":disabled")).toBe(true);

    if (failure === "barcode")
      await form.findByText("The item is saved. Retry to save the remaining changes.");

    await user.click(form.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Create shopping list item" })).toBeNull(),
    );
    expect(writes.map((write) => write.path)).toEqual([
      "/api/objects/product_barcodes",
      "/api/objects/shopping_list",
      failure === "barcode" ? "/api/objects/product_barcodes" : "/api/objects/shopping_list",
    ]);
    expect(JSON.parse(writes[0].body)).toEqual({ barcode: "555", product_id: "1" });
    expect(JSON.parse(writes[1].body)).toEqual({
      shopping_list_id: 7,
      product_id: "1",
      amount: 6,
      qu_id: "2",
      note: "",
    });
  },
);

test.each(["milk-code", "23", "grcy:p:1", "Milk"])(
  "the shopping picker resolves %s and submits its purchase-unit quantity",
  async (code) => {
    const { writes, router } = mount("/shoppinglistitem/new?list=7");

    const user = userEvent.setup();
    const form = within(await screen.findByRole("form", { name: "Create shopping list item" }));
    const product = await form.findByRole<HTMLInputElement>("combobox", { name: "Product" });
    await user.type(product, code + "{Enter}");
    await waitFor(() => expect(product.value).toBe("Milk"));
    expect(form.getByRole<HTMLSelectElement>("combobox", { name: "Quantity unit" }).value).toBe(
      "2",
    );
    await user.click(form.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/shoppinglist"));
    expect(JSON.parse(writes[0].body)).toEqual({
      shopping_list_id: "7",
      product_id: "1",
      amount: "6.",
      qu_id: "2",
      note: "",
    });
  },
);

test("an unknown shopping code can be assigned to an existing product without leaving the selected list", async () => {
  const { writes, router } = mount("/shopping?list=7");

  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Create shopping list item" }));
  const form = within(await screen.findByRole("dialog", { name: "Create shopping list item" }));
  const product = await form.findByRole<HTMLInputElement>("combobox", { name: "Product" });
  await user.type(product, "555{Enter}");
  const workflows = within(await screen.findByRole("dialog", { name: "Create or assign product" }));
  workflows.getByRole("button", { name: "Cancel" }).focus();
  await user.keyboard("b");
  await waitFor(() => expect(document.activeElement).toBe(product));
  await user.type(product, "Milk{Enter}");
  await user.click(form.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Create shopping list item" })).toBeNull(),
  );
  expect(router.state.location.pathname).toBe("/shopping");
  expect(writes.map((write) => write.path)).toEqual([
    "/api/objects/product_barcodes",
    "/api/objects/shopping_list",
  ]);
  expect(JSON.parse(writes[0].body)).toEqual({ barcode: "555", product_id: "1" });
  expect(JSON.parse(writes[1].body)).toEqual({
    shopping_list_id: 7,
    product_id: "1",
    amount: 6,
    qu_id: "2",
    note: "",
  });
});

test("a code that belongs to an unavailable product reports the native error", async () => {
  const { writes } = mount("/shoppinglistitem/new");

  const user = userEvent.setup();
  const form = within(await screen.findByRole("form", { name: "Create shopping list item" }));
  await user.type(await form.findByRole("combobox", { name: "Product" }), "Retired{Enter}");
  await form.findByText("This product is not in stock");
  expect(form.getByRole<HTMLInputElement>("combobox", { name: "Product" }).value).toBe("");
  expect(writes).toHaveLength(0);
});

test("Escape closes picker and camera dialogs and retains the shopping draft", async () => {
  const { writes } = mount("/shopping?list=7");

  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Create shopping list item" }));
  const outer = await screen.findByRole("dialog", { name: "Create shopping list item" });
  const form = within(outer);
  await user.type(await form.findByRole("textbox", { name: "Note" }), "Keep this draft");
  const product = form.getByRole("combobox", { name: "Product" });
  await user.type(product, "555{Enter}");
  const workflows = await screen.findByRole("dialog", { name: "Create or assign product" });

  await act(async () => {
    workflows.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));
  });
  await waitFor(() => expect(document.activeElement).toBe(product));
  await user.click(form.getByRole("button", { name: "Scan with camera" }));
  const camera = await screen.findByRole("dialog", { name: "Scan a barcode" });

  await act(async () => {
    camera.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));
  });
  expect(await screen.findByRole("dialog", { name: "Create shopping list item" })).toBe(outer);
  expect(form.getByRole<HTMLTextAreaElement>("textbox", { name: "Note" }).value).toBe(
    "Keep this draft",
  );
  expect(document.body.style.overflow).toBe("hidden");
  expect(writes).toHaveLength(0);
});

test.each(["name", "barcode"] as const)(
  "a new product %s workflow returns to the shopping form and saves the selected product",
  async (mode) => {
    const { writes, router } = mount("/shoppinglistitem/new?list=7");

    const user = userEvent.setup();

    const initial = within(await screen.findByRole("form", { name: "Create shopping list item" }));

    await user.type(await initial.findByRole("combobox", { name: "Product" }), "555{Enter}");

    const workflows = within(
      await screen.findByRole("dialog", { name: "Create or assign product" }),
    );

    await user.click(
      workflows.getByRole("button", {
        name: mode === "name" ? /Add as new product$/ : /Add as new product and prefill barcode/,
      }),
    );
    const editor = within(await screen.findByRole("form", { name: "Add product" }));
    const name = editor.getByRole<HTMLInputElement>("textbox", { name: "Name" });
    expect(name.value).toBe(mode === "name" ? "555" : "");

    if (mode === "barcode") await user.type(name, "New tea");
    const save = editor.getByRole<HTMLButtonElement>("button", { name: "Save & continue" });
    await waitFor(() => expect(save.disabled).toBe(false));
    await user.click(save);

    const returned = within(await screen.findByRole("form", { name: "Create shopping list item" }));

    const selected = await returned.findByRole<HTMLInputElement>("combobox", { name: "Product" });
    expect(selected.value).toBe(mode === "name" ? "555" : "New tea");
    expect(returned.getByRole<HTMLSelectElement>("combobox", { name: "Shopping list" }).value).toBe(
      "7",
    );
    await user.click(returned.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/shoppinglist"));
    expect(writes.filter((write) => write.path === "/api/objects/products")).toHaveLength(1);
    expect(JSON.parse(writes.at(-1)?.body ?? "")).toEqual({
      shopping_list_id: "7",
      product_id: "2",
      amount: "1.",
      qu_id: "1",
      note: "",
    });

    if (mode === "barcode")
      expect(JSON.parse(writes[1].body)).toEqual({ barcode: "555", product_id: "2" });
  },
);

test("external shopping lookup handles no result and failure before returning through the product editor", async () => {
  const { writes, router, transport } = mount("/shoppinglistitem/new?list=7");

  const user = userEvent.setup();
  const form = within(await screen.findByRole("form", { name: "Create shopping list item" }));
  const input = await form.findByRole("combobox", { name: "Product" });

  for (const code of ["EXT-MISS", "EXT-ERROR", "EXT-OK"]) {
    await user.clear(input);
    await user.type(input, code + "{Enter}");

    const workflows = within(
      await screen.findByRole("dialog", { name: "Create or assign product" }),
    );

    await user.click(workflows.getByRole("button", { name: /External barcode lookup/ }));

    if (code === "EXT-MISS") await form.findByText("Nothing was found for the given barcode");

    if (code === "EXT-ERROR") {
      await screen.findByText("Error while executing the barcode lookup plugin");
      expect(screen.queryByRole("dialog", { name: "Create or assign product" })).toBeNull();
      await user.click(screen.getByRole("button", { name: /Click to show technical details/ }));
      const details = await screen.findByRole("dialog", { name: "Error details" });
      await within(details).findByText(/Plugin failed/);
      expect(details.querySelector("p")?.textContent).toBe(
        String.raw`"{\"error_message\":\"Plugin failed\"}"`,
      );
      await user.click(within(details).getByRole("button", { name: "OK" }));
      expect(form.getByRole<HTMLSelectElement>("combobox", { name: "Shopping list" }).value).toBe(
        "7",
      );
    }
  }

  const editor = within(await screen.findByRole("form", { name: "Edit product" }));
  expect(editor.getByRole<HTMLInputElement>("textbox", { name: "Name" }).value).toBe(
    "External tea",
  );
  const save = editor.getByRole<HTMLButtonElement>("button", { name: "Save & continue" });
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.click(save);
  const returned = within(await screen.findByRole("form", { name: "Create shopping list item" }));
  expect((await returned.findByRole<HTMLInputElement>("combobox", { name: "Product" })).value).toBe(
    "External tea",
  );
  await user.click(returned.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/shoppinglist"));
  expect(writes[0].path).toBe("/api/objects/products/2");
  expect(JSON.parse(writes.at(-1)?.body ?? "").product_id).toBe("2");
  expect(
    transport.mock.calls
      .filter(([path]) => String(path).includes("external-lookup/"))
      .map(([path]) => String(path)),
  ).toEqual([
    "/house/api/stock/barcodes/external-lookup/EXT-MISS?add=true",
    "/house/api/stock/barcodes/external-lookup/EXT-ERROR?add=true",
    "/house/api/stock/barcodes/external-lookup/EXT-OK?add=true",
  ]);
});

test("external barcode lookup closes its chooser and locks the whole shopping form until it finishes", async () => {
  mount("/shopping?list=7");
  const transport = fetch;
  let release: (() => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const response = await transport(input, init);

      if (String(input).includes("stock/barcodes/external-lookup/EXT-MISS"))
        await new Promise<void>((resolve) => {
          release = resolve;
        });

      return response;
    }),
  );
  onTestFinished(() => release?.());

  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Create shopping list item" }));
  const form = within(await screen.findByRole("dialog", { name: "Create shopping list item" }));
  const input = await form.findByRole<HTMLInputElement>("combobox", { name: "Product" });
  await user.type(input, "EXT-MISS{Enter}");
  const chooser = await screen.findByRole("dialog", { name: "Create or assign product" });
  await user.click(within(chooser).getByRole("button", { name: /External barcode lookup/ }));
  await waitFor(() => expect(release).toBeDefined());
  expect(screen.queryByRole("dialog", { name: "Create or assign product" })).toBeNull();
  expect(input.matches(":disabled")).toBe(true);
  expect(form.getByRole("textbox", { name: "Note" }).matches(":disabled")).toBe(true);
  expect(form.getByRole("button", { name: "Cancel" }).matches(":disabled")).toBe(true);

  await act(async () => release?.());
  await form.findByText("Nothing was found for the given barcode");
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(input.matches(":disabled")).toBe(false);
  expect(form.getByRole("textbox", { name: "Note" }).matches(":disabled")).toBe(false);
  expect(form.getByRole("button", { name: "Cancel" }).matches(":disabled")).toBe(false);
});

test("a lookup failure after its form closes cannot create a notification on the next page", async () => {
  const { router } = mount("/shopping?list=7");
  const transport = fetch;
  let release: (() => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const response = await transport(input, init);

      if (String(input).includes("stock/barcodes/external-lookup/EXT-ERROR"))
        await new Promise<void>((resolve) => {
          release = resolve;
        });

      return response;
    }),
  );
  onTestFinished(() => release?.());

  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Create shopping list item" }));
  const form = within(await screen.findByRole("dialog", { name: "Create shopping list item" }));
  await user.type(await form.findByRole("combobox", { name: "Product" }), "EXT-ERROR{Enter}");
  const chooser = await screen.findByRole("dialog", { name: "Create or assign product" });
  await user.click(within(chooser).getByRole("button", { name: /External barcode lookup/ }));
  await waitFor(() => expect(release).toBeDefined());
  fireEvent(
    window,
    new MessageEvent("message", {
      origin: window.location.origin,
      data: { Message: "CloseLastModal", Payload: null },
    }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe("/shopping"));

  await act(async () => release?.());
  expect(screen.queryByRole("button", { name: /Click to show technical details/ })).toBeNull();
  expect(screen.queryByText("Error while executing the barcode lookup plugin")).toBeNull();
});

test("host close removes a nested product workflow with its owning form and releases scrolling", async () => {
  const { router } = mount("/shopping?list=7");

  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Create shopping list item" }));
  const form = within(await screen.findByRole("dialog", { name: "Create shopping list item" }));
  await user.type(await form.findByRole("combobox", { name: "Product" }), "UNKNOWN{Enter}");
  await screen.findByRole("dialog", { name: "Create or assign product" });
  expect(screen.getAllByRole("dialog")).toHaveLength(2);
  const command = { Message: "CloseLastModal", Payload: null };
  fireEvent(
    window,
    new MessageEvent("message", { origin: "https://foreign.example", data: command }),
  );
  expect(screen.getAllByRole("dialog")).toHaveLength(2);
  fireEvent(window, new MessageEvent("message", { origin: window.location.origin, data: command }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.body.style.overflow).not.toBe("hidden");
  expect(router.state.location.pathname).toBe("/shopping");
});

test.each(["222", "1e3", "0.123456789123456789", "null", '"Tea"', '{"name":"Tea"}'])(
  "the native product form keeps literal name %s and follows its return link",
  async (name) => {
    const { router, writes } = mount(
      `/product/new?flow=InplaceNewProductWithName&name=${encodeURIComponent(name)}&returnto=%2Fproducts`,
    );

    const user = userEvent.setup();
    const editor = within(await screen.findByRole("form", { name: "Add product" }));
    expect(editor.getByRole<HTMLInputElement>("textbox", { name: "Name" }).value).toBe(name);
    expect(new URLSearchParams(router.history.location.search).get("name")).toBe(name);
    await user.click(editor.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/products"));
    expect(writes).toHaveLength(0);
  },
);

async function nativeItemSurface(title: string) {
  await screen.findByRole("heading", { name: title });
  const note = await screen.findByLabelText("Note");
  const form = note.closest("form");

  if (!form) throw new Error("Shopping item main form is missing");

  return within(form);
}

function heldItemResponse() {
  let release = (_response: Response) => {};

  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function itemField(
  id: number,
  name: string,
  caption: string,
  type = "text-single-line",
): UserfieldDefinition {
  return { id, name, caption, type, input_required: 0, default_value: null, config: null };
}

test.each([true, false])(
  "native Shopping reads live fields after primary but completes before held metadata (embedded=%s)",
  async (embedded) => {
    const primary = heldItemResponse();
    const metadata = heldItemResponse();

    const app = mount(
      `/shoppinglistitem/51?list=7${embedded ? "&embedded" : ""}`,
      true,
      1,
      undefined,
      {
        fields: [
          itemField(1, "priority", "Priority"),
          itemField(2, "notes", "Count notes", "text-multi-line"),
          itemField(3, "clean", "Untouched"),
        ],
        primary: () => primary.promise,
        metadata: () => metadata.promise,
      },
    );

    const user = userEvent.setup();
    const form = await nativeItemSurface("Edit shopping list item");
    const priority = await form.findByLabelText<HTMLInputElement>("Priority");
    expect(priority.value).toBe("Normal");
    priority.focus();
    await user.keyboard("{ArrowLeft}");
    const notes = form.getByLabelText<HTMLTextAreaElement>("Count notes");
    await user.type(notes, "Before primary");
    const note = form.getByLabelText<HTMLTextAreaElement>("Note");
    await user.clear(note);
    await user.type(note, "Main line\nNext line");
    await user.click(form.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(app.writes).toHaveLength(1));
    expect.soft(JSON.parse(app.writes[0].body).note).toBe("Main line\r\nNext line");
    expect(notes.matches(":disabled")).toBe(true);
    expect(app.messages()).toEqual([]);
    // Controlled disabled DOM assignment isolates callback-time .val binding;
    // this is not ordinary user editing while the form is busy.
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setValue.call(notes, "After primary\r\nCustom LF");

    await act(async () => primary.release(new Response(null, { status: 204 })));
    await waitFor(() =>
      expect(app.writes.filter((write) => write.path.includes("/userfields/"))).toHaveLength(2),
    );
    expect(
      app.writes
        .filter((write) => write.path.includes("/userfields/"))
        .map((write) => ({ path: write.path, body: JSON.parse(write.body) })),
    ).toEqual([
      { path: "/api/userfields/shopping_list/51", body: { priority: "Normal" } },
      { path: "/api/userfields/shopping_list/51", body: { notes: "After primary\nCustom LF" } },
    ]);

    if (embedded) {
      await waitFor(() =>
        expect(app.parent).toHaveBeenCalledWith(
          { Message: "CloseLastModal", Payload: null },
          window.location.origin,
        ),
      );
      expect(app.messages()).toEqual([
        { Message: "ShoppingListChanged", Payload: "7" },
        { Message: "CloseLastModal", Payload: null },
      ]);
      expect(screen.getByLabelText("Note").matches(":disabled")).toBe(true);
    } else {
      await waitFor(() => expect(app.router.state.location.pathname).toBe("/shoppinglist"));
      expect(app.router.history.location.search).toBe("?list=7");
      expect(
        app.signals
          .filter((row) => row.path.includes("/userfields/"))
          .every((row) => row.signal?.aborted),
      ).toBe(true);
    }

    await act(async () =>
      metadata.release(
        Response.json({ error_message: "Detached field rejected" }, { status: 503 }),
      ),
    );
    expect(screen.queryByText("Detached field rejected")).toBeNull();
    expect(
      screen.queryByText("The item is saved. Retry to save the remaining changes."),
    ).toBeNull();
  },
);

test.each([
  { singular: "%s bottle", plural: "%s bottles", unit: "1.23456 bottles" },
  { singular: "%1$s jar", plural: "%1$s jars", unit: "1.235 jars" },
  { singular: "Bottle", plural: null, unit: "null" },
])(
  "native Shopping product receipt uses $singular independently of held barcode and custom metadata",
  async ({ singular, plural, unit }) => {
    const metadata = heldItemResponse(),
      barcode = heldItemResponse(),
      receipt = heldItemResponse();

    let receipts = 0;

    const app = mount(
      "/shoppinglistitem/new?product=1&list=7&embedded&flow=InplaceAddBarcodeToExistingProduct&barcode=NEW",
      true,
      1,
      undefined,
      {
        amountPrecision: 5,
        unitNames: { singular, plural },
        metadata: () => metadata.promise,
        barcode: () => barcode.promise,
        receipt: () => {
          receipts++;

          return receipt.promise;
        },
      },
    );

    const user = userEvent.setup();
    const form = await nativeItemSurface("Create shopping list item");
    await user.type(await form.findByLabelText("Priority"), "Receipt draft");
    const amount = form.getByLabelText("Amount");
    await user.clear(amount);
    await user.type(amount, "1.23456");
    await user.click(form.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(receipts).toBe(1));
    expect(app.writes.map((write) => write.path)).toEqual([
      "/api/objects/product_barcodes",
      "/api/objects/shopping_list",
      "/api/userfields/shopping_list/52",
    ]);
    expect(app.messages()).toEqual([]);

    await act(async () =>
      app.router.history.replace("/shoppinglistitem/new?product=1&list=7&keep=receipt"),
    );
    expect(screen.getByLabelText("Priority").closest("form")).toBe(
      form.getByLabelText("Priority").closest("form"),
    );
    await act(async () => receipt.release(Response.json({ product: { name: "Milk" } })));
    await waitFor(() => expect(app.messages()).toHaveLength(3));
    const messages = app.messages();
    expect(messages[0]).toEqual({
      Message: "ShowSuccessMessage",
      Payload: `Added 1.235 ${unit} of Milk to the shopping list "Trip"`,
    });
    expect(messages.slice(1)).toEqual([
      { Message: "ShoppingListChanged", Payload: "7" },
      { Message: "CloseLastModal", Payload: null },
    ]);
    expect(app.router.state.location.pathname).toBe("/shoppinglistitem/new");

    await act(async () => {
      metadata.release(Response.json({ error_message: "Late metadata rejected" }, { status: 503 }));
      barcode.release(Response.json({ created_object_id: "8" }));
    });
    expect(app.messages()).toHaveLength(3);
    expect(screen.queryByText("Late metadata rejected")).toBeNull();
  },
);

test("native Shopping preserves the blank optional unit's NaN amount on the outbound request", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});

  const app = mount("/shoppinglistitem/new?product=1&list=7&embedded", true, 1, undefined, {
    // Assert transport bytes, without claiming a NaN amount can persist.
    primary: () => Response.json({ error_message: "Controlled refusal" }, { status: 503 }),
  });

  const user = userEvent.setup();
  const form = await nativeItemSurface("Create shopping list item");
  await user.selectOptions(await form.findByLabelText("Quantity unit"), "");
  await user.click(form.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(JSON.parse(app.writes[0].body)).toEqual({
    shopping_list_id: "7",
    product_id: "1",
    amount: "NaN",
    qu_id: "",
    note: "",
  });
});

test("native Shopping primary failure logs and unlocks for a fresh create with its draft", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});

  const app = mount("/shoppinglistitem/new?list=7&embedded", true, 1, "row");

  const user = userEvent.setup();
  const form = await nativeItemSurface("Create shopping list item");
  const note = await form.findByLabelText<HTMLTextAreaElement>("Note");
  await user.type(note, "First draft");
  await user.type(form.getByLabelText("Priority"), "Kept fields");
  await user.click(form.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(errors).toHaveBeenCalled());
  expect(note.matches(":disabled")).toBe(false);
  expect(note.value).toBe("First draft");
  expect(screen.queryByText("Item write failed")).toBeNull();
  expect(app.writes).toHaveLength(1);
  await user.type(note, " revised");
  await user.click(form.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(app.parent).toHaveBeenCalledWith(
      { Message: "CloseLastModal", Payload: null },
      window.location.origin,
    ),
  );
  expect(app.writes.map((write) => write.path)).toEqual([
    "/api/objects/shopping_list",
    "/api/objects/shopping_list",
    "/api/userfields/shopping_list/52",
  ]);
  expect(JSON.parse(app.writes[1].body).note).toBe("First draft revised");
  expect(JSON.parse(app.writes[2].body)).toEqual({ priority: "Kept fields" });
});

test("native Shopping barcode failure unlocks while old primary lives and repeats both writes on Save", async () => {
  const first = heldItemResponse(),
    second = heldItemResponse();

  const app = mount(
    "/shoppinglistitem/new?product=1&list=7&embedded&flow=InplaceAddBarcodeToExistingProduct&barcode=NEW",
    true,
    1,
    undefined,
    {
      primary: (index) => (index === 1 ? first.promise : second.promise),
      barcode: (index) =>
        index === 1
          ? Response.json({ error_message: "Barcode write failed" }, { status: 503 })
          : Response.json({ created_object_id: "8" }),
    },
  );

  const user = userEvent.setup();
  const form = await nativeItemSurface("Create shopping list item");
  await form.findByLabelText("Note");
  await user.click(form.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", {
    name: /Error while saving, probably this item already exists/,
  });
  expect(form.getByLabelText("Note").matches(":disabled")).toBe(false);
  expect(app.messages()).toEqual([]);
  await user.type(form.getByLabelText("Note"), "Second draft");
  await user.click(form.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(app.writes).toHaveLength(4));
  expect(app.writes.map((write) => write.path)).toEqual([
    "/api/objects/product_barcodes",
    "/api/objects/shopping_list",
    "/api/objects/product_barcodes",
    "/api/objects/shopping_list",
  ]);
  expect(JSON.parse(app.writes[3].body).note).toBe("Second draft");

  await act(async () => first.release(Response.json({ created_object_id: "52" })));
  await waitFor(() => expect(app.messages()).toHaveLength(3));
  expect(screen.queryByText("The item is saved. Retry to save the remaining changes.")).toBeNull();

  await act(async () => second.release(Response.json({ created_object_id: "53" })));
  await waitFor(() => expect(app.messages()).toHaveLength(6));
});
