import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import type { JsonValue } from "@/lib/json";
import { writeApiConfig } from "@/lib/config";

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

function mount(path = "/shopping?list=7", { basepath = "/", heldDelete = false } = {}) {
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

  const writes: { path: string; method: string; body: string }[] = [];
  let release = () => {};

  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input).replace(/^\/house/, "");
    const method = init?.method ?? "GET";

    if (method !== "GET") writes.push({ path, method, body: String(init?.body ?? "") });

    if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

    if (path === "/api/user") return Response.json([{ id: 1, username: "test" }]);

    if (path === "/api/user/settings" || path === "/api/v2/user/permissions")
      return Response.json({});

    if (path === "/api/v2/localization")
      return Response.json({
        locale: "en",
        direction: "ltr",
        languages: ["en"],
        catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
      });

    if (path === "/api/system/config")
      return Response.json({ FEATURE_FLAG_SHOPPINGLIST_MULTIPLE_LISTS: true });

    if (path === "/api/v2/shopping-lists") return Response.json(lists);

    if (path.startsWith("/api/v2/shopping-lists/native-context")) {
      const selected = new URL(path, "http://grocy.test").searchParams.get("list") ?? 1;
      const metadata = lists.map((row) => ({ ...row, description: "" }));

      return Response.json({
        list_id: selected,
        list: metadata.find((row) => row.id === Number(selected)) ?? null,
        lists: metadata,
        items: [],
        products: [],
        units: [],
        notes_document: "<html><body></body></html>",
      });
    }

    if (path.startsWith("/api/v2/shopping-lists/")) {
      const id = Number(path.split("/")[4]);

      return Response.json({ ...lists.find((list) => list.id === id), description: "", items: [] });
    }

    if (path.startsWith("/api/objects/shopping_lists/") && method === "DELETE") {
      if (heldDelete) await held;
      lists = lists.filter((list) => list.id !== Number(path.split("/").at(-1)));

      return new Response(null, { status: 204 });
    }

    return Response.json([]);
  });

  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const router = createAppRouter({
    basepath,
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
    router,
    writes,
    fetchMock,
    release,
    addList: (id: number, name: string) => lists.push({ id, name, item_count: 0 }),
  };
}

test("native list links retain their path and selection through changes and browser history", async () => {
  const { router } = mount("/shoppinglist?list=7");
  const user = userEvent.setup();

  const selector = await screen.findByRole<HTMLSelectElement>("combobox", {
    name: "Shopping list",
  });

  await waitFor(() => expect(selector.value).toBe("7"));
  expect(router.state.location.pathname).toBe("/shoppinglist");
  expect(within(selector).getByRole("option", { name: "Weekend (2)" })).toBeTruthy();
  await user.selectOptions(selector, "1");
  await waitFor(() =>
    expect(new URLSearchParams(router.history.location.search).get("list")).toBe("1"),
  );
  await act(async () => router.history.back());
  await waitFor(() =>
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Shopping list" }).value).toBe(
      "7",
    ),
  );
});

test("shopping deletion closes confirmation during the request and cannot navigate after departure", async () => {
  const app = mount("/shopping?list=7", { heldDelete: true });
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Delete shopping list", hidden: true }),
  );
  await user.click(
    within(screen.getByRole("dialog", { name: "Delete shopping list", hidden: true })).getByRole(
      "button",
      { name: "Yes" },
    ),
  );
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
  await act(async () => app.release());
  expect(app.router.state.location.pathname).toBe("/settings");
});

test("shopping actions expose selected native iframe links and keep cancellation local", async () => {
  const { router, writes } = mount("/shopping?list=7");
  const user = userEvent.setup();
  const create = await screen.findByRole("link", { name: "New shopping list", hidden: true });
  expect(create.getAttribute("href")).toBe("/shoppinglist/new?embedded=");
  const edit = screen.getByRole("link", { name: "Edit shopping list", hidden: true });
  expect(edit.getAttribute("href")).toBe("/shoppinglist/7?embedded=");
  await user.click(create);
  const dialog = screen.getByRole("dialog", { name: "Shopping list" });
  expect(within(dialog).getByTitle("Shopping list").getAttribute("src")).toContain(
    "/shoppinglist/new?embedded=",
  );
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(writes).toEqual([]);
  expect(router.state.location.pathname).toBe("/shopping");
});

test.each([8, "8"])(
  "shopping-list completion selects and refreshes the reported list: %s",
  async (payload) => {
    const app = mount("/shopping?list=7");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Edit shopping list", hidden: true }));
    app.addList(8, "Trip");

    const send = (Payload: JsonValue, origin = window.location.origin) =>
      fireEvent(
        window,
        new MessageEvent("message", { origin, data: { Message: "ShoppingListChanged", Payload } }),
      );

    send(payload, "https://foreign.test");

    for (const invalid of [null, true, {}, "bad", "0", -1]) send(invalid);
    expect(new URLSearchParams(app.router.history.location.search).get("list")).toBe("7");
    send(payload);
    await screen.findByRole("heading", { name: "Trip" });
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Shopping list" }).value).toBe(
      "8",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent(
      window,
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { Message: "Ready", Payload: null },
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent(
      window,
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { Message: "CloseLastModal", Payload: null },
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(new URLSearchParams(app.router.history.location.search).get("list")).toBe("8");
    expect(app.writes).toEqual([]);
  },
);

test("shopping-list messages have no navigation owner after the shopping page leaves", async () => {
  const app = mount();
  await screen.findByRole("heading", { name: "Weekend" });
  await act(async () => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
  fireEvent(
    window,
    new MessageEvent("message", {
      origin: window.location.origin,
      data: { Message: "ShoppingListChanged", Payload: "8" },
    }),
  );
  expect(app.router.state.location.pathname).toBe("/settings");
});

test("shopping-list deletion respects cancellation and returns to the default list", async () => {
  const { router, writes } = mount("/shopping?list=7");
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Delete shopping list", hidden: true }),
  );
  const confirmation = screen.getByRole("dialog", { name: "Delete shopping list", hidden: true });
  await user.click(within(confirmation).getByRole("button", { name: "No" }));
  expect(writes).toEqual([]);
  await user.click(screen.getByRole("button", { name: "Delete shopping list", hidden: true }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Delete shopping list", hidden: true })).getByRole(
      "button",
      { name: "Yes" },
    ),
  );
  await waitFor(() =>
    expect(new URLSearchParams(router.history.location.search).get("list")).toBeNull(),
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Delete shopping list", hidden: true })
      .disabled,
  ).toBe(true);
});

test("shopping editor links preserve the frontend path prefix", async () => {
  mount("/home/shopping?list=7", { basepath: "/home" });
  const link = await screen.findByRole("link", { name: "Edit shopping list", hidden: true });
  expect(link.getAttribute("href")).toBe("/home/shoppinglist/7?embedded=");
});
