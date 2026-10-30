import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { writeApiConfig } from "@/lib/config";
import { useState } from "react";
import { ShoppingPage } from "@/components/ShoppingPage";

function Shopping() {
  const [id, setId] = useState(1);

  return <ShoppingPage selectedListId={id} onListChange={setId} />;
}

test("an imported shopping quantity displays its saved unit", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const path = String(input);

      if (path === "/api/objects/products") {
        return Response.json([{ id: 1, name: "Milk", qu_id_stock: 1, qu_id_purchase: 2 }]);
      }

      if (path === "/api/objects/quantity_units") {
        return Response.json([
          { id: 1, name: "Piece", name_plural: "Pieces" },
          { id: 2, name: "Case", name_plural: "Cases" },
        ]);
      }

      if (path === "/api/v2/shopping-lists/1") {
        return Response.json({
          id: 1,
          name: "Groceries",
          items: [{ id: 1, product_id: 1, amount: 2, qu_id: 2, done: false }],
        });
      }

      return Response.json([]);
    }),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Shopping />
    </QueryClientProvider>,
  );
  await screen.findByText("2 Cases");
});

test("a failed purchase leaves only unfinished shopping items for retry", async () => {
  let items = [
    { id: 1, product_id: 1, amount: 1, qu_id: 1, done: true },
    { id: 2, product_id: 2, amount: 1, qu_id: 1, done: true },
  ];

  let secondAttempts = 0;
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const path = String(input);

      if (path === "/api/objects/products") {
        return Response.json([
          { id: 1, name: "Milk", qu_id_stock: 1 },
          { id: 2, name: "Eggs", qu_id_stock: 1 },
        ]);
      }

      if (path === "/api/objects/quantity_units") {
        return Response.json([{ id: 1, name: "Piece", name_plural: "Pieces" }]);
      }

      if (path === "/api/v2/shopping-lists/1") {
        return Response.json({ id: 1, name: "Groceries", items });
      }

      if (path === "/api/v2/shopping-lists/1/items/1/purchase") {
        items = items.filter((item) => item.id !== 1);

        return Response.json({ purchased: true, bookings: [] });
      }

      if (path === "/api/v2/shopping-lists/1/items/2/purchase") {
        secondAttempts += 1;

        if (secondAttempts === 1) {
          return Response.json({ error_message: "Purchase could not be saved" }, { status: 400 });
        }

        items = [];

        return Response.json({ purchased: true, bookings: [] });
      }

      return Response.json([]);
    }),
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Shopping />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Put 2 in stock" }));
  await user.click(await screen.findByRole("button", { name: "Put 1 in stock" }));
  await screen.findByText(/The list is empty/);
  expect(secondAttempts).toBe(2);
});

test("notes save only trusted editor changes and retain the draft after a failed request", async () => {
  writeApiConfig({ baseUrl: "/house", apiKey: "notes-key" });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  let writes = 0;

  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input).replace(/^\/house/, "");

    if (path === "/api/system/config")
      return Response.json({ FEATURE_FLAG_SHOPPINGLIST_MULTIPLE_LISTS: true });

    if (path === "/api/v2/shopping-lists")
      return Response.json([
        { id: 1, name: "Groceries" },
        { id: 7, name: "Weekend" },
      ]);

    if (path.startsWith("/api/v2/shopping-lists/") && path.endsWith("/notes/editor"))
      return new Response("<!doctype html><title>Notes</title>");

    if (path.startsWith("/api/v2/shopping-lists/"))
      return Response.json({
        id: Number(path.split("/").at(-1)),
        name: "Weekend",
        description: "<p>Saved</p>",
        items: [],
      });

    if (path === "/api/objects/shopping_lists/7" && init?.method === "PUT") {
      writes++;

      return writes === 1
        ? Response.json({ error_message: "Notes could not be saved" }, { status: 503 })
        : new Response(null, { status: 204 });
    }

    return Response.json([]);
  });

  vi.stubGlobal("fetch", transport);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const app = render(
    <QueryClientProvider client={client}>
      <Shopping />
    </QueryClientProvider>,
  );

  onTestFinished(() => {
    app.unmount();
    client.clear();
  });
  const user = userEvent.setup();
  await screen.findByRole("option", { name: /^Weekend/ });
  await user.selectOptions(await screen.findByRole("combobox", { name: "Shopping list" }), "7");
  const notes = await screen.findByRole("region", { name: "Notes" });
  const frame = within(notes).getByTitle<HTMLIFrameElement>("Notes");
  await waitFor(() => expect(frame.srcdoc).toContain("<title>Notes</title>"));
  const save = within(notes).getByRole<HTMLButtonElement>("button", { name: "Save" });
  const draft = "<p>Bring <strong>bread</strong> &amp; milk.</p>";

  const change = {
    channel: "grocy-shopping-notes",
    kind: "change",
    html: draft,
    empty: false,
    height: 390,
    fullscreen: false,
  };

  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", { source: window, origin: "null", data: change }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "https://example.org",
        data: change,
      }),
    );
  });
  expect(save.disabled).toBe(true);
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: change }),
    ),
  );
  expect(save.disabled).toBe(false);
  await user.click(save);
  expect((await screen.findByRole("alert")).textContent).toBe("Notes could not be saved");
  expect(save.disabled).toBe(false);
  await user.click(save);
  await waitFor(() => expect(save.disabled).toBe(true));

  const saved = transport.mock.calls.filter(
    ([path, init]) =>
      String(path).endsWith("/api/objects/shopping_lists/7") && init?.method === "PUT",
  );

  expect(saved).toHaveLength(2);

  for (const [path, init] of saved) {
    expect(path).toBe("/house/api/objects/shopping_lists/7");
    expect(JSON.parse(String(init?.body))).toEqual({ description: draft });
    expect(new Headers(init?.headers).get("GROCY-API-KEY")).toBe("notes-key");
  }
});

test("clear done items retains open items in the selected list", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));

  let items = [
    { id: 1, note: "Milk", product_id: null, amount: 1, done: false },
    { id: 2, note: "Bags", product_id: null, amount: 1, done: true },
  ];

  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input);

    if (path === "/api/v2/shopping-lists/7")
      return Response.json({ id: 7, name: "Trip", description: "", items });

    if (path === "/api/stock/shoppinglist/clear") {
      expect(JSON.parse(String(init?.body))).toEqual({ list_id: 7, done_only: true });
      items = items.filter((item) => !item.done);

      return new Response(null, { status: 204 });
    }

    return Response.json([]);
  });

  vi.stubGlobal("fetch", transport);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ShoppingPage selectedListId={7} onListChange={() => {}} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await screen.findByRole("checkbox", { name: "Bags in the basket" });
  await user.click(screen.getByRole("button", { name: "Clear done items" }));
  await waitFor(() =>
    expect(screen.queryByRole("checkbox", { name: "Bags in the basket" })).toBeNull(),
  );
  expect(screen.getByRole("checkbox", { name: "Milk in the basket" })).toBeTruthy();
});
