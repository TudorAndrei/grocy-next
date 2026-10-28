import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import type { EntryRow } from "@/lib/stock-entries";
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

function mount(path: string, { fail = false, stock = true, tracking = true } = {}) {
  const base: EntryRow = {
    id: 51,
    product_id: 7,
    product_name: "Coffee",
    stock_id: "mint",
    amount: 2.5,
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
  ];

  const writes: { path: string; body: object }[] = [];
  let reads = 0;
  let actions = 0;
  let undoReads = 0;
  let before: EntryRow[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname;

      if (path.endsWith("/api/system/config"))
        return Response.json({
          FEATURE_FLAG_STOCK: stock,
          FEATURE_FLAG_STOCK_LOCATION_TRACKING: tracking,
          FEATURE_FLAG_STOCK_PRICE_TRACKING: tracking,
          FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: tracking,
          FEATURE_FLAG_STOCK_PRODUCT_OPENED_TRACKING: tracking,
          CURRENCY: "USD",
        });

      if (path.endsWith("/api/user/settings"))
        return Response.json({
          stock_decimal_places_amounts: 2,
          stock_decimal_places_prices_display: 2,
        });

      if (path.includes("/shopping-lists/")) return Response.json({ items: [] });

      if (path.endsWith("/api/v2/stock/entries")) {
        if (fail && ++reads === 1)
          return Response.json({ detail: "Entries unavailable" }, { status: 503 });

        return Response.json({
          rows,
          products: [
            { id: 7, name: "Coffee" },
            { id: 8, name: "Tea" },
          ],
          locations: [
            { id: 2, name: "Cellar" },
            { id: 1, name: "Shelf" },
          ],
          stores: [{ id: 1, name: "Roastery" }],
        });
      }

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

      if (path.endsWith("/api/objects/products/7"))
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

      if (path.endsWith("/api/userfields/products/7")) return Response.json({ origin: "Peru" });

      if (path.endsWith("/api/user"))
        return Response.json({ id: 1, username: "tester", display_name: "Tester" });

      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}"));
        writes.push({ path, body });

        if (path.endsWith("/api/stock/bookings/900/undo")) {
          if (fail && ++undoReads === 1)
            return Response.json({ error_message: "Undo failed" }, { status: 500 });
          rows = before.map((row) => ({ ...row }));

          return new Response(null, { status: 204 });
        }

        if (path.match(/\/api\/stock\/products\/7\/(open|consume)$/)) {
          if (fail && ++actions === 1)
            return Response.json({ error_message: "Booking failed" }, { status: 500 });
          before = rows.map((row) => ({ ...row }));
          rows = path.endsWith("/open")
            ? rows.map((row) => (row.stock_id === body.stock_entry_id ? { ...row, open: 1 } : row))
            : rows.filter((row) => row.stock_id !== body.stock_entry_id);

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
  await waitFor(() => expect(view.queryByText("Mint batch")).toBeNull());
  await user.click(view.getByRole("button", { name: "Undo" }));
  await view.findByText("Mint batch");
  await waitFor(() =>
    expect(document.activeElement).toBe(view.getByRole("region", { name: "Stock entries" })),
  );
  await user.click(view.getByRole("button", { name: "Consume stock entry 51" }));
  await waitFor(() => expect(view.queryByText("Mint batch")).toBeNull());
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
    await user.selectOptions(screen.getByRole("combobox", { name: "Location" }), "2");
    await user.click(screen.getByRole("button", { name: "Clear filter" }));
    await screen.findByText("Mint batch");

    if (embedded) expect(screen.queryByText("Tea batch")).toBeNull();
    else await screen.findByText("Tea batch");
    expect(router.state.location.search.product).toBe(embedded ? "7" : undefined);
  },
);

test("stock entry reads remain available with tracking disabled", async () => {
  mount("/stockentries?product=7", { tracking: false });
  await screen.findByText("Mint batch");
  expect(screen.getAllByRole("button", { name: /^Consume stock entry \d+$/ })).toHaveLength(4);
  expect(screen.queryByRole("button", { name: /^Open stock entry/ })).toBeNull();
  expect(screen.queryByRole("columnheader", { name: "Price" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Location" })).toBeNull();
});

test("the legacy stock entry route obeys the stock feature flag", async () => {
  mount("/stockentries", { stock: false });
  await screen.findByRole("heading", { name: "Feature disabled" });
});
