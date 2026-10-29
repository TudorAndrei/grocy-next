import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import type { JournalRow } from "@/lib/stock-journal";
import type { UserSettings } from "@/lib/types";
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

function mount(
  path: string,
  fail: boolean | "reload" = false,
  stock = true,
  savedSettings: UserSettings = {},
  failTableWrites = false,
  settingsReady?: Promise<void>,
) {
  const settings: UserSettings = { stock_decimal_places_amounts: "2", ...savedSettings };
  const tableWrites: { method: string; key: string; value?: string }[] = [];
  let failedLayout = false;
  let failedReset = false;

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

  const tea = rows[5];

  if (!tea) throw new Error("Missing Tea fixture");
  rows.push(
    {
      ...tea,
      id: 107,
      amount: 2,
      location_id: 3,
      location_name: "North Shelf",
      user_display_name: "Alex Lane",
      note: "North booking",
    },
    {
      ...tea,
      id: 108,
      amount: 10,
      location_id: 4,
      location_name: "Shelf North",
      user_display_name: "Lane Alex",
      note: "South booking",
    },
  );

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

      if (path === "/api/user/settings") {
        await settingsReady;

        return Response.json(settings);
      }

      if (path.startsWith("/api/user/settings/")) {
        const key = decodeURIComponent(path.slice("/api/user/settings/".length));
        const value = init?.method === "PUT" ? JSON.parse(String(init.body)).value : undefined;
        tableWrites.push({ method: init?.method ?? "GET", key, value });

        if (
          failTableWrites &&
          init?.method === "PUT" &&
          key.startsWith("datatables_state_") &&
          !JSON.parse(value).columns[3].visible &&
          !failedLayout
        ) {
          failedLayout = true;

          return Response.json({ error_message: "Table save failed" }, { status: 500 });
        }

        if (
          failTableWrites &&
          init?.method === "DELETE" &&
          key.startsWith("datatables_state_") &&
          !failedReset
        ) {
          failedReset = true;

          return Response.json({ error_message: "Table reset failed" }, { status: 500 });
        }

        if (init?.method === "DELETE") delete settings[key];
        else settings[key] = value;

        return new Response(null, { status: 204 });
      }

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
        reads++;

        if ((fail === true && reads === 1) || (fail === "reload" && reads === 2))
          return Response.json({ error_message: "Journal unavailable" }, { status: 503 });

        return Response.json({
          products: products.map(({ id, name }) => ({ id, name })),
          locations: [
            { id: 2, name: "Cellar" },
            { id: 1, name: "Shelf" },
            { id: 3, name: "North Shelf" },
            { id: 4, name: "Shelf North" },
          ],
          users: [
            { id: 1, name: "Alice" },
            { id: 2, name: "Bob" },
            { id: 3, name: "Alex Lane" },
            { id: 4, name: "Lane Alex" },
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

      if (path === "/api/v2/stock/journal/summary") {
        if (fail && ++reads === 1)
          return Response.json({ error_message: "Summary unavailable" }, { status: 503 });

        const summary = [
          {
            product_id: 7,
            product_name: "Coffee",
            user_id: 1,
            user_display_name: "Alice",
            transaction_type: "purchase",
            amount: 1000.005,
          },
          {
            product_id: 7,
            product_name: "Coffee",
            user_id: 2,
            user_display_name: "Bob",
            transaction_type: "consume",
            amount: -1,
          },
          {
            product_id: 8,
            product_name: "Tea",
            user_id: 1,
            user_display_name: "Alice",
            transaction_type: "purchase",
            amount: 4,
          },
          {
            product_id: 9,
            product_name: "Old coffee",
            user_id: 1,
            user_display_name: "Alice",
            transaction_type: "purchase",
            amount: 2,
          },
        ];

        return Response.json({
          products: products.map(({ id, name }) => ({ id, name })),
          users: [
            { id: 1, name: "Alice" },
            { id: 2, name: "Bob" },
          ],
          transaction_types: ["consume", "purchase"],
          rows: summary.flatMap((row) =>
            (["product_id", "user_id", "transaction_type"] as const).every(
              (key) => !url.searchParams.has(key) || String(row[key]) === url.searchParams.get(key),
            )
              ? [{ ...row, qu_name: "Piece", qu_name_plural: "Pieces" }]
              : [],
          ),
        });
      }

      if (init?.method && init.method !== "GET") {
        writes.push(`${init.method} ${path}`);

        if (path === "/api/stock/bookings/103/undo") {
          if (fail === true && ++undos === 1)
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

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });

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

  return { writes, router, tableWrites, settings };
}

function nativeLayout(
  count: number,
  order: number[],
  hidden: number[] = [],
  sorts: [number, "asc" | "desc"][] = [[1, "desc"]],
) {
  const search = { search: "", smart: true, regex: false, caseInsensitive: true };

  return JSON.stringify({
    time: 1793231338715,
    start: 0,
    length: 10,
    order: sorts,
    search,
    columns: Array.from({ length: count }, (_, i) => ({ visible: !hidden.includes(i), search })),
    ColReorder: order,
    select: { rows: [], columns: [], cells: [] },
    childRows: [],
  });
}

test("summary imports a native layout and saves retryable visibility, order, groups, and reset", async () => {
  const key = "datatables_state_stock-journal-summary-table";
  const groupKey = "datatables_rowGroup_stock-journal-summary-table";

  const { router, tableWrites, settings } = mount(
    "/stockjournal/summary",
    false,
    true,
    {
      [key]: nativeLayout(
        5,
        [0, 3, 1, 2, 4],
        [4],
        [
          [1, "desc"],
          [3, "desc"],
        ],
      ),
    },
    true,
  );

  const user = userEvent.setup();
  const table = await screen.findByRole("table", { name: "Stock journal summary" });

  const headers = () =>
    within(table)
      .getAllByRole("columnheader")
      .slice(1)
      .map((header) => header.textContent);

  expect(headers()).toEqual(["User", "Product", "Transaction type"]);
  expect(within(within(table).getAllByRole("row")[3]!).getByText("Bob")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Table options" }));
  let dialog = within(await screen.findByRole("dialog", { name: "Table options" }));
  await user.click(dialog.getByRole("checkbox", { name: "User" }));
  await dialog.findByText("Table save failed");
  await user.click(dialog.getByRole("button", { name: "Retry table options" }));
  await waitFor(() => expect(JSON.parse(String(settings[key])).columns[3].visible).toBe(false));
  await user.click(dialog.getByRole("checkbox", { name: "Amount" }));
  await user.click(dialog.getByRole("button", { name: "Move Product earlier" }));
  await user.click(dialog.getByRole("radio", { name: "Product" }));
  await waitFor(() => expect(settings[groupKey]).toBe('{"enable":true,"dataSrc":"1"}'));
  await user.click(dialog.getByRole("button", { name: "OK" }));
  expect(headers()).toEqual(["Product", "Transaction type", "Amount"]);
  await user.click(within(table).getByRole("button", { name: "Coffee" }));
  expect(within(table).queryAllByRole("rowheader", { name: "Coffee" })).toHaveLength(0);
  await router.navigate({ to: "/journal" });
  await router.navigate({ to: "/stockjournal/summary" });
  await screen.findByRole("button", { name: "Coffee" });
  await user.type(screen.getByRole("searchbox", { name: "Search summary" }), "Tea");
  await user.click(screen.getByRole("button", { name: "Amount" }));
  await waitFor(() => expect(JSON.parse(String(settings[key])).order).toEqual([[4, "asc"]]));
  expect(JSON.parse(String(settings[key])).search.search).toBe("");
  expect(
    JSON.parse(String(settings[key])).columns.every(
      (column: { search: { search: string } }) => column.search.search === "",
    ),
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: "Table options" }));
  dialog = within(await screen.findByRole("dialog", { name: "Table options" }));
  await user.click(dialog.getByRole("button", { name: "Reset" }));

  const confirmation = within(
    await screen.findByRole("dialog", {
      name: "Are you sure you want to reset the table options?",
    }),
  );

  await user.click(confirmation.getByRole("button", { name: "Yes" }));
  await confirmation.findByText("Table reset failed");
  await user.click(confirmation.getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const restored = screen.getByRole("table", { name: "Stock journal summary" });
  expect(
    within(restored)
      .getAllByRole("columnheader")
      .slice(1)
      .map((header) => header.textContent),
  ).toEqual(["Product", "Transaction type", "User", "Amount"]);
  expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search summary" }).value).toBe(
    "",
  );
  expect(settings[groupKey]).toBeUndefined();
  expect(
    tableWrites.filter((write) => write.method === "DELETE").map((write) => write.key),
  ).toEqual([groupKey, key, key]);
});

test("journal imports its native column numbers and keeps filters on a hidden column", async () => {
  mount("/stockjournal?product=7&months=9999", false, true, {
    "datatables_state_stock-journal-table": nativeLayout(9, [0, 7, 1, 2, 3, 4, 5, 6, 8], [5]),
    "datatables_rowGroup_stock-journal-table": '{"enable":true,"dataSrc":"2"}',
  });
  const user = userEvent.setup();
  const table = await screen.findByRole("table", { name: "Stock journal" });

  const headers = within(table)
    .getAllByRole("columnheader")
    .slice(1)
    .map((header) => header.textContent);

  expect(headers.slice(0, 2)).toEqual(["Note", "Product"]);
  expect(within(table).queryByRole("columnheader", { name: "Location" })).toBeNull();
  await user.selectOptions(screen.getByRole("combobox", { name: "Location" }), "2");
  expect(within(table).getAllByRole("button", { name: /^Undo transaction/ })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Table options" }));
  const dialog = await screen.findByRole("dialog", { name: "Table options" });
  expect(within(dialog).getByRole<HTMLInputElement>("radio", { name: "Product" }).checked).toBe(
    true,
  );
  fireEvent(dialog, new Event("cancel", { cancelable: true, bubbles: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Table options" }));
});

test("summary keeps drawn groups after a column move until the next table draw", async () => {
  mount("/stockjournal/summary", false, true, {
    "datatables_rowGroup_stock-journal-summary-table": '{"enable":true,"dataSrc":"1"}',
  });
  const user = userEvent.setup();
  const table = await screen.findByRole("table", { name: "Stock journal summary" });

  const groups = () =>
    Array.from(table.querySelectorAll(".stock-table-group button")).map((button) =>
      button.getAttribute("aria-label"),
    );

  expect(groups()).toEqual(["Coffee", "Old coffee", "Tea"]);
  fireEvent.drop(within(table).getByRole("columnheader", { name: "Product" }), {
    dataTransfer: { getData: () => "transaction_type" },
  });
  expect(
    within(table)
      .getAllByRole("columnheader")
      .slice(1)
      .map((header) => header.textContent),
  ).toEqual(["Transaction type", "Product", "User", "Amount"]);
  expect(groups()).toEqual(["Coffee", "Old coffee", "Tea"]);
  await user.click(screen.getByRole("button", { name: "Table options" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Table options" }));
  expect(dialog.getByRole<HTMLInputElement>("radio", { name: "Transaction type" }).checked).toBe(
    true,
  );
  await user.click(dialog.getByRole("checkbox", { name: "User" }));
  await user.click(dialog.getByRole("button", { name: "OK" }));
  expect(groups()).toEqual(["Coffee", "Old coffee", "Tea"]);
  fireEvent.keyUp(screen.getByRole("searchbox", { name: "Search summary" }), { key: "End" });
  expect(groups()).toEqual(["consume", "purchase"]);
  await user.click(screen.getByRole("button", { name: "consume" }));
  expect(within(table).getAllByRole("rowheader")).toHaveLength(3);
  fireEvent.drop(within(table).getByRole("columnheader", { name: "Transaction type" }), {
    dataTransfer: { getData: () => "product_name" },
  });
  expect(groups()).toEqual(["consume", "purchase"]);
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  expect(groups()).toEqual(["Coffee", "Old coffee", "Tea"]);
  expect(within(table).getAllByRole("rowheader")).toHaveLength(4);
});

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
  const optionsTrigger = view.getByRole("button", { name: "Table options" });
  await user.click(optionsTrigger);
  const tableOptions = await screen.findByRole("dialog", { name: "Table options" });
  fireEvent(tableOptions, new Event("cancel", { cancelable: true, bubbles: true }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Table options" })).toBeNull());
  expect(screen.getByRole("dialog", { name: "Stock journal" })).toBe(dialog);
  expect(document.activeElement).toBe(optionsTrigger);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
  expect(name.value).toBe("Coffee draft");
  expect(router.state.location.href).toBe("/product/7");
  await user.click(trigger);
  const reopened = await screen.findByRole("dialog", { name: "Stock journal" });
  const fresh = within(reopened);
  await fresh.findByText("Restock");
  await user.type(fresh.getByRole("searchbox", { name: "Search journal" }), "text-strike-through");
  expect(fresh.getAllByRole("button", { name: /^Undo transaction/ })).toHaveLength(2);
  fireEvent(reopened, new Event("cancel", { cancelable: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(name.value).toBe("Coffee draft");
  expect(document.activeElement).toBe(trigger);
});

test.each(["/journal", "/stockjournal"])(
  "%s retains native date and product query rules",
  async (path) => {
    const { router } = mount(
      `${path}?product=7&months=9999${path === "/stockjournal" ? "&embedded=false" : ""}`,
    );

    const user = userEvent.setup();
    await screen.findByText("Old stock");
    expect(new URLSearchParams(router.history.location.search).get("product")).toBe("7");
    expect(new URLSearchParams(router.history.location.search).get("months")).toBe("9999");

    if (path === "/stockjournal")
      expect(screen.queryByRole("combobox", { name: "Product" })).toBeNull();
    else {
      await user.selectOptions(screen.getByRole("combobox", { name: "Product" }), "8");
      await screen.findByText("Tea stock");
      expect(new URLSearchParams(router.history.location.search).get("product")).toBe("8");
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

test.each(["/stockjournal?product=7", "/stockjournal/summary?product_id=7"])(
  "%s obeys the disabled stock feature",
  async (path) => {
    mount(path, false, false);
    await screen.findByRole("heading", { name: "Feature disabled" });
  },
);

test("journal summary retries, filters visible values, and sorts signed totals", async () => {
  mount("/stockjournal/summary", true);
  const user = userEvent.setup();
  await screen.findByText("Summary unavailable");
  await user.click(screen.getByRole("button", { name: "Retry summary" }));
  const table = await screen.findByRole("table", { name: "Stock journal summary" });
  const view = within(table);
  await view.findByText("1,000.01 Pieces");
  expect(view.getAllByRole("row")).toHaveLength(5);
  await user.selectOptions(screen.getByRole("combobox", { name: "Product" }), "7");
  expect(view.getAllByRole("row")).toHaveLength(3);
  await user.selectOptions(screen.getByRole("combobox", { name: "Transaction type" }), "purchase");
  await user.selectOptions(screen.getByRole("combobox", { name: "User" }), "1");
  expect(view.getAllByRole("row")).toHaveLength(2);
  await user.type(
    screen.getByRole("searchbox", { name: "Search summary" }),
    "Alice Coffee 1,000.01",
  );
  expect(view.getAllByRole("row")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await user.type(screen.getByRole("searchbox", { name: "Search summary" }), "“Old coffee” Alice");
  expect(view.getAllByRole("row")).toHaveLength(2);
  expect(view.getByRole("rowheader").textContent).toBe("Old coffee");
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await user.click(view.getByRole("button", { name: "Amount" }));
  expect(view.getAllByRole("row")[1]?.textContent).toBe("CoffeeconsumeBob-1 Piece");
  await user.click(view.getByRole("button", { name: "Amount" }));
  expect(view.getAllByRole("row")[1]?.textContent).toBe("TeapurchaseAlice4 Pieces");
  await user.type(screen.getByRole("searchbox", { name: "Search summary" }), "No such product");
  expect(view.getByText("No matching records found")).toBeTruthy();
});

test("journal matches native word filters, curly phrases, and amount text order", async () => {
  mount("/stockjournal?product=8&months=9999&embedded=");
  const user = userEvent.setup();
  await screen.findByText("Tea stock");
  await user.selectOptions(screen.getByRole("combobox", { name: "Location" }), "3");
  await user.selectOptions(screen.getByRole("combobox", { name: "Done by" }), "3");

  const bookings = () =>
    screen
      .getAllByRole("button", { name: /^Undo transaction/ })
      .map((button) => button.getAttribute("aria-label"));

  expect(bookings()).toEqual(["Undo transaction 107", "Undo transaction 108"]);
  await user.type(
    screen.getByRole("searchbox", { name: "Search journal" }),
    "“North Shelf” “Alex Lane”",
  );
  expect(bookings()).toEqual(["Undo transaction 107"]);
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await user.click(screen.getByRole("button", { name: "Amount" }));
  expect(bookings()).toEqual([
    "Undo transaction 108",
    "Undo transaction 107",
    "Undo transaction 106",
  ]);
});

test("journal searches native cell markup and relative date labels", async () => {
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-10-28T14:00:00").getTime());
  mount("/stockjournal");
  const user = userEvent.setup();
  await screen.findByText("Restock");
  const search = screen.getByRole("searchbox", { name: "Search journal" });
  await user.type(search, "font-italic");
  expect(
    screen
      .getAllByRole("button", { name: /^Undo transaction/ })
      .map((b) => b.getAttribute("aria-label")),
  ).toEqual(["Undo transaction 102"]);
  await user.clear(search);
  await user.type(search, "Today");
  expect(screen.getAllByRole("button", { name: /^Undo transaction/ })).toHaveLength(4);
  await user.clear(search);
  await user.type(search, "name-anchor");
  expect(screen.getAllByRole("button", { name: /^Undo transaction/ })).toHaveLength(7);
  await user.clear(search);
  await user.click(screen.getByRole("button", { name: "Undo transaction 103" }));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Undo transaction 103" }).disabled,
    ).toBe(true),
  );

  const changed = within(
    screen.getByRole("button", { name: "Undo transaction 103" }).closest("tr")!,
  );

  const linked = within(
    screen.getByRole("button", { name: "Undo transaction 104" }).closest("tr")!,
  );

  expect(changed.getByText("2026-10-28 14:00:00")).toBeTruthy();
  expect(changed.getByText("Today")).toBeTruthy();
  expect(linked.getByText("2026-10-28 14:00:00")).toBeTruthy();
  expect(linked.queryByText("Today")).toBeNull();
  await user.type(search, "text-strike-through");
  expect(screen.queryByRole("button", { name: /^Undo transaction/ })).toBeNull();
  await user.clear(search);
  await user.click(screen.getByRole("button", { name: "Table options" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Table options" }));
  await user.click(dialog.getByRole("radio", { name: "Product" }));
  await user.click(dialog.getByRole("button", { name: "OK" }));
  expect(screen.getByRole("button", { name: "Coffee" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Coffee Undone on/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  const undone = screen.getByRole("button", { name: /Coffee Undone on 2026-10-28 13:00:00 Today/ });
  await user.click(undone);
  expect(screen.queryByRole("button", { name: "Undo transaction 103" })).toBeNull();
  expect(screen.getByRole("button", { name: "Undo transaction 101" })).toBeTruthy();
});

test("journal retains cached search and groups through Undo until table Reset reloads data", async () => {
  mount("/stockjournal?product=7&embedded=");
  const user = userEvent.setup();
  await screen.findByText("Restock");
  await user.click(screen.getByRole("button", { name: "Table options" }));
  let dialog = within(await screen.findByRole("dialog", { name: "Table options" }));
  await user.click(dialog.getByRole("radio", { name: "Product" }));
  await user.click(dialog.getByRole("button", { name: "OK" }));
  await user.click(screen.getByRole("button", { name: "Undo transaction 103" }));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Undo transaction 101" }).disabled,
    ).toBe(false),
  );
  const search = screen.getByRole("searchbox", { name: "Search journal" });
  await user.type(search, "text-strike-through");
  expect(screen.queryByRole("button", { name: /^Undo transaction/ })).toBeNull();
  await user.clear(search);
  expect(screen.getByRole("button", { name: "Coffee" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Coffee Undone on/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Product" }));
  expect(screen.getByRole("button", { name: "Coffee" })).toBeTruthy();
  fireEvent.drop(screen.getByRole("columnheader", { name: "Product" }), {
    dataTransfer: { getData: () => "note" },
  });
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Undo transaction 103" }).disabled,
  ).toBe(false);
  expect(screen.getByRole("button", { name: "Coffee" })).toBeTruthy();
  const moved = within(screen.getByRole("button", { name: "Undo transaction 103" }).closest("tr")!);
  expect(moved.queryByText(/Undone on/)).toBeNull();
  fireEvent.keyUp(search, { key: "End" });
  expect(screen.queryByRole("button", { name: "Coffee" })).toBeNull();
  expect(screen.getByRole("button", { name: "Restock" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Table options" }));
  dialog = within(await screen.findByRole("dialog", { name: "Table options" }));
  await user.click(dialog.getByRole("button", { name: "Reset" }));
  await user.click(
    within(
      await screen.findByRole("dialog", {
        name: "Are you sure you want to reset the table options?",
      }),
    ).getByRole("button", { name: "Yes" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await screen.findByText("Restock");
  await user.type(screen.getByRole("searchbox", { name: "Search journal" }), "text-strike-through");
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: /^Undo transaction/ })).toHaveLength(2),
  );
});

test("a failed journal reload keeps the display and Retry replaces the cached values", async () => {
  mount("/stockjournal?product=7&embedded=", "reload");
  const user = userEvent.setup();
  await screen.findByText("Restock");
  await user.click(screen.getByRole("button", { name: "Undo transaction 103" }));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Undo transaction 101" }).disabled,
    ).toBe(false),
  );
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await screen.findByText("Journal unavailable");
  expect(screen.getByText("Restock")).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Undo transaction 103" }).disabled,
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: "Retry journal" }));
  await waitFor(() => expect(screen.queryByText("Journal unavailable")).toBeNull());
  await user.type(screen.getByRole("searchbox", { name: "Search journal" }), "text-strike-through");
  expect(screen.getAllByRole("button", { name: /^Undo transaction/ })).toHaveLength(2);
});

test("summary includes native number markup in smart search", async () => {
  mount("/stockjournal/summary");
  const user = userEvent.setup();
  await screen.findByText("1,000.01 Pieces");
  await user.type(
    screen.getByRole("searchbox", { name: "Search summary" }),
    "number-parsing-done Alice",
  );
  expect(screen.getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual([
    "Coffee",
    "Old coffee",
    "Tea",
  ]);
});

test("journal sorts hidden rows and retains their prior order until a reload", async () => {
  const { router } = mount("/stockjournal?product=8&months=9999&embedded=");
  const user = userEvent.setup();
  await screen.findByText("Tea stock");

  const bookings = () =>
    screen
      .getAllByRole("button", { name: /^Undo transaction/ })
      .map((button) => button.getAttribute("aria-label"));

  await user.selectOptions(screen.getByRole("combobox", { name: "Done by" }), "1");
  await user.click(screen.getByRole("button", { name: "Amount" }));
  await user.click(screen.getByRole("button", { name: "Product" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Done by" }), "");
  expect(bookings()).toEqual([
    "Undo transaction 108",
    "Undo transaction 107",
    "Undo transaction 106",
  ]);
  await user.click(screen.getByRole("button", { name: "Product" }));
  expect(bookings()).toEqual([
    "Undo transaction 108",
    "Undo transaction 107",
    "Undo transaction 106",
  ]);
  await router.navigate({
    to: "/stockjournal",
    search: { product: "8", months: "12", embedded: "" },
  });
  await screen.findByText("Tea stock");
  expect(bookings()).toEqual([
    "Undo transaction 106",
    "Undo transaction 107",
    "Undo transaction 108",
  ]);
});

test("summary keeps distinct user totals in their prior order and resets on URL reload", async () => {
  const { router } = mount("/stockjournal/summary");
  const user = userEvent.setup();
  await screen.findByText("1,000.01 Pieces");
  await user.click(screen.getByRole("button", { name: "Amount" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Product" }), "7");
  await user.click(screen.getByRole("button", { name: "Product" }));

  const totals = () =>
    screen.getAllByRole("rowheader").map((cell) => cell.closest("tr")?.textContent);

  expect(totals()).toEqual(["CoffeeconsumeBob-1 Piece", "CoffeepurchaseAlice1,000.01 Pieces"]);
  await user.selectOptions(screen.getByRole("combobox", { name: "Product" }), "");
  await user.click(screen.getByRole("button", { name: "Product" }));
  expect(totals()).toEqual([
    "TeapurchaseAlice4 Pieces",
    "Old coffeepurchaseAlice2 Pieces",
    "CoffeeconsumeBob-1 Piece",
    "CoffeepurchaseAlice1,000.01 Pieces",
  ]);
  await router.navigate({ to: "/stockjournal/summary", search: { product_id: "7" } });
  await screen.findByText("1,000.01 Pieces");
  expect(totals()).toEqual(["CoffeepurchaseAlice1,000.01 Pieces", "CoffeeconsumeBob-1 Piece"]);
});

test("summary waits for an imported sort before it records the first row order", async () => {
  let release = () => {};

  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });

  mount(
    "/stockjournal/summary",
    false,
    true,
    {
      "datatables_state_stock-journal-summary-table": nativeLayout(
        5,
        [0, 1, 2, 3, 4],
        [],
        [[3, "asc"]],
      ),
    },
    false,
    ready,
  );
  await screen.findByText("Loading table options…");
  await waitFor(() => expect(screen.queryByText("Loading journal summary…")).toBeNull());
  expect(screen.queryByRole("table", { name: "Stock journal summary" })).toBeNull();
  release();
  await screen.findByText("1,000.01 Pieces");
  expect(screen.getAllByRole("rowheader").map((cell) => cell.closest("tr")?.textContent)).toEqual([
    "CoffeepurchaseAlice1,000.01 Pieces",
    "TeapurchaseAlice4 Pieces",
    "Old coffeepurchaseAlice2 Pieces",
    "CoffeeconsumeBob-1 Piece",
  ]);
});

test("summary URL limits survive clearing local filters and the journal links to all totals", async () => {
  const { router } = mount(
    "/stockjournal/summary?product_id=9&user_id=1&transaction_type=purchase&embedded=false",
  );

  const user = userEvent.setup();
  await screen.findByRole("rowheader", { name: "Old coffee" });
  expect([...new URLSearchParams(router.history.location.search)]).toEqual([
    ["product_id", "9"],
    ["user_id", "1"],
    ["transaction_type", "purchase"],
    ["embedded", "false"],
  ]);
  expect(screen.queryByRole("combobox", { name: "Product" })).toBeNull();
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "User" }).value).toBe("");
  await user.selectOptions(screen.getByRole("combobox", { name: "Transaction type" }), "consume");
  await screen.findByText("No matching records found");
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await screen.findByRole("rowheader", { name: "Old coffee" });
  expect(router.state.location.search).toEqual({
    product_id: "9",
    user_id: "1",
    transaction_type: "purchase",
    embedded: "false",
  });
  await router.navigate({ to: "/stockjournal", search: { product: "7" } });
  await user.click(await screen.findByRole("link", { name: "Journal summary" }));
  await screen.findByRole("rowheader", { name: "Tea" });
  expect(router.state.location.href).toBe("/stockjournal/summary");
});
