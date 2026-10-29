import { supportProductOptions } from "./fixtures/product-options";
import { supportDescriptionEditors } from "./fixtures/editor";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import { writeApiConfig } from "@/lib/config";

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

  const products = [
    { id: 1, name: "Milk", qu_id_stock: 1, qu_id_purchase: 2, location_id: 1, active: 1 },
  ];

  const units = [
    { id: 1, name: "Piece", name_plural: "Pieces" },
    { id: 2, name: "Case", name_plural: "Cases" },
  ];

  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input).replace(/^\/house/, "");
    const method = init?.method ?? "GET";

    if (method !== "GET") writes.push({ path, method, body: String(init?.body ?? "") });

    if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

    if (path === "/api/user") return Response.json([{ id: 1, username: "test" }]);

    if (path === "/api/system/config")
      return Response.json({
        FEATURE_FLAG_SHOPPINGLIST_MULTIPLE_LISTS: multiple,
        STOCK_BARCODE_LOOKUP_PLUGIN: "TestLookup",
      });

    if (path === "/api/user/settings")
      return Response.json({ product_presets_location_id: 1, product_presets_qu_id: 1 });

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
            to_qu_name: "Case",
            to_qu_name_plural: "Cases",
          },
        ],
        fields: [
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

      return new Response(null, { status: 204 });
    }

    if (path === "/api/objects/product_barcodes" && method === "POST") {
      barcodeWrites++;

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

      if (fail === "row" && rowWrites === 1)
        return Response.json({ error_message: "Item write failed" }, { status: 503 });

      return Response.json({ created_object_id: "52" });
    }

    if (path.startsWith("/api/userfields/shopping_list/")) {
      fieldWrites++;

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

  return { writes, router, transport, releaseBarcode: () => releaseBarcode?.() };
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

test("a legacy item link respects the single-list flag and cancellation writes nothing", async () => {
  const { writes, router } = mount("/shoppinglistitem/51?list=7", false, 7);
  const user = userEvent.setup();
  const form = within(await screen.findByRole("dialog", { name: "Edit shopping list item" }));
  await form.findByRole("spinbutton", { name: "Amount" });
  expect(form.queryByRole("combobox", { name: "Shopping list" })).toBeNull();
  await user.type(form.getByRole("textbox", { name: "Note" }), " draft");
  await user.click(form.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/shopping"));
  expect(writes).toHaveLength(0);
  await act(async () =>
    router.navigate({
      to: "/shoppinglistitem/$itemId",
      params: { itemId: "51" },
      search: { list: 7 },
    }),
  );
  const reopened = within(await screen.findByRole("dialog", { name: "Edit shopping list item" }));
  await reopened.findByRole("spinbutton", { name: "Amount" });
  await user.click(reopened.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(JSON.parse(writes[0].body).shopping_list_id).toBe(1);
});

test("a merge link selects a barcode match and retries lookup and fields without adding the quantity again", async () => {
  const { writes, router, transport } = mount(
    "/shoppinglistitem/new?product-name=milk-code&list=7&amount=3&updateexistingproduct=false",
    true,
    7,
    "lookup",
  );

  const user = userEvent.setup();
  const form = within(await screen.findByRole("dialog", { name: "Create shopping list item" }));
  const amount = await form.findByRole<HTMLInputElement>("spinbutton", { name: "Amount" });
  expect(form.getByRole<HTMLInputElement>("combobox", { name: "Product" }).value).toBe("Milk");
  expect(form.getByRole<HTMLSelectElement>("combobox", { name: "Shopping list" }).value).toBe("7");
  expect(form.getByRole<HTMLSelectElement>("combobox", { name: "Quantity unit" }).value).toBe("2");
  expect(amount.value).toBe("1");
  await user.clear(amount);
  await user.type(amount, "3");
  await user.type(form.getByRole("textbox", { name: "Note" }), "Trip milk");
  await user.type(form.getByRole("textbox", { name: "Priority" }), "Urgent");
  await user.click(form.getByRole("button", { name: "Save" }));
  await form.findByText("Item lookup failed");
  expect(amount.matches(":disabled")).toBe(true);
  expect(form.getByRole("textbox", { name: "Priority" }).matches(":disabled")).toBe(false);
  await user.click(form.getByRole("button", { name: "Save" }));
  await form.findByText("Field write failed");
  await user.click(form.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/shopping"));
  expect(new URLSearchParams(router.history.location.search).get("list")).toBe("7");
  expect(writes.map((write) => write.path)).toEqual([
    "/api/stock/shoppinglist/add-product",
    "/api/userfields/shopping_list/51",
    "/api/userfields/shopping_list/51",
  ]);
  expect(JSON.parse(writes[0].body)).toEqual({
    product_id: "1",
    product_amount: 18,
    qu_id: "2",
    list_id: 7,
    note: "Trip milk",
  });
  expect(JSON.parse(writes[2].body)).toEqual({ priority: "Urgent" });

  const lookup = transport.mock.calls.find(([url]) => String(url).includes("query%5B%5D"));
  expect(new URL(String(lookup?.[0]), "http://test").searchParams.getAll("query[]")).toEqual([
    "product_id=1",
    "shopping_list_id=7",
  ]);
});

test("an edit link retains the saved product and applies list and stock-amount overrides", async () => {
  const { writes, router } = mount("/shoppinglistitem/51?product=999&list=7&amount=3units");
  const user = userEvent.setup();
  const form = within(await screen.findByRole("dialog", { name: "Edit shopping list item" }));
  const amount = await form.findByRole<HTMLInputElement>("spinbutton", { name: "Amount" });
  expect(amount.value).toBe("0.5");
  expect(form.getByRole<HTMLInputElement>("combobox", { name: "Product" }).value).toBe("Milk");
  expect(form.getByRole<HTMLSelectElement>("combobox", { name: "Shopping list" }).value).toBe("7");
  await user.click(form.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/shopping"));
  expect(JSON.parse(writes[0].body)).toEqual({
    shopping_list_id: 7,
    product_id: "1",
    amount: 3,
    qu_id: "2",
    note: "Keep cool",
  });
});

test.each(["barcode", "row"] as const)(
  "a barcode link retains partial saves and retries a failed %s write",
  async (failure) => {
    const { writes, router, releaseBarcode } = mount(
      "/shoppinglistitem/new?product=1&list=7&flow=InplaceAddBarcodeToExistingProduct&barcode=123",
      true,
      1,
      failure,
    );

    const user = userEvent.setup();
    const form = within(await screen.findByRole("dialog", { name: "Create shopping list item" }));
    const product = await form.findByRole<HTMLInputElement>("combobox", { name: "Product" });
    expect(product.value).toBe("Milk");
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
    await waitFor(() => expect(router.state.location.pathname).toBe("/shopping"));
    expect(writes.map((write) => write.path)).toEqual([
      "/api/objects/product_barcodes",
      "/api/objects/shopping_list",
      failure === "barcode" ? "/api/objects/product_barcodes" : "/api/objects/shopping_list",
    ]);
    expect(JSON.parse(writes[0].body)).toEqual({ barcode: "123", product_id: "1" });
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
    const form = within(await screen.findByRole("dialog", { name: "Create shopping list item" }));
    const product = await form.findByRole<HTMLInputElement>("combobox", { name: "Product" });
    await user.type(product, code + "{Enter}");
    await waitFor(() => expect(product.value).toBe("Milk"));
    expect(form.getByRole<HTMLSelectElement>("combobox", { name: "Quantity unit" }).value).toBe(
      "2",
    );
    await user.click(form.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/shopping"));
    expect(JSON.parse(writes[0].body)).toEqual({
      shopping_list_id: 7,
      product_id: "1",
      amount: 6,
      qu_id: "2",
      note: "",
    });
  },
);

test("an unknown shopping code can be assigned to an existing product without leaving the selected list", async () => {
  const { writes, router } = mount("/shoppinglistitem/new?list=7");
  const user = userEvent.setup();
  const form = within(await screen.findByRole("dialog", { name: "Create shopping list item" }));
  const product = await form.findByRole<HTMLInputElement>("combobox", { name: "Product" });
  await user.type(product, "555{Enter}");
  const workflows = within(await screen.findByRole("dialog", { name: "Create or assign product" }));
  workflows.getByRole("button", { name: "Cancel" }).focus();
  await user.keyboard("b");
  await waitFor(() => expect(document.activeElement).toBe(product));
  await user.type(product, "Milk{Enter}");
  await user.click(form.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/shopping"));
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
  const form = within(await screen.findByRole("dialog", { name: "Create shopping list item" }));
  await user.type(await form.findByRole("combobox", { name: "Product" }), "Retired{Enter}");
  await form.findByText("This product is not in stock");
  expect(form.getByRole<HTMLInputElement>("combobox", { name: "Product" }).value).toBe("");
  expect(writes).toHaveLength(0);
});

test("Escape closes picker and camera dialogs and retains the shopping draft", async () => {
  const { writes } = mount("/shoppinglistitem/new?list=7");
  const user = userEvent.setup();
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

    const initial = within(
      await screen.findByRole("dialog", { name: "Create shopping list item" }),
    );

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

    const returned = within(
      await screen.findByRole("dialog", { name: "Create shopping list item" }),
    );

    const selected = await returned.findByRole<HTMLInputElement>("combobox", { name: "Product" });
    expect(selected.value).toBe(mode === "name" ? "555" : "New tea");
    expect(returned.getByRole<HTMLSelectElement>("combobox", { name: "Shopping list" }).value).toBe(
      "7",
    );
    await user.click(returned.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/shopping"));
    expect(writes.filter((write) => write.path === "/api/objects/products")).toHaveLength(1);
    expect(JSON.parse(writes.at(-1)?.body ?? "")).toEqual({
      shopping_list_id: 7,
      product_id: "2",
      amount: 1,
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
  const form = within(await screen.findByRole("dialog", { name: "Create shopping list item" }));
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
      await workflows.findByText("Plugin failed");
      await user.click(workflows.getByRole("button", { name: "Cancel" }));
    }
  }

  const editor = within(await screen.findByRole("form", { name: "Edit product" }));
  expect(editor.getByRole<HTMLInputElement>("textbox", { name: "Name" }).value).toBe(
    "External tea",
  );
  const save = editor.getByRole<HTMLButtonElement>("button", { name: "Save & continue" });
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.click(save);
  const returned = within(await screen.findByRole("dialog", { name: "Create shopping list item" }));
  expect((await returned.findByRole<HTMLInputElement>("combobox", { name: "Product" })).value).toBe(
    "External tea",
  );
  await user.click(returned.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/shopping"));
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

test.each(["222", "1e3", "0.123456789123456789", "null", '"Tea"', '{"name":"Tea"}'])(
  "the legacy product form keeps literal name %s and its return link inside the application",
  async (name) => {
    const { router, writes } = mount(
      `/product/new?flow=InplaceNewProductWithName&name=${encodeURIComponent(name)}&returnto=https%3A%2F%2Fother.example`,
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
