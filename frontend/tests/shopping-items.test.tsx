import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
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

function mount(path = "/shopping?list=1", multiple = true, sourceList = 1) {
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
  const writes: { path: string; method: string; body: string }[] = [];
  const products = [{ id: 1, name: "Milk", qu_id_stock: 1, qu_id_purchase: 2 }];

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
      return Response.json({ FEATURE_FLAG_SHOPPINGLIST_MULTIPLE_LISTS: multiple });

    if (path === "/api/objects/products") return Response.json(products);

    if (path === "/api/objects/quantity_units") return Response.json(units);

    if (path.startsWith("/api/v2/shopping-lists/items/editor"))
      return Response.json({
        item: path.includes("item_id=") ? saved : null,
        lists: [
          { id: 1, name: "Groceries" },
          { id: 7, name: "Trip" },
        ],
        products,
        units,
        conversions: [
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

    if (path === "/api/objects/shopping_list" && method === "POST")
      return Response.json({ created_object_id: "52" });

    if (path.startsWith("/api/userfields/shopping_list/")) {
      fieldWrites++;

      if (fieldWrites === 1)
        return Response.json({ error_message: "Field write failed" }, { status: 503 });

      return new Response(null, { status: 204 });
    }

    return Response.json([]);
  });

  vi.stubGlobal("fetch", transport);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const router = createRouter({
    routeTree,
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

  return { writes, router, transport };
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
  await waitFor(() => expect(router.state.location.search).toEqual({ list: 7 }));
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
  expect(router.state.location.search).toEqual({ list: 1 });
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
