import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import type { JournalRow } from "@/lib/stock-journal";
import type { UserSettings } from "@/lib/types";
import { supportProductOptions } from "./fixtures/product-options";
import { supportDescriptionEditors } from "./fixtures/editor";
import { productOverview } from "./fixtures/product-overview";
import { nativeProductContext } from "./fixtures/native-product";

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
  undoReply?: Promise<Response>,
  transferAllowed = false,
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
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => logger.mockRestore());
  const undoSignals: Array<AbortSignal | null | undefined> = [];
  const readPaths: string[] = [];
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), "http://test.invalid");
      const path = url.pathname;

      if (!init?.method || init.method === "GET") readPaths.push(path + url.search);

      if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (path === "/api/stock/products/7") return Response.json(productOverview);

      if (path === "/api/v2/content/products/7")
        return Response.json({ html: productOverview.product.description });

      if (path === "/api/stock/products/7/price-history") return Response.json([]);

      if (path === "/api/user") return Response.json([{ id: 1, username: "Test" }]);

      if (path === "/api/v2/user/permissions")
        return Response.json({ STOCK_TRANSFER: transferAllowed });

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

          return Response.json(
            { error_message: "Table reset failed" },
            { status: 500, statusText: "Internal Server Error" },
          );
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

      if (path === "/api/v2/products/native-editor") {
        const selected = products.find(
          (product) => product.id === Number(url.searchParams.get("row")),
        );

        if (!selected) return Response.json({ error_message: "Object not found" }, { status: 404 });

        return Response.json(
          nativeProductContext({
            product: { ...selected, userfields: null },
            references: {
              locations: [
                { id: 1, name: "Shelf" },
                { id: 2, name: "Cellar" },
              ],
              quantity_units: [{ id: 1, name: "Piece", name_plural: "Pieces" }],
              shopping_locations: [],
              product_groups: [],
              products,
            },
            user_settings: settings,
            config: { FEATURE_FLAG_STOCK: stock },
          }),
        );
      }

      if (path === "/api/objects/products") return Response.json(products);

      if (path === "/api/objects/locations")
        return Response.json([
          { id: 1, name: "Shelf" },
          { id: 2, name: "Cellar" },
        ]);

      if (path === "/api/objects/quantity_units")
        return Response.json([{ id: 1, name: "Piece", name_plural: "Pieces" }]);

      if (path === "/api/objects/userfields" || path === "/api/v2/custom-data/fields")
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

        const undone = /^\/api\/stock\/bookings\/(\d+)\/undo$/.exec(path);

        if (undone) {
          undoSignals.push(init.signal);

          if (undone[1] === "103" && fail === true && ++undos === 1)
            return Response.json({ error_message: "Undo failed" }, { status: 500 });

          const target = rows.find((row) => row.id === Number(undone[1]));

          for (const row of rows.filter(
            (row) =>
              row.id === target?.id ||
              (target?.correlation_id && row.correlation_id === target.correlation_id),
          )) {
            row.undone = 1;
            row.undone_timestamp = "2026-10-28 13:00:00";
          }

          if (undone[1] === "103" && undoReply) return undoReply;
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

  return { writes, router, tableWrites, settings, client, undoSignals, readPaths };
}

test("native Journal Transfer opens a product-only independent form without replacing its parent filters", async () => {
  mount("/stockjournal?embedded&product=7", false, true, {}, false, undefined, undefined, true);
  const search = await screen.findByRole<HTMLInputElement>("searchbox", { name: "Search journal" });
  await userEvent.type(search, "Restock");
  const link = screen.getByRole("link", { name: "Transfer transaction product 101" });
  expect(link.getAttribute("href")).toBe("/transfer?embedded&product=7");
  await userEvent.click(link);
  const dialog = await screen.findByRole("dialog", { name: "Transfer" });
  expect(dialog.classList.contains("form")).toBe(true);
  expect(within(dialog).getByTitle<HTMLIFrameElement>("Transfer").src).toBe(
    `${window.location.origin}/transfer?embedded&product=7`,
  );
  expect(within(dialog).queryByRole("form")).toBeNull();
  await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(search.isConnected).toBe(true);
  expect(search.value).toBe("Restock");
});

test("different journal rows remain available while overlapping Undo callbacks finish in reverse order", async () => {
  let release = (_response: Response) => {};

  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });

  const app = mount("/stockjournal?product=7", false, true, {}, false, undefined, pending);
  await screen.findByText("Restock");
  await userEvent.click(screen.getByRole("button", { name: "Undo transaction 103" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Undo transaction 101" }).disabled,
  ).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Undo transaction 101" }));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Undo transaction 101" }).disabled,
    ).toBe(true),
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Undo transaction 103" }).disabled,
  ).toBe(false);
  await act(async () => {
    release(new Response(null, { status: 204 }));
    await pending;
  });
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Undo transaction 103" }).disabled,
    ).toBe(true),
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Undo transaction 104" }).disabled,
  ).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Undo transaction 101" }).disabled,
  ).toBe(true);
  expect(app.writes).toEqual([
    "POST /api/stock/bookings/103/undo",
    "POST /api/stock/bookings/101/undo",
  ]);
  expect(app.readPaths.filter((path) => path.startsWith("/api/v2/stock/journal?"))).toHaveLength(1);
});

test("the selected product keeps its draft while its journal anchor opens and retires real native frames", async () => {
  const app = mount("/product/7");
  const user = userEvent.setup();
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  await user.type(name, " draft");
  const trigger = screen.getByRole("link", { name: "Stock journal" });
  expect(trigger.getAttribute("href")).toBe("/stockjournal?embedded&product=7");
  expect(trigger.getAttribute("data-dialog-type")).toBe("table");
  await user.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Stock journal" });
  const frame = within(dialog).getByTitle<HTMLIFrameElement>("Stock journal");
  expect(frame.getAttribute("src")).toBe(
    new URL("/stockjournal?embedded&product=7", window.location.href).href,
  );
  expect(app.readPaths.some((path) => path.startsWith("/api/v2/stock/journal?"))).toBe(false);
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog", { name: "Stock journal" })).toBeNull();
  expect(name.value).toBe("Coffee draft");
  expect(document.activeElement).toBe(trigger);
  expect(app.router.state.location.href).toBe("/product/7");
  await user.click(trigger);
  const reopened = await screen.findByRole("dialog", { name: "Stock journal" });
  expect(within(reopened).getByTitle("Stock journal")).not.toBe(frame);
  expect(name.value).toBe("Coffee draft");
});

test.each(["success", "failure"])(
  "an Undo %s completing after departure cannot notify or refresh its replacement",
  async (outcome) => {
    let release = (_response: Response) => {};

    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });

    const app = mount("/journal?product=7", false, true, {}, false, undefined, pending);
    await screen.findByText("Restock");
    await userEvent.click(screen.getByRole("button", { name: "Undo transaction 103" }));
    await waitFor(() => expect(app.writes).toEqual(["POST /api/stock/bookings/103/undo"]));
    await act(async () =>
      app.router.navigate({ to: "/journal", search: { product: "8", months: "9999" } }),
    );
    await screen.findByText("Tea stock");
    const key = ["stock", "replacement-proof"];
    app.client.setQueryData(key, ["replacement"]);
    expect(app.client.getQueryState(key)?.isInvalidated).toBe(false);
    const reads = app.readPaths.length;
    await act(async () => {
      release(
        outcome === "success"
          ? new Response(null, { status: 204 })
          : Response.json({ error_message: "Late Undo failure" }, { status: 503 }),
      );
      await pending;
    });
    expect(screen.queryByText("Booking successfully undone")).toBeNull();
    expect(screen.queryByText("Late Undo failure")).toBeNull();
    expect(screen.getByText("Tea stock")).toBeTruthy();
    expect(app.router.state.location.search).toEqual({ product: "8", months: "9999" });
    expect(app.client.getQueryData(key)).toEqual(["replacement"]);
    expect(app.client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(app.readPaths).toHaveLength(reads);
    expect(app.undoSignals[0]?.aborted).toBe(true);
  },
);

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

test("summary imports a native layout, keeps failed PUTs silent, and repeats native Reset after a deletion error", async () => {
  const key = "datatables_state_stock-journal-summary-table";
  const groupKey = "datatables_rowGroup_stock-journal-summary-table";

  const { router, tableWrites, settings, client } = mount(
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
  await waitFor(() =>
    expect(tableWrites.some((write) => write.method === "PUT" && write.key === key)).toBe(true),
  );
  await act(async () => {});
  expect(dialog.queryByText("Table save failed")).toBeNull();
  expect(dialog.queryByRole("button", { name: "Retry table options" })).toBeNull();
  expect(dialog.getByRole<HTMLInputElement>("checkbox", { name: "User" }).checked).toBe(false);
  expect(
    JSON.parse(String(client.getQueryData<UserSettings>(["user", "settings"])?.[key])).columns[3]
      .visible,
  ).toBe(false);
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
  await screen.findByText("Error while deleting, please retry");
  expect(
    within(screen.getByRole("table", { name: "Stock journal summary" }))
      .getAllByRole("columnheader")
      .slice(1)
      .map((header) => header.textContent),
  ).toEqual(["Product", "Transaction type", "Amount"]);
  expect(client.getQueryData<UserSettings>(["user", "settings"])?.[key]).toBeUndefined();
  expect(client.getQueryData<UserSettings>(["user", "settings"])?.[groupKey]).toBeUndefined();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry table options" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Table options" }));
  await user.click(
    within(await screen.findByRole("dialog", { name: "Table options" })).getByRole("button", {
      name: "Reset",
    }),
  );
  await user.click(
    within(
      await screen.findByRole("dialog", {
        name: "Are you sure you want to reset the table options?",
      }),
    ).getByRole("button", { name: "Yes" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const restored = await screen.findByRole("table", { name: "Stock journal summary" });
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
  ).toEqual([groupKey, key, groupKey, key]);
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

test("the embedded journal retries reads, retains native filters and linked Undo, and opens its own nested frame", async () => {
  const { writes, router } = mount("/stockjournal?product=7&embedded", true);
  const user = userEvent.setup();
  const messages = vi.spyOn(window, "postMessage");
  onTestFinished(() => messages.mockRestore());
  await screen.findByText("Journal unavailable");
  await user.click(screen.getByRole("button", { name: "Retry journal" }));
  await screen.findByText("Restock");
  expect(screen.queryByRole("combobox", { name: "Product" })).toBeNull();
  expect(screen.getByRole("columnheader", { name: "Batch" })).toBeTruthy();
  await user.type(screen.getByRole("searchbox", { name: "Search journal" }), '"Morning" Mint');
  await user.keyboard("{Enter}");
  expect(screen.getAllByRole("button", { name: /^Undo transaction/ })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await screen.findByText("Restock");
  await user.selectOptions(screen.getByRole("combobox", { name: "Transaction type" }), "consume");
  await user.selectOptions(screen.getByRole("combobox", { name: "Done by" }), "2");
  expect(screen.getAllByRole("button", { name: /^Undo transaction/ })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await screen.findByText("Restock");
  await user.selectOptions(screen.getByRole("combobox", { name: "Location" }), "2");
  expect(screen.getAllByRole("button", { name: /^Undo transaction/ })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await screen.findByText("Restock");
  await user.click(screen.getByRole("button", { name: "Amount" }));
  expect(
    screen.getAllByRole("button", { name: /^Undo transaction/ })[0]?.getAttribute("aria-label"),
  ).toBe("Undo transaction 102");
  await user.selectOptions(screen.getByRole("combobox", { name: "Date range" }), "9999");
  await screen.findByText("Old stock");
  await user.click(screen.getByRole("button", { name: "Undo transaction 103" }));
  await screen.findByText("Undo failed");
  await user.click(screen.getByRole("button", { name: "Undo transaction 103" }));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Undo transaction 103" }).disabled,
    ).toBe(true),
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Undo transaction 104" }).disabled,
  ).toBe(true);
  expect(writes).toEqual([
    "POST /api/stock/bookings/103/undo",
    "POST /api/stock/bookings/103/undo",
  ]);
  expect(messages).not.toHaveBeenCalledWith(
    expect.objectContaining({ Message: "BroadcastMessage" }),
    expect.anything(),
  );
  const optionsTrigger = screen.getByRole("button", { name: "Table options" });
  await user.click(optionsTrigger);
  fireEvent(
    await screen.findByRole("dialog", { name: "Table options" }),
    new Event("cancel", { cancelable: true, bubbles: true }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Table options" })).toBeNull());
  expect(document.activeElement).toBe(optionsTrigger);
  const overviewTrigger = screen.getAllByRole("button", { name: "Product overview: Coffee" })[0]!;
  await user.click(overviewTrigger);
  const overviewDialog = await screen.findByRole("dialog", { name: "Product overview" });
  const overview = within(overviewDialog);
  await overview.findByRole("heading", { name: "Coffee" });
  const journalTrigger = overview.getByRole("link", { name: "Stock journal" });
  expect(journalTrigger.getAttribute("href")).toBe("/stockjournal?embedded&product=7");
  await user.click(journalTrigger);
  const child = await screen.findByRole("dialog", { name: "Stock journal" });
  expect(within(child).getByTitle<HTMLIFrameElement>("Stock journal").getAttribute("src")).toBe(
    new URL("/stockjournal?embedded&product=7", window.location.href).href,
  );
  fireEvent(child, new Event("cancel", { cancelable: true, bubbles: true }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Stock journal" })).toBeNull());
  expect(document.activeElement).toBe(journalTrigger);
  fireEvent(overviewDialog, new Event("cancel", { cancelable: true, bubbles: true }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Product overview" })).toBeNull(),
  );
  expect(document.activeElement).toBe(overviewTrigger);
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Date range" }).value).toBe(
    "9999",
  );
  expect(router.state.location.search).toMatchObject({
    product: "7",
    months: "9999",
    embedded: "",
  });
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
  "native %s reads saved stock history with its module disabled",
  async (path) => {
    const app = mount(path, false, false);
    await screen.findByRole("region", {
      name: path.includes("summary") ? "Stock journal summary" : "Stock journal",
    });
    await screen.findByRole("table");
    expect(app.writes).toEqual([]);
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
  await user.click(await screen.findByRole("button", { name: "Amount" }));
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

  const undone = await screen.findByRole("button", {
    name: /Coffee Undone on 2026-10-28 13:00:00 Today/,
  });

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
      screen.getByRole<HTMLButtonElement>("button", { name: "Undo transaction 103" }).disabled,
    ).toBe(true),
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

test("a failed full journal reload discards old rows and Retry reads the saved values", async () => {
  mount("/stockjournal?product=7&embedded=", "reload");
  const user = userEvent.setup();
  await screen.findByText("Restock");
  await user.click(screen.getByRole("button", { name: "Undo transaction 103" }));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Undo transaction 103" }).disabled,
    ).toBe(true),
  );
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await screen.findByText("Journal unavailable");
  expect(screen.queryByText("Restock")).toBeNull();
  expect(screen.queryByRole("button", { name: "Undo transaction 103" })).toBeNull();
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
  await screen.findByRole("status");
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
