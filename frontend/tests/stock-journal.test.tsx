import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import type { JournalRow } from "@/lib/stock-journal";
import { supportProductOptions } from "./fixtures/product-options";
import { supportDescriptionEditors } from "./fixtures/editor";

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

function mount(path: string, fail = false, stock = true) {
  const rows: JournalRow[] = [
    {
      id: 101,
      product_id: 7,
      product_name: "Coffee",
      amount: 3,
      qu_name: "Piece",
      qu_name_plural: "Pieces",
      row_created_timestamp: "2026-10-28 12:00:00",
      transaction_type: "purchase",
      location_id: 1,
      location_name: "Shelf",
      user_display_name: "Alice",
      note: "Restock",
      stock_id: "mint",
      spoiled: 0,
      undone: 0,
      undone_timestamp: null,
      correlation_id: null,
      custom_values: { batch: "Mint" },
    },
    {
      id: 102,
      product_id: 7,
      product_name: "Coffee",
      amount: -1,
      qu_name: "Piece",
      qu_name_plural: "Pieces",
      row_created_timestamp: "2026-10-27 12:00:00",
      transaction_type: "consume",
      location_id: 1,
      location_name: "Shelf",
      user_display_name: "Bob",
      note: "Morning",
      stock_id: "mint",
      spoiled: 1,
      undone: 0,
      undone_timestamp: null,
      correlation_id: null,
      custom_values: { batch: "Mint" },
    },
    {
      id: 103,
      product_id: 7,
      product_name: "Coffee",
      amount: 1,
      qu_name: "Piece",
      qu_name_plural: "Pieces",
      row_created_timestamp: "2026-10-26 12:00:00",
      transaction_type: "transfer_to",
      location_id: 2,
      location_name: "Cellar",
      user_display_name: "Alice",
      note: "Moved",
      stock_id: "mint",
      spoiled: 0,
      undone: 0,
      undone_timestamp: null,
      correlation_id: "move",
      custom_values: { batch: "Mint" },
    },
    {
      id: 104,
      product_id: 7,
      product_name: "Coffee",
      amount: -1,
      qu_name: "Piece",
      qu_name_plural: "Pieces",
      row_created_timestamp: "2026-10-26 11:00:00",
      transaction_type: "transfer_from",
      location_id: 1,
      location_name: "Shelf",
      user_display_name: "Alice",
      note: "Moved",
      stock_id: "mint",
      spoiled: 0,
      undone: 0,
      undone_timestamp: null,
      correlation_id: "move",
      custom_values: { batch: "Mint" },
    },
    {
      id: 105,
      product_id: 7,
      product_name: "Coffee",
      amount: 2,
      qu_name: "Piece",
      qu_name_plural: "Pieces",
      row_created_timestamp: "2025-01-01 12:00:00",
      transaction_type: "purchase",
      location_id: 1,
      location_name: "Shelf",
      user_display_name: "Alice",
      note: "Old stock",
      stock_id: "old",
      spoiled: 0,
      undone: 0,
      undone_timestamp: null,
      correlation_id: null,
      custom_values: {},
    },
    {
      id: 106,
      product_id: 8,
      product_name: "Tea",
      amount: 4,
      qu_name: "Piece",
      qu_name_plural: "Pieces",
      row_created_timestamp: "2026-10-28 11:00:00",
      transaction_type: "purchase",
      location_id: 1,
      location_name: "Shelf",
      user_display_name: "Alice",
      note: "Tea stock",
      stock_id: "tea",
      spoiled: 0,
      undone: 0,
      undone_timestamp: null,
      correlation_id: null,
      custom_values: {},
    },
  ];

  const products = [
    {
      id: 7,
      name: "Coffee",
      location_id: 1,
      qu_id_stock: 1,
      qu_id_purchase: 1,
      qu_id_consume: 1,
      qu_id_price: 1,
    },
    {
      id: 8,
      name: "Tea",
      location_id: 1,
      qu_id_stock: 1,
      qu_id_purchase: 1,
      qu_id_consume: 1,
      qu_id_price: 1,
    },
  ];

  const writes: string[] = [];
  let reads = 0;
  let undos = 0;
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), "http://test.invalid");
      const path = url.pathname;

      if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (path === "/api/user") return Response.json([{ id: 1, username: "Test" }]);

      if (path === "/api/system/config") return Response.json({ FEATURE_FLAG_STOCK: stock });

      if (path === "/api/user/settings") return Response.json({});

      if (path.includes("/shopping-lists/")) return Response.json({ items: [] });

      if (path === "/api/system/info")
        return Response.json({ grocy_version: { Version: "4.5.0", ReleaseDate: "" } });

      if (path === "/api/v2/localization")
        return Response.json({
          locale: "en",
          direction: "ltr",
          languages: ["en"],
          catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
        });

      if (path === "/api/objects/products") return Response.json(products);

      if (path === "/api/objects/locations")
        return Response.json([
          { id: 1, name: "Shelf" },
          { id: 2, name: "Cellar" },
        ]);

      if (path === "/api/objects/quantity_units")
        return Response.json([{ id: 1, name: "Piece", name_plural: "Pieces" }]);

      if (path === "/api/objects/userfields")
        return Response.json([
          {
            id: 9,
            entity: "stock",
            name: "batch",
            caption: "Batch",
            type: "text-single-line",
            input_required: 0,
            default_value: null,
            config: null,
            show_as_column_in_tables: 1,
            sort_number: 0,
          },
        ]);

      if (path === "/api/v2/stock/journal") {
        if (fail && ++reads === 1)
          return Response.json({ error_message: "Journal unavailable" }, { status: 503 });

        return Response.json({
          products: products.map(({ id, name }) => ({ id, name })),
          locations: [
            { id: 2, name: "Cellar" },
            { id: 1, name: "Shelf" },
          ],
          users: [
            { id: 1, name: "Alice" },
            { id: 2, name: "Bob" },
          ],
          transaction_types: ["consume", "purchase", "transfer_from", "transfer_to"],
          rows: rows.filter(
            (row) =>
              (!url.searchParams.has("product") ||
                row.product_id === Number(url.searchParams.get("product"))) &&
              (row.id !== 105 || url.searchParams.get("months") === "9999"),
          ),
        });
      }

      if (init?.method && init.method !== "GET") {
        writes.push(`${init.method} ${path}`);

        if (path === "/api/stock/bookings/103/undo") {
          if (fail && ++undos === 1)
            return Response.json({ error_message: "Undo failed" }, { status: 500 });

          for (const row of rows.filter((row) => row.correlation_id === "move")) {
            row.undone = 1;
            row.undone_timestamp = "2026-10-28 13:00:00";
          }
        }

        return new Response(null, { status: 204 });
      }

      return Response.json([]);
    }),
  );
  supportProductOptions();
  supportDescriptionEditors();
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

  return { writes, router };
}

test("product journal keeps the draft through read retry, filters, linked undo, and closing", async () => {
  const { writes, router } = mount("/product/7", true);
  const user = userEvent.setup();
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  await user.type(name, " draft");
  const trigger = screen.getByRole("button", { name: "Stock journal" });
  await user.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Stock journal" });
  const view = within(dialog);
  await view.findByText("Journal unavailable");
  await user.click(view.getByRole("button", { name: "Retry journal" }));
  await view.findByText("Restock");
  expect(view.queryByRole("combobox", { name: "Product" })).toBeNull();
  expect(view.getByRole("columnheader", { name: "Batch" })).toBeTruthy();
  await user.type(view.getByRole("searchbox", { name: "Search journal" }), '"Morning" Mint');
  await user.keyboard("{Enter}");
  expect(view.getAllByRole("button", { name: /^Undo transaction/ })).toHaveLength(1);
  await user.click(view.getByRole("button", { name: "Clear filter" }));
  await user.selectOptions(view.getByRole("combobox", { name: "Transaction type" }), "consume");
  await user.selectOptions(view.getByRole("combobox", { name: "Done by" }), "2");
  expect(view.getAllByRole("button", { name: /^Undo transaction/ })).toHaveLength(1);
  await user.click(view.getByRole("button", { name: "Clear filter" }));
  await user.selectOptions(view.getByRole("combobox", { name: "Location" }), "2");
  expect(view.getAllByRole("button", { name: /^Undo transaction/ })).toHaveLength(1);
  await user.click(view.getByRole("button", { name: "Clear filter" }));
  await user.click(view.getByRole("button", { name: "Amount" }));
  expect(
    view.getAllByRole("button", { name: /^Undo transaction/ })[0]?.getAttribute("aria-label"),
  ).toBe("Undo transaction 102");
  await user.selectOptions(view.getByRole("combobox", { name: "Date range" }), "9999");
  await view.findByText("Old stock");
  await user.click(view.getByRole("button", { name: "Undo transaction 103" }));
  await view.findByText("Undo failed");
  await user.click(view.getByRole("button", { name: "Undo transaction 103" }));
  await waitFor(() =>
    expect(
      view.getByRole<HTMLButtonElement>("button", { name: "Undo transaction 103" }).disabled,
    ).toBe(true),
  );
  expect(
    view.getByRole<HTMLButtonElement>("button", { name: "Undo transaction 104" }).disabled,
  ).toBe(true);
  expect(writes).toEqual([
    "POST /api/stock/bookings/103/undo",
    "POST /api/stock/bookings/103/undo",
  ]);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
  expect(name.value).toBe("Coffee draft");
  expect(router.state.location.href).toBe("/product/7");
});

test.each(["/journal", "/stockjournal"])(
  "%s retains native date and product query rules",
  async (path) => {
    const { router } = mount(
      `${path}?product=7&months=9999${path === "/stockjournal" ? "&embedded=false" : ""}`,
    );

    const user = userEvent.setup();
    await screen.findByText("Old stock");

    if (path === "/stockjournal")
      expect(screen.queryByRole("combobox", { name: "Product" })).toBeNull();
    else {
      await user.selectOptions(screen.getByRole("combobox", { name: "Product" }), "8");
      await screen.findByText("Tea stock");
    }

    await user.click(screen.getByRole("button", { name: "Clear filter" }));
    await waitFor(() =>
      expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Date range" }).value).toBe(
        "6",
      ),
    );
    expect(router.state.location.search.product).toBe(path === "/stockjournal" ? "7" : undefined);
    expect(router.state.location.search.months).toBeUndefined();
  },
);

test("the legacy journal route obeys the disabled stock feature", async () => {
  mount("/stockjournal?product=7", false, false);
  await screen.findByRole("heading", { name: "Feature disabled" });
});
