import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import type { ShoppingListItem } from "@/lib/types";
import { mountNativeEditor } from "./fixtures/native-editor";

function deferred() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function mountShopping({
  holdDelete = false,
  deniedDelete = false,
  stock = true,
  onlyNotes = false,
  basepath = "",
} = {}) {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));

  // JSDOM omits MessageEvent.source for self-postMessage; browsers identify this window.
  const posting = vi.spyOn(window, "postMessage").mockImplementation((data, targetOrigin) => {
    if (targetOrigin !== window.location.origin) return;
    queueMicrotask(() =>
      window.dispatchEvent(
        new MessageEvent("message", { origin: window.location.origin, source: window, data }),
      ),
    );
  });

  onTestFinished(() => posting.mockRestore());

  let rows: ShoppingListItem[] = [
    {
      id: 30,
      product_id: 2,
      amount: 0.3,
      stock_amount: 1.2,
      display_factor: 0.25,
      qu_id: 2,
      done: true,
    },
    {
      id: 11,
      product_id: 1,
      amount: 0.2,
      stock_amount: 0.2,
      display_factor: 1,
      qu_id: 1,
      done: false,
    },
    { id: 40, product_id: null, note: "Bags", amount: 1, qu_id: null, done: false },
    {
      id: 22,
      product_id: 3,
      amount: 2.6,
      stock_amount: 2.6,
      display_factor: 1,
      qu_id: 1,
      done: false,
    },
  ].filter((row) => !onlyNotes || row.product_id === null);

  const deletion = deferred();
  const deletes: number[] = [];
  let deny = deniedDelete;
  let reads = 0;
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => logger.mockRestore());

  const app = mountNativeEditor(
    `${basepath}/shopping`,
    async (url, init) => {
      if (url === "/api/user/settings")
        return Response.json({
          locale: "",
          shopping_list_round_up: true,
          stock_decimal_places_amounts: 2,
        });

      if (url === "/api/v2/user/permissions") return Response.json({});

      if (url === "/api/objects/products")
        return Response.json([
          { id: 1, name: "Apples", location_id: 1, qu_id_stock: 1, qu_id_purchase: 1 },
          { id: 2, name: "Coffee", location_id: 1, qu_id_stock: 1, qu_id_purchase: 2 },
          { id: 3, name: "Bread", location_id: 1, qu_id_stock: 1, qu_id_purchase: 1 },
        ]);

      if (url === "/api/objects/locations") return Response.json([{ id: 1, name: "Pantry" }]);

      if (url === "/api/objects/quantity_units")
        return Response.json([
          { id: 1, name: "Piece", name_plural: "Pieces" },
          { id: 2, name: "Case", name_plural: "Cases" },
        ]);

      if (url === "/api/v2/shopping-lists")
        return Response.json([
          { id: 1, name: "Groceries", description: null, item_count: rows.length },
        ]);

      if (url === "/api/v2/shopping-lists/1") {
        reads++;

        return Response.json({ id: 1, name: "Groceries", description: null, items: rows });
      }

      if (url === "/api/v2/shopping-lists/1/notes/editor") return new Response("<html></html>");
      const target = /^\/api\/objects\/shopping_list\/(11|22|30)$/.exec(url);

      if (target && init?.method === "DELETE") {
        const id = Number(target[1]);
        deletes.push(id);

        if (holdDelete) await deletion.promise;

        if (deny) return Response.json({ error_message: "Delete denied" }, { status: 403 });
        rows = rows.filter((row) => row.id !== id);

        return new Response(null, { status: 204 });
      }

      return undefined;
    },
    {
      FEATURE_FLAG_SHOPPINGLIST: true,
      FEATURE_FLAG_SHOPPINGLIST_MULTIPLE_LISTS: false,
      FEATURE_FLAG_STOCK: stock,
      FEATURE_FLAG_LABEL_PRINTER: false,
    },
    { basepath },
  );

  return {
    ...app,
    deletes,
    deletion,
    logger,
    get reads() {
      return reads;
    },
    allowDelete: () => {
      deny = false;
    },
    replaceRows: (items: ShoppingListItem[]) => {
      rows = items;
    },
    get rows() {
      return rows;
    },
  };
}

async function ready() {
  await screen.findByRole("checkbox", { name: "Apples in the basket" });
}

function frame() {
  // Confirmed purchases can outlive the closed dialog while its frame stays mounted.
  const element = document.querySelector('iframe[title="Purchase"]');

  if (!(element instanceof HTMLIFrameElement)) throw new Error("Purchase frame missing");

  return element;
}

function send(element: HTMLIFrameElement, Message: string, Payload: string | number | null = null) {
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        source: element.contentWindow,
        data: { Message, Payload },
      }),
    ),
  );
}

function itemId() {
  return new URL(frame().src).searchParams.get("listitemid");
}

test("all-items snapshots rendered product order including checked rows, uses rounded stock URLs, and Skip never books or deletes", async () => {
  const app = mountShopping({ basepath: "/house" });
  await ready();
  await userEvent.click(screen.getByRole("button", { name: "In the shop" }));
  await userEvent.click(screen.getByRole("button", { name: "Add all list items to stock" }));
  expect(screen.getByText("Adding shopping list item 1 of 3")).toBeTruthy();
  expect(itemId()).toBe("11");
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        source: window,
        data: { Message: "AfterItemAdded", Payload: 11 },
      }),
    ),
  );
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://other.example",
        source: window,
        data: { Message: "Ready", Payload: null },
      }),
    ),
  );
  expect(screen.getByText("Adding shopping list item 1 of 3")).toBeTruthy();
  const first = frame();
  expect(new URL(first.src).pathname).toBe("/house/purchase");
  expect(new URL(first.src).searchParams.get("amount")).toBe("1");
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "Purchase" })).getByRole("button", { name: "Skip" }),
  );
  await waitFor(() => expect(itemId()).toBe("22"));
  expect(screen.getByText("Adding shopping list item 2 of 3")).toBeTruthy();
  expect(frame()).toBe(first);
  expect(new URL(frame().src).searchParams.get("amount")).toBe("3");
  await userEvent.click(screen.getByRole("button", { name: "Skip" }));
  await waitFor(() => expect(itemId()).toBe("30"));
  expect(screen.getByText("Adding shopping list item 3 of 3")).toBeTruthy();
  expect(new URL(frame().src).searchParams.get("amount")).toBe("2");
  expect(new URL(frame().src).searchParams.get("quId")).toBe("2");
  await userEvent.click(screen.getByRole("button", { name: "Skip" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Purchase" })).toBeNull());
  expect(frame()).toBe(first);
  expect(app.deletes).toEqual([]);
  expect(
    app.fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes("/api/stock/") || ["POST", "PUT"].includes(init?.method ?? ""),
    ),
  ).toEqual([]);
});

test("a captured row removed during the workflow retains the native stalled click, while its original count excludes new rows", async () => {
  const app = mountShopping();
  await ready();
  await userEvent.click(screen.getByRole("button", { name: "Add all list items to stock" }));
  app.replaceRows([
    ...app.rows.filter((row) => row.id !== 22),
    { id: 55, product_id: 3, amount: 9, stock_amount: 9, display_factor: 1, qu_id: 1, done: false },
  ]);
  await act(async () => {
    await app.client.invalidateQueries({ queryKey: ["shopping", 1] });
  });
  await screen.findByText("9 Pieces");
  await userEvent.click(screen.getByRole("button", { name: "Skip" }));
  await waitFor(() => expect(screen.getByText("Adding shopping list item 1 of 3")).toBeTruthy());
  expect(itemId()).toBe("11");
  await userEvent.click(screen.getByRole("button", { name: "Skip" }));
  await waitFor(() => expect(itemId()).toBe("30"));
  expect(screen.getByText("Adding shopping list item 3 of 3")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Skip" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Purchase" })).toBeNull());
  expect(app.deletes).toEqual([]);
});

test("Ready advances before a held row deletion and the child's trailing close resets the newly visible sequence", async () => {
  const app = mountShopping({ holdDelete: true });
  await ready();
  await userEvent.click(screen.getByRole("button", { name: "Add all list items to stock" }));
  const child = frame();
  app.client.setQueryData(["stock", "overview-view", "en"], { product: 1 });
  app.client.setQueryData(["recipe-view", 99], { recipe: 99 });
  send(child, "AfterItemAdded", "11");
  await waitFor(() => expect(app.deletes).toEqual([11]));
  expect(app.client.getQueryState(["stock", "overview-view", "en"])?.isInvalidated).toBe(true);
  expect(app.client.getQueryState(["recipe-view", 99])?.isInvalidated).toBe(true);
  expect(screen.getByRole("checkbox", { name: "Apples in the basket" })).toBeTruthy();
  send(child, "ShowSuccessMessage", "Booked first item");
  send(child, "Ready");
  expect(itemId()).toBe("22");
  expect(screen.getByText("Adding shopping list item 2 of 3")).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Skip" }).disabled).toBe(false);
  expect(frame()).toBe(child);
  send(child, "CloseLastModal");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Purchase" })).toBeNull());
  expect(frame()).toBe(child);
  const coffee = screen.getByRole("checkbox", { name: "Coffee in the basket" }).closest("li")!;
  await userEvent.click(within(coffee).getByRole("link", { name: "Add this item to stock" }));
  expect(itemId()).toBe("30");
  expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  expect(screen.queryByText(/Adding shopping list item/)).toBeNull();
  await act(async () => app.deletion.release());
  await waitFor(() =>
    expect(screen.queryByRole("checkbox", { name: "Apples in the basket" })).toBeNull(),
  );
  expect(itemId()).toBe("30");
  expect(screen.getByRole("dialog", { name: "Purchase" })).toBeTruthy();
});

test("failed shopping-row removal logs without blocking Ready and the retained item can be retried independently", async () => {
  const app = mountShopping({ deniedDelete: true });
  await ready();
  await userEvent.click(screen.getByRole("button", { name: "Add all list items to stock" }));
  const child = frame();
  send(child, "AfterItemAdded", 11);
  send(child, "Ready");
  expect(itemId()).toBe("22");
  await waitFor(() => expect(app.logger).toHaveBeenCalled());
  expect(screen.getByRole("checkbox", { name: "Apples in the basket" })).toBeTruthy();
  expect(screen.queryByText("Delete denied")).toBeNull();
  expect(screen.getByText("Adding shopping list item 2 of 3")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  app.allowDelete();
  const apples = screen.getByRole("checkbox", { name: "Apples in the basket" }).closest("li")!;
  await userEvent.click(within(apples).getByRole("link", { name: "Add this item to stock" }));
  send(frame(), "AfterItemAdded", "11");
  await waitFor(() =>
    expect(screen.queryByRole("checkbox", { name: "Apples in the basket" })).toBeNull(),
  );
  expect(app.deletes).toEqual([11, 11]);
});

test("Cancel resets the queue but keeps a previous step's committed purchase receipt alive", async () => {
  const app = mountShopping();
  await ready();
  await userEvent.click(screen.getByRole("button", { name: "Add all list items to stock" }));
  const child = frame();
  await userEvent.click(screen.getByRole("button", { name: "Skip" }));
  await waitFor(() => expect(itemId()).toBe("22"));
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog", { name: "Purchase" })).toBeNull();
  expect(frame()).toBe(child);
  send(child, "AfterItemAdded", 11);
  send(child, "Ready");
  await waitFor(() =>
    expect(screen.queryByRole("checkbox", { name: "Apples in the basket" })).toBeNull(),
  );
  expect(itemId()).toBe("22");
  expect(screen.queryByRole("dialog", { name: "Purchase" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Add all list items to stock" }));
  expect(screen.getByText("Adding shopping list item 1 of 2")).toBeTruthy();
  expect(itemId()).toBe("22");
  expect(app.deletes).toEqual([11]);
});

test("a committed row deletion after departure invalidates warm shopping reads without advancing or refetching the departed page", async () => {
  const app = mountShopping({ holdDelete: true });
  await ready();
  await userEvent.click(screen.getByRole("button", { name: "Add all list items to stock" }));
  const child = frame();
  send(child, "AfterItemAdded", 11);
  await waitFor(() => expect(app.deletes).toEqual([11]));
  await act(async () => app.router.navigate({ href: "/usersettings" }));
  await screen.findByLabelText("Language");
  const reads = app.reads;
  app.client.setQueryData(["shopping", 1], {
    id: 1,
    name: "Groceries",
    description: null,
    items: app.rows,
  });
  await act(async () => app.deletion.release());
  await waitFor(() => expect(app.client.getQueryState(["shopping", 1])?.isInvalidated).toBe(true));
  expect(app.reads).toBe(reads);
  expect(screen.queryByRole("dialog", { name: "Purchase" })).toBeNull();
  expect(screen.queryByText(/Adding shopping list item/)).toBeNull();
  expect(app.router.history.location.pathname).toBe("/usersettings");
  await act(async () => app.router.navigate({ href: "/shopping" }));
  await screen.findByRole("checkbox", { name: "Bread in the basket" });
  await userEvent.click(screen.getByRole("button", { name: "Add all list items to stock" }));
  expect(itemId()).toBe("22");
  expect(screen.getByText("Adding shopping list item 1 of 2")).toBeTruthy();
});

test.each([false, true])(
  "STOCK=%s keeps all-items unavailable for a note-only list",
  async (stock) => {
    mountShopping({ stock, onlyNotes: true });
    await screen.findByRole("checkbox", { name: "Bags in the basket" });

    const action = screen.queryByRole<HTMLButtonElement>("button", {
      name: "Add all list items to stock",
    });

    if (stock) expect(action?.disabled).toBe(true);
    else expect(action).toBeNull();
  },
);
