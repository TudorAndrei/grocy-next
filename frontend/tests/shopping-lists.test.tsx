import { z } from "zod";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import { writeApiConfig } from "@/lib/config";
import type { UserfieldDefinition } from "@/lib/userfields";

beforeEach(() => {
  for (const [prototype, method] of [
    [HTMLDialogElement.prototype, "showModal"],
    [HTMLDialogElement.prototype, "close"],
    [HTMLElement.prototype, "hidePopover"],
  ] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
    Object.defineProperty(prototype, method, {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = method === "showModal";
      },
    });
    onTestFinished(() => {
      if (descriptor) Object.defineProperty(prototype, method, descriptor);
      else Reflect.deleteProperty(prototype, method);
    });
  }
});

function field(
  id: number,
  name: string,
  type: string,
  extra: Partial<UserfieldDefinition> = {},
): UserfieldDefinition {
  return {
    id,
    name,
    caption: name,
    type,
    input_required: 0,
    default_value: null,
    config: null,
    ...extra,
  };
}

function mount(path = "/shopping?list=7", fields: UserfieldDefinition[] = [], failUpload = false) {
  writeApiConfig({ baseUrl: "/house", apiKey: "list-key" });
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("matchMedia", (media: string) => ({
    media,
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));

  let lists = [
    { id: 1, name: "Groceries", item_count: 0 },
    { id: 7, name: "Weekend", item_count: 2 },
  ];

  const values = new Map<string, string>();
  let uploadFailed = false;
  const writes: { path: string; method: string; body: string }[] = [];

  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input).replace(/^\/house/, "");
    const method = init?.method ?? "GET";

    if (method !== "GET") writes.push({ path, method, body: String(init?.body ?? "") });

    if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

    if (path === "/api/user") return Response.json([{ id: 1, username: "test" }]);

    if (path === "/api/system/config")
      return Response.json({ FEATURE_FLAG_SHOPPINGLIST_MULTIPLE_LISTS: true });

    if (path === "/api/v2/shopping-lists") return Response.json(lists);

    if (path.startsWith("/api/v2/shopping-lists/editor")) {
      const id = new URL(path, "http://test").searchParams.get("list_id");

      return Response.json({
        list: id ? lists.find((list) => list.id === Number(id)) : null,
        fields,
        values: Object.fromEntries(values),
      });
    }

    if (path.startsWith("/api/v2/shopping-lists/")) {
      const id = Number(path.split("/")[4]);

      return Response.json({ ...lists.find((list) => list.id === id), description: "", items: [] });
    }

    if (path === "/api/objects/shopping_lists" && method === "POST") {
      lists.push({ id: 8, name: JSON.parse(String(init?.body)).name, item_count: 0 });

      return Response.json({ created_object_id: "8" });
    }

    if (path.startsWith("/api/objects/shopping_lists/") && method === "PUT") {
      const id = Number(path.split("/").at(-1));
      const body: { name: string } = JSON.parse(String(init?.body));
      lists = lists.map((list) => (list.id === id ? { ...list, name: body.name } : list));

      return new Response(null, { status: 204 });
    }

    if (path.startsWith("/api/objects/shopping_lists/") && method === "DELETE") {
      lists = lists.filter((list) => list.id !== Number(path.split("/").at(-1)));

      return new Response(null, { status: 204 });
    }

    if (path.startsWith("/api/userfields/")) {
      const body = z.record(z.string(), z.string()).parse(JSON.parse(String(init?.body)));

      for (const [name, value] of Object.entries(body)) values.set(name, value);

      return new Response(null, { status: 204 });
    }

    if (path.startsWith("/api/files/userfiles/")) {
      if (failUpload && !uploadFailed) {
        uploadFailed = true;

        return Response.json({ error_message: "Upload failed" }, { status: 503 });
      }

      return new Response(null, { status: 204 });
    }

    return Response.json([]);
  });

  vi.stubGlobal("fetch", fetchMock);
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

  return { router, writes, fetchMock };
}

test("legacy list links retain selection through changes and browser history", async () => {
  const { router } = mount("/shoppinglist?list=7");
  const user = userEvent.setup();

  const selector = await screen.findByRole<HTMLSelectElement>("combobox", {
    name: "Shopping list",
  });

  await waitFor(() => expect(selector.value).toBe("7"));
  expect(within(selector).getByRole("option", { name: "Weekend (2)" })).toBeTruthy();
  await user.selectOptions(selector, "1");
  await waitFor(() => expect(router.state.location.search).toEqual({ list: 1 }));
  await act(async () => router.history.back());
  await waitFor(() => expect(selector.value).toBe("7"));
});

test("list creation saves edited custom types and retries an upload on the same list", async () => {
  const browserCrypto = globalThis.crypto;
  vi.stubGlobal("crypto", { getRandomValues: browserCrypto.getRandomValues.bind(browserCrypto) });

  const fields = [
    field(1, "Delivery", "text-single-line", { input_required: 1, default_value: "Door" }),
    field(2, "Confirmed", "checkbox", { input_required: 1 }),
    field(3, "Today", "date", { default_value: "now" }),
    field(4, "Details", "text-multi-line"),
    field(5, "Whole", "number-integral"),
    field(6, "Decimal", "number-decimal"),
    field(7, "Cost", "number-currency"),
    field(8, "Date", "date"),
    field(9, "Time", "datetime"),
    field(10, "Choice", "preset-list", { config: "A\nB" }),
    field(11, "Choices", "preset-checklist", { config: "A\nB\nC" }),
    field(12, "Website", "link"),
    field(13, "Reference", "link-with-title"),
    field(14, "Attachment", "file"),
    field(15, "Picture", "image"),
  ];

  const { router, writes, fetchMock } = mount("/shopping", fields, true);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "New shopping list", hidden: true }));
  const dialog = await screen.findByRole("dialog", { name: "Create shopping list" });
  const form = within(dialog);
  const delivery = await form.findByRole<HTMLInputElement>("textbox", { name: "Delivery" });
  expect(delivery.value).toBe("");
  expect(form.getByLabelText<HTMLInputElement>("Today").value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(form.getByRole<HTMLInputElement>("checkbox", { name: "Confirmed" }).indeterminate).toBe(
    true,
  );
  await user.type(form.getByRole("textbox", { name: "Name" }), "Trip");
  await user.type(delivery, "Side");
  await user.click(form.getByRole("checkbox", { name: "Confirmed" }));
  await user.click(form.getByRole("checkbox", { name: "Confirmed" }));
  await user.type(form.getByLabelText("Details"), "Line one\nLine two");

  for (const [label, value] of [
    ["Whole", "3"],
    ["Decimal", "1.2345"],
    ["Cost", "9.25"],
    ["Date", "2026-11-03"],
    ["Time", "2026-11-03T10:15"],
  ])
    await user.type(form.getByLabelText(label), value);
  await user.selectOptions(form.getByLabelText("Choice"), "B");
  await user.type(form.getByRole("searchbox", { name: "Search: Choices" }), "B");
  await user.click(form.getByRole("button", { name: "Select all" }));
  await user.type(form.getByLabelText("Website"), "example.test");
  await user.type(form.getByLabelText("Title"), "Receipt");
  await user.type(form.getByLabelText("Link", { exact: true }), "receipt.test");
  await user.upload(
    form.getByLabelText("Attachment"),
    new File(["receipt"], "Ä File.TXT", { type: "text/plain" }),
  );
  await user.upload(
    form.getByLabelText("Picture"),
    new File(["image"], "Photo.PNG", { type: "image/png" }),
  );
  await user.click(form.getByRole("button", { name: "Save" }));
  await form.findByText("Upload failed");
  await user.click(form.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(router.state.location.search).toEqual({ list: 8 }));
  expect(
    writes.filter(
      (write) => write.path === "/api/objects/shopping_lists" && write.method === "POST",
    ),
  ).toHaveLength(1);

  const fieldWrites = writes
    .filter((write) => write.path === "/api/userfields/shopping_lists/8")
    .map((write) => JSON.parse(write.body));

  expect(Object.assign({}, ...fieldWrites)).toMatchObject({
    Delivery: "Side",
    Confirmed: "0",
    Details: "Line one\nLine two",
    Whole: "3",
    Decimal: "1.2345",
    Cost: "9.25",
    Date: "2026-11-03",
    Time: "2026-11-03 10:15:00",
    Choice: "B",
    Choices: "B",
    Website: "example.test",
    Reference: '{"title":"Receipt","link":"receipt.test"}',
  });
  expect(fieldWrites.some((body) => "Today" in body)).toBe(false);
  const saved = Object.assign({}, ...fieldWrites);
  expect(atob(saved.Attachment.split("_")[1])).toBe("aefile.txt");
  expect(atob(saved.Picture.split("_")[1])).toBe("photo.png");

  for (const [, init] of fetchMock.mock.calls)
    expect(new Headers(init?.headers).get("GROCY-API-KEY")).toBe("list-key");
});

test("editing writes custom fields before the name and deletion returns to the default list", async () => {
  const { router, writes } = mount("/shopping?list=7", [field(1, "Delivery", "text-single-line")]);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit shopping list", hidden: true }));
  const dialog = await screen.findByRole("dialog", { name: "Edit shopping list", hidden: true });
  const form = within(dialog);
  await user.type(await form.findByLabelText("Delivery"), "Door");
  await user.clear(form.getByLabelText("Name"));
  await user.type(form.getByLabelText("Name"), "Trip");
  await user.click(form.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes.slice(0, 2).map((write) => write.path)).toEqual([
    "/api/userfields/shopping_lists/7",
    "/api/objects/shopping_lists/7",
  ]);
  await user.click(screen.getByRole("button", { name: "Delete shopping list", hidden: true }));

  const confirmation = await screen.findByRole("dialog", {
    name: "Delete shopping list",
    hidden: true,
  });

  await user.click(within(confirmation).getByRole("button", { name: "No" }));
  expect(writes.some((write) => write.method === "DELETE")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Delete shopping list", hidden: true }));
  await user.click(
    within(
      await screen.findByRole("dialog", { name: "Delete shopping list", hidden: true }),
    ).getByRole("button", { name: "Yes" }),
  );
  await waitFor(() => expect(router.state.location.search).toEqual({ list: 1 }));
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Delete shopping list",
      hidden: true,
    }).disabled,
  ).toBe(true);
});
