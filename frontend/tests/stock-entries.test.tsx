import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import type { EntryRow } from "@/lib/stock-entries";
import { supportProductOptions } from "./fixtures/product-options";
import { supportDescriptionEditors } from "./fixtures/editor";
import { supportDialogs } from "./fixtures/dialogs";
import { productOverview } from "./fixtures/product-overview";

beforeEach(supportDialogs);

function mount(
  path: string,
  {
    fail = false,
    stock = true,
    tracking = true,
    editRetry = false,
    printer = false,
    precision = 2,
    deferSavedRead = false,
    tableState = "",
    dateCases = false,
    firstAmount = 2.5,
    failRefresh = false,
  } = {},
) {
  const base: EntryRow = {
    id: 51,
    product_id: 7,
    product_name: "Coffee",
    stock_id: "mint",
    amount: firstAmount,
    best_before_date: "2999-12-31",
    purchased_date: "2026-10-20",
    row_created_timestamp: "2026-10-20 12:00:00",
    price: 1.25,
    open: 0,
    location_id: 1,
    shopping_location_id: 1,
    note: "Mint batch",
    qu_factor_price_to_stock: 6,
    qu_factor_purchase_to_stock: 1,
    qu_name: "Piece",
    qu_name_plural: "Pieces",
    price_qu_name: "Box",
    purchase_qu_name: "Piece",
    location_name: "Shelf",
    shopping_location_name: "Roastery",
    enable_tare_weight_handling: 0,
    disable_open: 0,
    due_type: 1,
    product_values: { origin: "Peru" },
    stock_values: { batch: "Mint" },
  };

  let rows: EntryRow[] = [
    base,
    {
      ...base,
      id: 52,
      stock_id: "opened",
      open: 1,
      amount: 1,
      note: "Open batch",
      location_id: 2,
      location_name: "Cellar",
    },
    {
      ...base,
      id: 53,
      stock_id: "tare",
      amount: 4,
      enable_tare_weight_handling: 1,
      note: "Tare batch",
    },
    { ...base, id: 54, stock_id: "disabled", disable_open: 1, note: "Disabled batch" },
    { ...base, id: 55, stock_id: "tea", product_id: 8, product_name: "Tea", note: "Tea batch" },
    {
      ...base,
      id: 56,
      stock_id: "north",
      product_id: 8,
      product_name: "Tea",
      note: "Zulu batch",
      location_id: 3,
      location_name: "North Shelf",
      amount: 10,
    },
    {
      ...base,
      id: 57,
      stock_id: "south",
      product_id: 8,
      product_name: "Tea",
      note: "Alpha batch",
      location_id: 4,
      location_name: "Shelf North",
      amount: 2,
    },
  ];

  if (dateCases)
    rows = rows.map((row) => ({
      ...row,
      best_before_date:
        row.id === 52 ? "2888-12-31" : row.id === 53 ? "2026-10-28" : row.best_before_date,
      purchased_date: row.id === 53 ? "2026-10-29" : row.purchased_date,
    }));

  const writes: { path: string; body: object }[] = [];
  let reads = 0;
  let actions = 0;
  let undoReads = 0;
  let before: EntryRow[] = [];
  let editorReads = 0;
  let editorWrites = 0;
  let productReads = 0;
  const overview = { ...productOverview };
  let uploads = 0;
  let heldRead = false;
  let releaseSavedRead = () => {};
  const labels: string[] = [];

  const editorFields = [
    {
      id: 2,
      name: "batch",
      caption: "Batch",
      type: "text-single-line",
      input_required: 0,
      default_value: null,
      config: null,
    },
    {
      id: 3,
      name: "receipt",
      caption: "Receipt",
      type: "file",
      input_required: 0,
      default_value: null,
      config: null,
    },
  ];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname;

      if (path.endsWith("/api/system/config"))
        return Response.json({
          FEATURE_FLAG_STOCK: stock,
          FEATURE_FLAG_SHOPPINGLIST: tracking,
          FEATURE_FLAG_STOCK_LOCATION_TRACKING: tracking,
          FEATURE_FLAG_STOCK_PRICE_TRACKING: tracking,
          FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: tracking,
          FEATURE_FLAG_STOCK_PRODUCT_OPENED_TRACKING: tracking,
          FEATURE_FLAG_LABEL_PRINTER: printer,
          LABEL_PRINTER_RUN_SERVER: true,
          CURRENCY: "USD",
        });

      if (path.endsWith("/api/user/settings"))
        return Response.json({
          stock_decimal_places_amounts: precision,
          stock_decimal_places_prices_input: precision,
          stock_decimal_places_prices_display: 2,
          "datatables_state_stockentries-table": tableState,
        });

      if (path.includes("/shopping-lists/")) return Response.json({ items: [] });

      if (path.endsWith("/api/v2/stock/entries/51/editor")) {
        if (editRetry && ++editorReads === 1)
          return Response.json({ detail: "Editor unavailable" }, { status: 503 });
        const row = rows.find((row) => row.id === 51);

        const response = Response.json({
          entry: row,
          locations: [{ id: 2, name: "Cellar" }],
          stores: [{ id: 1, name: "Roastery" }],
          fields: editorFields,
          values: {
            batch: row?.stock_values.batch ?? null,
            receipt: row?.stock_values.receipt ?? null,
          },
        });

        if (deferSavedRead && editorWrites > 0 && !heldRead) {
          heldRead = true;

          return new Promise<Response>((resolve) => {
            releaseSavedRead = () => resolve(response);
          });
        }

        return response;
      }

      if (path.endsWith("/api/stock/entry/mint/printlabel")) {
        labels.push(path);

        return Response.json({ error_message: "Printer unavailable" }, { status: 500 });
      }

      if (init?.method === "PUT" && path.includes("/api/files/userfiles/")) {
        writes.push({ path, body: { upload: true } });

        if (editRetry && ++uploads === 1)
          return Response.json({ error_message: "Upload unavailable" }, { status: 500 });

        return new Response(null, { status: 204 });
      }

      if (init?.method === "PUT" && path.endsWith("/api/stock/entry/51")) {
        const body = JSON.parse(String(init.body));
        writes.push({ path, body });

        editorWrites += 1;

        if (editRetry && editorWrites === 1)
          return Response.json({ error_message: "Entry save unavailable" }, { status: 500 });
        before = rows.map((row) => ({ ...row }));
        rows = rows.map((row) =>
          row.id === 51
            ? {
                ...row,
                ...body,
                amount: Number(body.amount),
                price: body.price === "" ? null : Number(body.price),
                location_id: Number(body.location_id),
                shopping_location_id: body.shopping_location_id
                  ? Number(body.shopping_location_id)
                  : null,
                open: Number(body.open),
              }
            : row,
        );

        return Response.json([
          { id: 900, product_id: 7, stock_id: "mint", transaction_id: "edit-1" },
          { id: 901, product_id: 7, stock_id: "mint", transaction_id: "edit-1" },
        ]);
      }

      if (init?.method === "PUT" && path.endsWith("/api/userfields/stock/edit-1")) {
        const body = JSON.parse(String(init.body));
        writes.push({ path, body });
        rows = rows.map((row) =>
          row.stock_id === "mint"
            ? { ...row, stock_values: { ...row.stock_values, ...body } }
            : row,
        );

        return new Response(null, { status: 204 });
      }

      if (path.endsWith("/api/v2/stock/entries")) {
        if (fail && ++reads === 1)
          return Response.json({ detail: "Entries unavailable" }, { status: 503 });

        return Response.json({
          rows: rows.map((row) => ({
            ...row,
            location_name: ["", "Shelf", "Cellar", "North Shelf", "Shelf North"][row.location_id],
          })),
          products: [
            { id: 7, name: "Coffee" },
            { id: 8, name: "Tea" },
          ],
          locations: [
            { id: 2, name: "Cellar" },
            { id: 1, name: "Shelf" },
            { id: 3, name: "North Shelf" },
            { id: 4, name: "Shelf North" },
          ],
          stores: [{ id: 1, name: "Roastery" }],
        });
      }

      if (!init?.method && /\/api\/stock\/entry\/\d+$/.test(path))
        return Response.json(rows.find((row) => row.id === Number(path.split("/").at(-1))) ?? null);

      if (/\/api\/objects\/locations\/\d+$/.test(path)) {
        const id = Number(path.split("/").at(-1));
        const names = ["", "Shelf", "Cellar", "North Shelf", "Shelf North"];

        return Response.json({ id, name: names[id] });
      }

      if (path.endsWith("/api/objects/shopping_locations/1"))
        return Response.json({ id: 1, name: "Roastery" });

      if (/\/api\/stock\/products\/\d+$/.test(path)) {
        if (failRefresh && ++productReads === 1)
          return Response.json({ error_message: "Entry refresh unavailable" }, { status: 503 });

        return Response.json(overview);
      }

      if (path.endsWith("/api/v2/content/products/7"))
        return Response.json({ html: productOverview.product.description });

      if (path.endsWith("/api/stock/products/7/price-history")) return Response.json([]);

      if (path.endsWith("/api/objects/userfields"))
        return Response.json([
          {
            id: 1,
            entity: "products",
            name: "origin",
            caption: "Origin",
            type: "text-single-line",
            input_required: 0,
            default_value: null,
            config: null,
            show_as_column_in_tables: 1,
          },
          {
            id: 2,
            entity: "stock",
            name: "batch",
            caption: "Batch",
            type: "text-single-line",
            input_required: 0,
            default_value: null,
            config: null,
            show_as_column_in_tables: 1,
          },
        ]);

      if (path.endsWith("/api/objects/products"))
        return Response.json([
          {
            id: 7,
            name: "Coffee",
            location_id: 1,
            qu_id_stock: 1,
            qu_id_purchase: 1,
            qu_id_consume: 1,
            qu_id_price: 1,
            active: 1,
          },
        ]);

      if (path.endsWith("/api/objects/products/7")) {
        if (init?.method === "PUT") writes.push({ path, body: JSON.parse(String(init.body)) });

        return Response.json({
          id: 7,
          name: "Coffee",
          location_id: 1,
          qu_id_stock: 1,
          qu_id_purchase: 1,
          qu_id_consume: 1,
          qu_id_price: 1,
          active: 1,
        });
      }

      if (path.endsWith("/api/userfields/products/7")) return Response.json({ origin: "Peru" });

      if (path.endsWith("/api/user"))
        return Response.json({ id: 1, username: "tester", display_name: "Tester" });

      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}"));
        writes.push({ path, body });

        if (path.endsWith("/api/stock/bookings/900/undo")) {
          if (fail && ++undoReads === 1)
            return Response.json({ error_message: "Undo failed" }, { status: 500 });
          const currentIds = new Set(rows.map((row) => row.id));
          rows = before.map((row) => ({
            ...row,
            id: currentIds.has(row.id) ? row.id : row.id + 100,
          }));

          return new Response(null, { status: 204 });
        }

        if (path.match(/\/api\/stock\/products\/7\/(open|consume)$/)) {
          if (fail && ++actions === 1)
            return Response.json({ error_message: "Booking failed" }, { status: 500 });

          if (
            path.endsWith("/consume") &&
            rows.some(
              (row) =>
                row.stock_id === body.stock_entry_id &&
                row.location_id !== Number(body.location_id),
            )
          )
            return Response.json(
              { error_message: "No transaction was found by the given transaction id" },
              { status: 400 },
            );
          before = rows.map((row) => ({ ...row }));
          rows = path.endsWith("/open")
            ? rows.map((row) => (row.stock_id === body.stock_entry_id ? { ...row, open: 1 } : row))
            : rows.flatMap((row) => {
                if (row.stock_id !== body.stock_entry_id) return [row];
                const amount = row.amount - Number(body.amount);

                return amount > 0 ? [{ ...row, amount }] : [];
              });

          return Response.json([
            {
              id: 900,
              product_id: 7,
              amount: body.amount,
              transaction_type: "consume",
              transaction_id: "transaction",
            },
          ]);
        }
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

  return { writes, router, labels, overview, releaseSavedRead: () => releaseSavedRead() };
}

test("product overview retries and retains the entry filter and product draft through child dialogs", async () => {
  const { router, overview, writes } = mount("/product/7", { failRefresh: true });
  const user = userEvent.setup();
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  await user.type(name, " draft");
  await user.click(screen.getByRole("button", { name: "Stock entries" }));
  const entries = within(await screen.findByRole("dialog", { name: "Stock entries" }));
  await entries.findByText("Mint batch");
  await user.selectOptions(entries.getByRole("combobox", { name: "Location" }), "2");
  const trigger = entries.getByRole("button", { name: "Product overview: Coffee" });
  await user.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Product overview" });
  const view = within(dialog);
  await view.findByText("Entry refresh unavailable");
  await user.click(view.getByRole("button", { name: "Retry" }));
  await view.findByRole("heading", { name: "Coffee" });
  expect(document.activeElement).toBe(view.getByRole("button", { name: "Close" }));
  expect(view.getByText("2.5 Pieces")).toBeTruthy();
  expect(view.getByText("12.5 Pieces")).toBeTruthy();
  expect(view.getByText("$6.00 per Box").title).toBe("$1.00 per Piece");
  expect(view.getByText("$1.50 per Box").title).toBe("$0.25 per Piece");
  expect(view.getByText("25%")).toBeTruthy();
  expect(view.getByText("Never")).toBeTruthy();
  await user.click(view.getByRole("button", { name: "Show more" }));
  expect(view.getByText("carefully").tagName).toBe("STRONG");
  const stock = view.getByRole("button", { name: "Stock entries" });
  await user.click(stock);
  await waitFor(() =>
    expect(screen.getAllByRole("dialog", { name: "Stock entries" })).toHaveLength(2),
  );
  const child = screen.getAllByRole("dialog", { name: "Stock entries" })[1]!;
  fireEvent(child, new Event("cancel", { bubbles: true, cancelable: true }));
  await waitFor(() =>
    expect(screen.getAllByRole("dialog", { name: "Stock entries" })).toHaveLength(1),
  );
  expect(document.activeElement).toBe(stock);
  fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Product overview" })).toBeNull(),
  );
  expect(document.activeElement).toBe(trigger);
  expect(entries.getByRole<HTMLSelectElement>("combobox", { name: "Location" }).value).toBe("2");
  overview.stock_amount = 9;
  await user.click(trigger);
  const fresh = within(await screen.findByRole("dialog", { name: "Product overview" }));
  await fresh.findByText("9 Pieces");
  await fresh.findByRole("button", { name: "Show less" });
  await user.click(fresh.getByRole("button", { name: "Edit product" }));
  const editor = within(await screen.findByRole("dialog", { name: "Edit product" }));
  const savedName = await editor.findByLabelText<HTMLInputElement>("Name");
  expect(savedName.value).toBe("Coffee");
  await user.type(savedName, " temporary");
  await user.click(editor.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit product" })).toBeNull());
  expect(screen.queryByRole("dialog", { name: "Product overview" })).toBeNull();
  await entries.findByText("Mint batch");
  expect(entries.getByRole<HTMLSelectElement>("combobox", { name: "Location" }).value).toBe("");
  await waitFor(() =>
    expect(document.activeElement).toBe(entries.getByRole("region", { name: "Stock entries" })),
  );
  expect(writes.filter((write) => write.path === "/api/objects/products/7")).toHaveLength(0);
  expect(name.value).toBe("Coffee draft");
  expect(router.state.location.href).toBe("/product/7");
});

test("entry dialog retains the product draft through retry, exact actions, and undo", async () => {
  const { writes, router } = mount("/product/7", { fail: true });
  const user = userEvent.setup();
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  await user.type(name, " draft");
  const trigger = screen.getByRole("button", { name: "Stock entries" });
  await user.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Stock entries" });
  const view = within(dialog);
  await view.findByText("Entries unavailable");
  await user.click(view.getByRole("button", { name: "Retry stock entries" }));
  await view.findByText("Mint batch");
  expect(view.queryByRole("combobox", { name: "Product" })).toBeNull();
  expect(view.getByRole("columnheader", { name: "Origin" })).toBeTruthy();
  expect(view.getByRole("columnheader", { name: "Batch" })).toBeTruthy();
  expect(view.getAllByText("$7.50 per Box")).toHaveLength(4);

  for (const id of [52, 53, 54])
    expect(
      view.getByRole<HTMLButtonElement>("button", { name: `Open stock entry ${id}` }).disabled,
    ).toBe(true);
  await user.selectOptions(view.getByRole("combobox", { name: "Location" }), "2");
  expect(view.getAllByRole("button", { name: /^Consume stock entry \d+$/ })).toHaveLength(1);
  await user.click(view.getByRole("button", { name: "Clear filter" }));
  await user.click(view.getByRole("button", { name: "Amount" }));
  expect(
    view
      .getAllByRole("button", { name: /^Consume stock entry \d+$/ })[0]
      ?.getAttribute("aria-label"),
  ).toBe("Consume stock entry 52");
  await user.click(view.getByRole("button", { name: "Open stock entry 51" }));
  await view.findByText("Booking failed");
  await user.click(view.getByRole("button", { name: "Open stock entry 51" }));
  await waitFor(() =>
    expect(
      view.getByRole<HTMLButtonElement>("button", { name: "Open stock entry 51" }).disabled,
    ).toBe(true),
  );
  expect(view.getAllByText("$1.25 per Piece")).toHaveLength(4);
  await user.click(view.getByRole("button", { name: "Undo" }));
  await view.findByText("Undo failed");
  await user.click(view.getByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(
      view.getByRole<HTMLButtonElement>("button", { name: "Open stock entry 51" }).disabled,
    ).toBe(false),
  );
  await user.click(view.getByRole("button", { name: "Consume stock entry 51 as spoiled" }));
  await waitFor(() =>
    expect(view.queryByRole("button", { name: "Consume stock entry 51" })).toBeNull(),
  );
  fireEvent.drop(view.getByRole("columnheader", { name: "Product" }), {
    dataTransfer: { getData: () => "note" },
  });
  expect(view.queryByRole("button", { name: "Consume stock entry 51" })).toBeNull();
  await user.click(view.getByRole("button", { name: "Undo" }));
  await view.findByRole("button", { name: "Consume stock entry 151" });
  await waitFor(() =>
    expect(document.activeElement).toBe(view.getByRole("region", { name: "Stock entries" })),
  );
  await user.click(view.getByRole("button", { name: "Consume stock entry 151" }));
  await waitFor(() =>
    expect(view.queryByRole("button", { name: "Consume stock entry 151" })).toBeNull(),
  );
  expect(writes.filter((w) => w.path.endsWith("/open")).map((w) => w.body)).toEqual([
    { amount: 2.5, stock_entry_id: "mint" },
    { amount: 2.5, stock_entry_id: "mint" },
  ]);
  expect(writes.filter((w) => w.path.endsWith("/consume")).map((w) => w.body)).toEqual([
    { amount: 2.5, spoiled: true, location_id: "1", stock_entry_id: "mint", exact_amount: true },
    { amount: 2.5, spoiled: false, location_id: "1", stock_entry_id: "mint", exact_amount: true },
  ]);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
  expect(name.value).toBe("Coffee draft");
  expect(router.state.location.href).toBe("/product/7");
});

test.each([false, true])(
  "stock entry page clears product only outside embedded mode (%s)",
  async (embedded) => {
    const { router } = mount(`/stockentries?product=7${embedded ? "&embedded=false" : ""}`);
    const user = userEvent.setup();
    await screen.findByText("Mint batch");
    expect(new URLSearchParams(router.history.location.search).get("product")).toBe("7");

    if (embedded)
      expect(new URLSearchParams(router.history.location.search).get("embedded")).toBe("false");
    await user.selectOptions(screen.getByRole("combobox", { name: "Location" }), "2");
    await user.click(screen.getByRole("button", { name: "Clear filter" }));
    await screen.findByText("Mint batch");

    if (embedded) expect(screen.queryByText("Tea batch")).toBeNull();
    else await screen.findByText("Tea batch");
    expect(router.state.location.search.product).toBe(embedded ? "7" : undefined);

    if (!embedded) {
      await user.selectOptions(screen.getByRole("combobox", { name: "Product" }), "8");
      await screen.findByText("Tea batch");
      expect(new URLSearchParams(router.history.location.search).get("product")).toBe("8");
    }
  },
);

test("stock entry reads remain available with tracking disabled", async () => {
  const { overview } = mount("/stockentries?product=7", { tracking: false });
  overview.product = { ...overview.product, no_own_stock: 1 };
  const user = userEvent.setup();
  await screen.findByText("Mint batch");
  expect(screen.getAllByRole("button", { name: /^Consume stock entry \d+$/ })).toHaveLength(4);
  expect(screen.queryByRole("button", { name: /^Open stock entry/ })).toBeNull();
  expect(screen.queryByRole("columnheader", { name: "Price" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Location" })).toBeNull();
  await user.click(screen.getAllByRole("button", { name: "Product overview: Coffee" })[0]!);
  const view = within(await screen.findByRole("dialog", { name: "Product overview" }));
  await view.findByRole("heading", { name: "Coffee" });
  expect(view.queryByText("2.5 Pieces")).toBeNull();
  expect(view.getByText("12.5 Pieces")).toBeTruthy();
  expect(view.queryByText("Stock value")).toBeNull();
  expect(view.queryByText("Default location")).toBeNull();
  expect(view.queryByText("Last price")).toBeNull();
  expect(view.queryByText("Average price")).toBeNull();
  expect(view.queryByText("Average shelf life")).toBeNull();
  expect(view.queryByRole("region", { name: "Price history" })).toBeNull();
  expect(view.queryByRole("button", { name: "Add to shopping list" })).toBeNull();
});

test("entry location filters match words in either order and retain native amount and note order", async () => {
  mount("/stockentries?product=8&embedded=");
  const user = userEvent.setup();
  await screen.findByText("Tea batch");
  await user.selectOptions(screen.getByRole("combobox", { name: "Location" }), "3");

  const entries = () =>
    screen
      .getAllByRole("button", { name: /^Consume stock entry \d+$/ })
      .map((button) => button.getAttribute("aria-label"));

  expect(entries()).toEqual(["Consume stock entry 56", "Consume stock entry 57"]);
  await user.click(screen.getByRole("button", { name: "Amount" }));
  expect(entries()).toEqual(["Consume stock entry 57", "Consume stock entry 56"]);
  await user.click(screen.getByRole("button", { name: "Note" }));
  expect(entries()).toEqual(["Consume stock entry 56", "Consume stock entry 57"]);
});

test.each([14, 13])(
  "entry layout retains hidden indexes and resets changed column counts (%s)",
  async (count) => {
    const search = { search: "", smart: true, regex: false, caseInsensitive: true };

    const tableState = JSON.stringify({
      time: 1793231338715,
      order: [[2, "asc"]],
      search,
      columns: Array.from({ length: count }, (_, i) => ({ visible: i !== 12, search })),
      ColReorder: [0, 10, 2, 1, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13].filter((i) => i < count),
    });

    mount("/stockentries?product=7&embedded=", { tracking: false, tableState });
    const table = await screen.findByRole("table", { name: "Stock entries" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .slice(1)
        .map((header) => header.textContent),
    ).toEqual(
      count === 14
        ? ["Timestamp", "Product", "Amount", "Purchased date", "Note", "Batch"]
        : ["Product", "Amount", "Purchased date", "Note", "Origin", "Batch"],
    );

    if (count === 14) expect(within(table).getAllByText("2026-10-20 12:00:00")).toHaveLength(4);
  },
);

test.each(["/stockentries", "/stockentry/51"])("%s obeys the stock feature flag", async (path) => {
  mount(path, { stock: false });
  await screen.findByRole("heading", { name: "Feature disabled" });
});

test("entry editing keeps the parent draft and retries an upload on the saved transaction", async () => {
  const { writes, router, labels } = mount("/product/7", { editRetry: true, printer: true });
  const user = userEvent.setup();
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  await user.type(name, " draft");
  await user.click(screen.getByRole("button", { name: "Stock entries" }));
  const entries = within(await screen.findByRole("dialog", { name: "Stock entries" }));
  await user.click(await entries.findByRole("button", { name: "Edit stock entry 51" }));
  const edit = await screen.findByRole("dialog", { name: "Edit stock entry" });
  const fields = within(edit);
  await fields.findByText("Editor unavailable");
  await user.click(fields.getByRole("button", { name: "Retry stock entry" }));
  const amount = await fields.findByRole<HTMLInputElement>("spinbutton", { name: /^Amount/ });
  expect(fields.getByRole<HTMLSelectElement>("combobox", { name: "Location" }).value).toBe("");
  await user.click(fields.getByRole("button", { name: "OK" }));
  expect(writes).toHaveLength(0);
  await user.selectOptions(fields.getByRole("combobox", { name: "Location" }), "2");
  await user.clear(amount);
  await user.type(amount, "0");
  await user.click(fields.getByRole("button", { name: "OK" }));
  expect(amount.validity.rangeUnderflow).toBe(true);
  expect(writes).toHaveLength(0);
  await user.clear(amount);
  await user.type(amount, "3.5");
  await user.click(fields.getByRole("checkbox", { name: "Never overdue" }));
  expect(fields.getByLabelText<HTMLInputElement>("Due date").readOnly).toBe(true);
  expect(
    fields.getByRole<HTMLInputElement>("checkbox", { name: "Reprint stock entry label" }).checked,
  ).toBe(true);
  await user.clear(fields.getByRole("spinbutton", { name: "Price" }));
  await user.clear(fields.getByRole("textbox", { name: "Note" }));
  await user.type(fields.getByRole("textbox", { name: "Note" }), "Edited batch");
  await user.clear(fields.getByLabelText("Batch"));
  await user.type(fields.getByLabelText("Batch"), "Lime");
  await user.upload(
    fields.getByLabelText("Receipt"),
    new File(["Receipt"], "Receipt.txt", { type: "text/plain" }),
  );
  await user.click(fields.getByRole("button", { name: "OK" }));
  await fields.findByText("Entry save unavailable");
  expect(amount.value).toBe("3.5");
  await user.click(fields.getByRole("button", { name: "OK" }));
  await fields.findByText("Upload unavailable");
  expect(amount.disabled || amount.closest("fieldset")?.disabled).toBe(true);
  expect(writes.filter((w) => w.path === "/api/stock/entry/51")).toHaveLength(2);
  expect(labels).toHaveLength(1);
  await user.click(fields.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Edit stock entry" })).toBeNull(),
  );
  await entries.findByText("Edited batch");
  expect(writes.filter((w) => w.path === "/api/stock/entry/51").map((w) => w.body)).toEqual(
    Array(2).fill({
      amount: "3.5",
      best_before_date: "2999-12-31",
      purchased_date: "2026-10-20",
      price: "",
      location_id: "2",
      shopping_location_id: "1",
      note: "Edited batch",
      open: false,
    }),
  );
  expect(
    writes
      .filter((w) => w.path === "/api/userfields/stock/edit-1" && "batch" in w.body)
      .map((w) => w.body),
  ).toEqual([{ batch: "Lime" }]);
  expect(writes.filter((w) => w.path.includes("/api/files/userfiles/"))).toHaveLength(2);
  expect(labels).toHaveLength(1);
  expect(name.value).toBe("Coffee draft");
  expect(router.state.location.href).toBe("/product/7");
  await user.click(entries.getByRole("button", { name: "Edit stock entry 51" }));
  const reopened = await screen.findByRole("dialog", { name: "Edit stock entry" });
  await within(reopened).findByRole("spinbutton", { name: /^Amount/ });
  fireEvent(reopened, new Event("cancel", { bubbles: true, cancelable: true }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Edit stock entry" })).toBeNull(),
  );
  expect(screen.getByRole("dialog", { name: "Stock entries" })).toBeTruthy();
  expect(document.activeElement).toBe(entries.getByRole("button", { name: "Edit stock entry 51" }));
  await user.click(entries.getByRole("button", { name: "Close" }));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Stock entries" }));
});

test("the legacy entry editor applies disabled tracking values and reloads saved data", async () => {
  const { writes, releaseSavedRead } = mount("/stockentry/51", {
    tracking: false,
    precision: 0,
    deferSavedRead: true,
  });

  const user = userEvent.setup();
  const amount = await screen.findByRole<HTMLInputElement>("spinbutton", { name: /^Amount/ });
  expect(amount.value).toBe("3");
  expect(amount.min).toBe("1");
  expect(amount.step).toBe("1");
  const purchased = screen.getByLabelText<HTMLInputElement>("Purchased date");
  await user.clear(purchased);
  await user.click(screen.getByRole("button", { name: "OK" }));
  expect(purchased.validity.valueMissing).toBe(true);
  expect(writes).toHaveLength(0);
  fireEvent.change(purchased, { target: { value: "2026-10-22" } });
  await user.clear(screen.getByRole("textbox", { name: "Note" }));
  await user.type(screen.getByRole("textbox", { name: "Note" }), "Direct edit");
  await user.click(screen.getByRole("button", { name: "OK" }));
  await user.click(await screen.findByRole("button", { name: "Undo" }));
  await act(async () => releaseSavedRead());
  await screen.findByDisplayValue("Mint batch");
  expect(screen.getByLabelText<HTMLInputElement>("Purchased date").value).toBe("2026-10-20");
  expect(writes.filter((w) => w.path === "/api/stock/entry/51").map((w) => w.body)).toEqual([
    {
      amount: "3",
      best_before_date: "2999-12-31",
      purchased_date: "2026-10-22",
      price: "0",
      location_id: 1,
      note: "Direct edit",
      open: false,
    },
  ]);
});

test("entry edits retain cached groups, filters, units, sorting, and action amounts until Reset", async () => {
  const { writes } = mount("/stockentries?product=7", { firstAmount: 1 });
  const user = userEvent.setup();
  await screen.findByText("Mint batch");
  await user.selectOptions(screen.getByRole("combobox", { name: "Location" }), "1");
  await user.click(screen.getByRole("button", { name: "Table options" }));
  let options = within(await screen.findByRole("dialog", { name: "Table options" }));
  await user.click(options.getByRole("radio", { name: "Location" }));
  await user.click(options.getByRole("button", { name: "OK" }));
  await user.click(screen.getByRole("button", { name: "Edit stock entry 51" }));
  const edit = within(await screen.findByRole("dialog", { name: "Edit stock entry" }));
  const amount = await edit.findByRole("spinbutton", { name: /^Amount/ });
  await user.clear(amount);
  await user.type(amount, "10");
  await user.selectOptions(edit.getByRole("combobox", { name: "Location" }), "2");
  await user.clear(edit.getByRole("textbox", { name: "Note" }));
  await user.type(edit.getByRole("textbox", { name: "Note" }), "Edited cache");
  await user.clear(edit.getByLabelText("Batch"));
  await user.type(edit.getByLabelText("Batch"), "Lime");
  await user.click(edit.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  const changed = () =>
    within(screen.getByRole("button", { name: "Edit stock entry 51" }).closest("tr")!);

  expect(changed().getByText("Edited cache")).toBeTruthy();
  expect(changed().getByText("10 Piece")).toBeTruthy();
  expect(changed().getByText("Cellar")).toBeTruthy();
  expect(changed().getByText("Mint")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Shelf" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Cellar" })).toBeNull();
  fireEvent.drop(screen.getByRole("columnheader", { name: "Product" }), {
    dataTransfer: { getData: () => "note" },
  });
  expect(changed().getByText("1 Piece")).toBeTruthy();
  expect(changed().getByText("Mint batch")).toBeTruthy();
  expect(changed().getByText("Shelf")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Shelf" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Product" }), "7");
  await user.click(screen.getByRole("button", { name: "Table options" }));
  options = within(await screen.findByRole("dialog", { name: "Table options" }));
  await user.click(options.getByRole("radio", { name: "None" }));
  await user.click(options.getByRole("button", { name: "OK" }));
  await user.click(screen.getByRole("button", { name: "Amount" }));
  expect(
    screen
      .getAllByRole("button", { name: /^Edit stock entry/ })
      .map((button) => button.getAttribute("aria-label")),
  ).toEqual([52, 51, 54, 53].map((id) => `Edit stock entry ${id}`));
  await user.click(screen.getByRole("button", { name: "Consume stock entry 51" }));
  await screen.findByText("No transaction was found by the given transaction id");
  expect(changed().getByText("1 Piece")).toBeTruthy();
  expect(writes.find((write) => write.path.endsWith("/consume"))?.body).toEqual({
    amount: 1,
    spoiled: false,
    location_id: "1",
    stock_entry_id: "mint",
    exact_amount: true,
  });
  await user.click(screen.getByRole("button", { name: "Table options" }));
  options = within(await screen.findByRole("dialog", { name: "Table options" }));
  await user.click(options.getByRole("button", { name: "Reset" }));
  await user.click(
    within(
      await screen.findByRole("dialog", {
        name: "Are you sure you want to reset the table options?",
      }),
    ).getByRole("button", { name: "Yes" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(changed().getByText("10 Pieces")).toBeTruthy());
  expect(screen.queryByText("No transaction was found by the given transaction id")).toBeNull();
  expect(changed().getByText("Lime")).toBeTruthy();
  await user.selectOptions(screen.getByRole("combobox", { name: "Location" }), "1");
  expect(screen.queryByRole("button", { name: "Edit stock entry 51" })).toBeNull();
});

test("entry refresh Retry keeps the completed booking and partial display update", async () => {
  const { writes } = mount("/stockentries?product=7", { failRefresh: true });
  const user = userEvent.setup();
  await screen.findByText("Mint batch");
  await user.click(screen.getByRole("button", { name: "Open stock entry 51" }));
  await screen.findByText("Entry refresh unavailable");
  const row = within(screen.getByRole("button", { name: "Edit stock entry 51" }).closest("tr")!);
  expect(row.getByText("Opened")).toBeTruthy();
  expect(row.getByText("$7.50 per Box")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Retry stock entries" }));
  await row.findByText("$1.25 per Piece");
  await waitFor(() => expect(screen.queryByText("Entry refresh unavailable")).toBeNull());
  expect(writes.filter((write) => write.path.endsWith("/open"))).toEqual([
    { path: "/api/stock/products/7/open", body: { amount: 2.5, stock_entry_id: "mint" } },
  ]);
});

test.each([
  ["price", "$7.50 per Box", 4],
  ["amount", "2.5 Pieces", 2],
] as const)(
  "moved %s groups retain separate entry identities and visible labels",
  async (key, label, matches) => {
    mount("/stockentries?product=7");
    const user = userEvent.setup();
    const table = await screen.findByRole("table", { name: "Stock entries" });
    await user.click(screen.getByRole("button", { name: "Table options" }));
    const options = within(await screen.findByRole("dialog", { name: "Table options" }));
    await user.click(options.getByRole("radio", { name: "Location" }));
    await user.click(options.getByRole("button", { name: "OK" }));
    fireEvent.drop(within(table).getByRole("columnheader", { name: "Location" }), {
      dataTransfer: { getData: () => key },
    });
    expect(within(table).getByRole("button", { name: "Cellar" })).toBeTruthy();
    await user.click(within(table).getByRole("button", { name: "Product" }));
    expect(table.querySelectorAll(".stock-table-group")).toHaveLength(4);
    const groups = within(table).getAllByRole("button", { name: label });
    expect(groups).toHaveLength(matches);
    await user.click(groups[0]!);
    expect(within(table).getAllByRole("button", { name: /^Edit stock entry/ })).toHaveLength(3);
  },
);

test("entry dates show special labels, Today, and date-only relative time", async () => {
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-10-28T12:00:00").getTime());
  mount("/stockentries?product=7", { dateCases: true });
  const user = userEvent.setup();
  await screen.findByText("Mint batch");

  const row = (id: number) =>
    within(screen.getByRole("button", { name: `Edit stock entry ${id}` }).closest("tr")!);

  expect(row(51).getByText("Never")).toBeTruthy();
  expect(row(52).getByText("Unknown")).toBeTruthy();
  expect(row(53).getByText("Today")).toBeTruthy();
  expect(row(53).getByText("in a day")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Table options" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Table options" }));
  await user.click(dialog.getByRole("radio", { name: "Due date" }));
  await user.click(dialog.getByRole("button", { name: "OK" }));
  // The reference groups raw date cells, whose row IDs keep equal dates separate.
  expect(screen.getAllByRole("button", { name: "Never" })).toHaveLength(2);
  await user.click(screen.getAllByRole("button", { name: "Never" })[0]!);
  expect(screen.queryByRole("button", { name: "Edit stock entry 51" })).toBeNull();
  expect(screen.getByRole("button", { name: "Edit stock entry 54" })).toBeTruthy();
});

test("entry order survives product filters and resets with the table layout", async () => {
  mount("/stockentries?product=8");
  const user = userEvent.setup();
  await screen.findByText("Tea batch");
  await user.click(screen.getByRole("button", { name: "Amount" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Product" }), "7");
  await screen.findByText("Mint batch");
  await user.click(screen.getByRole("button", { name: "Product" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Product" }), "8");
  await screen.findByText("Tea batch");

  const entries = () =>
    screen
      .getAllByRole("button", { name: /^Edit stock entry/ })
      .map((button) => button.getAttribute("aria-label"));

  expect(entries()).toEqual(["Edit stock entry 57", "Edit stock entry 55", "Edit stock entry 56"]);
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
  expect(entries()).toEqual(["Edit stock entry 55", "Edit stock entry 56", "Edit stock entry 57"]);
});
