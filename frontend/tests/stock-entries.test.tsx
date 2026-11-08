import { nativeProductContext } from "./fixtures/native-product";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import type { EntryRow } from "@/lib/stock-entries";
import type { JsonValue } from "@/lib/json";
import type { UserSettings } from "@/lib/types";
import { queryKeys } from "@/lib/api";
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
    failRowRefresh = false,
  } = {},
) {
  // JSDOM omits source/origin on actual same-window postMessage delivery.
  // Restore only those browser transport fields; the real host handles each bag.
  const sameWindowMessage = (event: MessageEvent) => {
    if (event.origin === "" && event.source === null)
      Object.defineProperties(event, {
        origin: { value: window.location.origin },
        source: { value: window },
      });
  };

  window.addEventListener("message", sameWindowMessage, true);
  onTestFinished(() => window.removeEventListener("message", sameWindowMessage, true));

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
  const requests: { path: string; method: string; signal: AbortSignal | null | undefined }[] = [];
  let reads = 0;
  let actions = 0;
  let undoReads = 0;
  let before: EntryRow[] = [];
  let editorReads = 0;
  let editorWrites = 0;
  let productReads = 0;
  let rowRefreshAllowed = false;
  const overview = structuredClone(productOverview);
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
      requests.push({ path, method: init?.method ?? "GET", signal: init?.signal });

      if (path === "/api/system/info")
        return Response.json({ grocy_version: { Version: "4.5.0", ReleaseDate: "" } });

      if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (path === "/api/v2/user/permissions") return Response.json({ MASTER_DATA_EDIT: true });

      if (path === "/api/v2/localization")
        return Response.json({
          locale: "en",
          direction: "ltr",
          languages: ["en"],
          catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
        });

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

      if (
        path.endsWith("/api/v2/stock/entries/51/editor") ||
        (path.endsWith("/api/v2/stock/entries/native-editor") &&
          url.searchParams.get("row") === "51")
      ) {
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

      if (path === "/api/products/7/nutrition")
        return Response.json({ error_message: "No nutrition" }, { status: 404 });

      if (path === "/api/stock/products/7/entries") return Response.json(rows);

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
        productReads++;

        if (
          (failRefresh && productReads === 1) ||
          (failRowRefresh && productReads > 1 && !rowRefreshAllowed)
        )
          return Response.json({ error_message: "Entry refresh unavailable" }, { status: 503 });

        return Response.json(overview);
      }

      if (path.endsWith("/api/v2/content/products/7"))
        return Response.json({ html: productOverview.product.description });

      if (path.endsWith("/api/stock/products/7/price-history")) return Response.json([]);

      if (path.endsWith("/api/objects/userfields") || path.endsWith("/api/v2/custom-data/fields"))
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

      if (path.endsWith("/api/v2/products/native-editor")) {
        if (url.searchParams.get("row") !== "7")
          return Response.json({ error_message: "Object not found" }, { status: 404 });

        return Response.json(
          nativeProductContext({
            product: {
              id: 7,
              name: "Coffee",
              location_id: 1,
              qu_id_stock: 1,
              qu_id_purchase: 1,
              qu_id_consume: 1,
              qu_id_price: 1,
              active: 1,
              userfields: null,
            },
            references: {
              locations: [
                { id: 1, name: "Shelf" },
                { id: 2, name: "Cellar" },
              ],
              quantity_units: [{ id: 1, name: "Piece", name_plural: "Pieces" }],
              shopping_locations: [],
              product_groups: [],
              products: [{ id: 7, name: "Coffee" }],
            },
            user_settings: {
              stock_decimal_places_amounts: precision,
              stock_decimal_places_prices_input: precision,
              stock_decimal_places_prices_display: 2,
              "datatables_state_stockentries-table": tableState,
            },
            config: {
              FEATURE_FLAG_STOCK: stock,
              FEATURE_FLAG_SHOPPINGLIST: tracking,
              FEATURE_FLAG_STOCK_LOCATION_TRACKING: tracking,
              FEATURE_FLAG_STOCK_PRICE_TRACKING: tracking,
              FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: tracking,
              FEATURE_FLAG_STOCK_PRODUCT_OPENED_TRACKING: tracking,
              FEATURE_FLAG_LABEL_PRINTER: printer,
              LABEL_PRINTER_RUN_SERVER: true,
              CURRENCY: "USD",
            },
          }),
        );
      }

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
        return Response.json([{ id: 1, username: "tester", display_name: "Tester" }]);

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

  return {
    writes,
    router,
    client,
    labels,
    overview,
    requests,
    allowRowRefresh: () => {
      rowRefreshAllowed = true;
    },
    updateEntry: (id: number, changes: Partial<EntryRow>) => {
      rows = rows.map((row) => (row.id === id ? { ...row, ...changes } : row));
    },
    releaseSavedRead: () => releaseSavedRead(),
  };
}

test.each([true, false])(
  "native Stock entries anchor opens an independent selected iframe and retains its product owner's draft (stock=%s)",
  async (stock) => {
    const app = mount("/product/7", { stock });
    const user = userEvent.setup();
    const name = await screen.findByLabelText<HTMLInputElement>("Name");
    await user.type(name, " draft");
    const link = screen.getByRole("link", { name: "Stock entries" });
    expect(link.getAttribute("href")).toBe("/stockentries?embedded&product=7");
    expect(link.getAttribute("data-dialog-type")).toBe("table");
    await user.click(link);
    const dialog = await screen.findByRole("dialog", { name: "Stock entries" });
    const frame = within(dialog).getByTitle<HTMLIFrameElement>("Stock entries");
    expect(new URL(frame.src).pathname + new URL(frame.src).search).toBe(
      "/stockentries?embedded&product=7",
    );
    expect(within(dialog).queryByRole("table")).toBeNull();
    expect(app.requests.some((request) => request.path === "/api/v2/stock/entries")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(frame.isConnected).toBe(false);
    expect(name.isConnected).toBe(true);
    expect(name.value).toBe("Coffee draft");
    expect(app.router.history.location.pathname).toBe("/product/7");
  },
);

test.each([
  { action: "Edit", title: "Edit stock entry", href: "/stockentry/51?embedded" },
  {
    action: "Transfer",
    title: "Transfer",
    href: "/transfer?embedded&product=7&locationId=1&stockId=mint&batch=two#tail",
  },
])(
  "native row $action keeps its exact source URL and opens an independent form frame",
  async ({ action, title, href }) => {
    const app = mount("/stockentries?embedded&product=7");
    app.updateEntry(51, { stock_id: "mint&batch=two#tail" });
    await screen.findByText("Mint batch");
    const location = screen.getByRole<HTMLSelectElement>("combobox", { name: "Location" });
    await userEvent.selectOptions(location, "1");
    const link = screen.getByRole("link", { name: `${action} stock entry 51` });
    expect(link.getAttribute("href")).toBe(href);
    await userEvent.click(link);
    const dialog = await screen.findByRole("dialog", { name: title });
    expect(dialog.classList.contains("form")).toBe(true);
    const frame = within(dialog).getByTitle<HTMLIFrameElement>(title);
    expect(frame.src).toBe(window.location.origin + href);
    expect(within(dialog).queryByRole("form")).toBeNull();
    expect(app.requests.some(({ path }) => path === "/api/v2/stock/entries/51/editor")).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(location.isConnected).toBe(true);
    expect(location.value).toBe("1");
  },
);

test("a row form opened from an embedded Entries page is hosted by the topmost Grocy peer", async () => {
  const host = { IsGrocy: true, postMessage: vi.fn() };
  Object.defineProperty(host, "parent", { value: host });
  vi.stubGlobal("parent", host);
  mount("/stockentries?embedded&product=7");
  await userEvent.click(await screen.findByRole("link", { name: "Edit stock entry 51" }));
  await waitFor(() =>
    expect(
      host.postMessage.mock.calls.filter(([data]) => data.Message === "IframeModal"),
    ).toHaveLength(1),
  );
  expect(host.postMessage).toHaveBeenCalledWith(
    {
      Message: "IframeModal",
      Payload: { Link: `${window.location.origin}/stockentry/51?embedded`, DialogType: "form" },
    },
    window.location.origin,
  );
  expect(document.querySelector("iframe")).toBeNull();
});

test("native entry booking uses fresh details before broadcasting and Undo broadcasts its selected product", async () => {
  const app = mount("/stockentries?product=7");
  const posted = vi.spyOn(window, "postMessage");
  const user = userEvent.setup();
  await screen.findByText("Mint batch");
  app.overview.product.name = "Fresh coffee";
  app.overview.quantity_unit_stock.name_plural = "Fresh pieces";
  const start = app.requests.length;
  await user.click(screen.getByRole("button", { name: "Open stock entry 51" }));
  await screen.findByText("Marked 2.5 Fresh pieces of Fresh coffee as opened");
  expect(
    app.requests.slice(start, start + 2).map(({ path, method }) => ({ path, method })),
  ).toEqual([
    { path: "/api/stock/products/7/open", method: "POST" },
    { path: "/api/stock/products/7", method: "GET" },
  ]);
  expect(posted).toHaveBeenCalledWith(
    { Message: "BroadcastMessage", Payload: { Message: "ProductChanged", Payload: 7 } },
    window.location.origin,
  );
  await user.click(
    within(screen.getByRole("status", { name: "Stock updated" })).getByRole("button", {
      name: "Undo",
    }),
  );
  await screen.findByText("Booking successfully undone");
  expect(app.writes.at(-1)).toEqual({ path: "/api/stock/bookings/900/undo", body: {} });
  expect(posted.mock.calls.filter(([data]) => data.Message === "BroadcastMessage")).toHaveLength(2);
});

test("ProductChanged refreshes matching current DOM rows and rejects foreign or unrelated messages", async () => {
  const app = mount("/stockentries?product=7");
  await screen.findByText("Mint batch");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Location" }), "2");
  app.updateEntry(52, { note: "Changed in another document", amount: 3 });
  const start = app.requests.length;

  const send = (product: JsonValue, origin = window.location.origin) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin,
        data: { Message: "ProductChanged", Payload: product },
      }),
    );

  act(() => send(7));
  await screen.findByText("Changed in another document");
  expect(
    app.requests
      .slice(start)
      .filter(({ path }) => /^\/api\/stock\/entry\/\d+$/.test(path))
      .map(({ path }) => path),
  ).toEqual(["/api/stock/entry/52"]);
  const after = app.requests.length;
  act(() => {
    send(7, "https://elsewhere.test");
    send(8);
    send([7]);
  });
  await act(async () => Promise.resolve());
  expect(app.requests).toHaveLength(after);
  app.updateEntry(52, { amount: 0 });
  act(() => send(7));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Consume stock entry 52" })).toBeNull(),
  );
  app.updateEntry(52, { id: 152, amount: 2, note: "Restored as a new stock row" });
  act(() => send(7));
  await screen.findByText("Restored as a new stock row");
  expect(screen.getByRole("button", { name: "Consume stock entry 152" })).toBeTruthy();
  expect(app.requests.filter(({ path }) => path === "/api/v2/stock/entries")).toHaveLength(2);
});

test.each([
  { stage: "booking", failed: false },
  { stage: "booking", failed: true },
  { stage: "undo", failed: false },
  { stage: "undo", failed: true },
  { stage: "refresh", failed: false },
])(
  "departed native $stage response (failed=$failed) cannot start later reads, messages, or UI effects",
  async ({ stage, failed }) => {
    const app = mount("/stockentries?product=7");
    await screen.findByText("Mint batch");
    const user = userEvent.setup();
    const posted = vi.spyOn(window, "postMessage");

    if (stage === "undo") {
      await user.click(screen.getByRole("button", { name: "Open stock entry 51" }));
      await within(
        screen.getByRole("link", { name: "Edit stock entry 51" }).closest("tr")!,
      ).findByText("Opened");
    }

    const target =
      stage === "booking"
        ? "/api/stock/products/7/open"
        : stage === "undo"
          ? "/api/stock/bookings/900/undo"
          : "/api/stock/entry/51";

    const transport = fetch;
    let release = () => {};

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    let held = false;
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, options?: RequestInit) => {
      const response = await transport(input, options);

      if (String(input) === target) {
        held = true;
        signal = options?.signal;
        await gate;

        if (failed)
          return Response.json({ error_message: "Response failed after commit" }, { status: 503 });
      }

      return response;
    });
    app.client.setQueryData(["stock", 7], { private: "old document" });

    if (stage === "booking") {
      await user.click(screen.getByRole("button", { name: "Open stock entry 51" }));
      expect(document.body.classList.contains("cursor-busy")).toBe(true);
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Consume stock entry 52" }).disabled,
      ).toBe(false);
    } else if (stage === "undo")
      await user.click(
        within(screen.getByRole("status", { name: "Stock updated" })).getByRole("button", {
          name: "Undo",
        }),
      );
    else
      act(() =>
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: window.location.origin,
            data: { Message: "ProductChanged", Payload: 7 },
          }),
        ),
      );
    await waitFor(() => expect(held).toBe(true));
    await act(() => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
    await screen.findByRole("heading", { name: "Settings" });
    const reads = app.requests.length;
    const messages = posted.mock.calls.length;
    expect(signal?.aborted).toBe(true);
    await act(async () => release());
    expect(app.requests).toHaveLength(reads);
    expect(posted.mock.calls).toHaveLength(messages);
    expect(screen.queryByText(/Marked .* as opened|Booking successfully undone/)).toBeNull();

    if (stage !== "refresh")
      expect(app.client.getQueryState(["stock", 7])?.isInvalidated).toBe(true);
  },
);

test("native entry Product overview retains filters through its independent child iframe", async () => {
  const { overview, writes } = mount("/stockentries?embedded&product=7", { failRefresh: true });
  const user = userEvent.setup();
  const entries = screen;
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
  const stock = view.getByRole("link", { name: "Stock entries" });
  await user.click(stock);
  const child = await screen.findByRole("dialog", { name: "Stock entries" });
  expect(new URL(within(child).getByTitle<HTMLIFrameElement>("Stock entries").src).search).toBe(
    "?embedded&product=7",
  );
  expect(within(child).queryByRole("table")).toBeNull();
  await user.click(within(child).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Stock entries" })).toBeNull());
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
  expect(writes.filter((write) => write.path === "/api/objects/products/7")).toHaveLength(0);
  await user.click(entries.getByRole("button", { name: "Table options" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Table options" })).getByRole("button", {
      name: "Reset",
    }),
  );
  await user.click(
    within(
      screen.getByRole("dialog", { name: "Are you sure you want to reset the table options?" }),
    ).getByRole("button", { name: "Yes" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Table options" })).toBeNull());
  await entries.findByText("Mint batch");
});

test("reopening a product overview retains partial card fields after repeated unit-format errors", async () => {
  const { overview } = mount("/stockentries");
  const user = userEvent.setup();
  const trigger = (await screen.findAllByRole("button", { name: "Product overview: Coffee" }))[0]!;
  await user.click(trigger);
  let dialog = await screen.findByRole("dialog", { name: "Product overview" });
  await within(dialog).findByText("$12.50");
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  overview.quantity_unit_stock.name_plural = "broken %";
  overview.stock_amount = 3.123456;
  overview.stock_value = 99;

  for (let opening = 0; opening < 2; opening++) {
    await user.click(trigger);
    dialog = await screen.findByRole("dialog", { name: "Product overview" });
    await within(dialog).findByText("3.123456 Pieces");
    expect(within(dialog).getByText("$12.50")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(trigger);
  }
});

test("pending card reads survive same-product reopen, complete in order, and stop at page departure", async () => {
  const { overview, router } = mount("/stockentries");
  const user = userEvent.setup();
  const trigger = (await screen.findAllByRole("button", { name: "Product overview: Coffee" }))[0]!;
  await user.click(trigger);
  let dialog = await screen.findByRole("dialog", { name: "Product overview" });
  await within(dialog).findByText("2.5 Pieces");
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  const transport = fetch;
  const pending: Array<{ release: () => void; signal: AbortSignal | null | undefined }> = [];
  let historyReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path.endsWith("/api/stock/products/7/price-history")) historyReads++;
      const response = await transport(input, init);

      if (path.endsWith("/api/stock/products/7"))
        await new Promise<void>((resolve) => {
          pending.push({ release: resolve, signal: init?.signal });
        });

      return response;
    }),
  );
  overview.stock_amount = 3;
  await user.click(trigger);
  await waitFor(() => expect(pending).toHaveLength(1));
  dialog = screen.getByRole("dialog", { name: "Product overview" });
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(pending[0]?.signal?.aborted).toBe(false);
  overview.stock_amount = 4;
  await user.click(trigger);
  await waitFor(() => expect(pending).toHaveLength(2));
  dialog = screen.getByRole("dialog", { name: "Product overview" });
  await act(async () => pending[1]?.release());
  await within(dialog).findByText("4 Pieces");
  await act(async () => pending[0]?.release());
  await within(dialog).findByText("3 Pieces");
  await waitFor(() => expect(historyReads).toBe(2));
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  await user.click(trigger);
  await waitFor(() => expect(pending).toHaveLength(3));
  await act(async () => {
    await router.navigate({ to: "/household" });
  });
  await screen.findByRole("heading", { name: "Household" });
  expect(pending[2]?.signal?.aborted).toBe(true);
  await act(async () => pending[2]?.release());
  expect(historyReads).toBe(2);
  expect(screen.queryByRole("dialog", { name: "Product overview" })).toBeNull();
});

test("table reset cancels hidden card reads and discards retained fields and expansion", async () => {
  const { overview } = mount("/stockentries");
  const user = userEvent.setup();
  const trigger = (await screen.findAllByRole("button", { name: "Product overview: Coffee" }))[0]!;
  await user.click(trigger);
  let dialog = await screen.findByRole("dialog", { name: "Product overview" });
  await within(dialog).findByText("$12.50");
  await user.click(within(dialog).getByRole("button", { name: "Show more" }));
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  const transport = fetch;
  let hold = true;
  let release: (() => void) | undefined;
  let signal: AbortSignal | null | undefined;
  let historyReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path.endsWith("/api/stock/products/7/price-history")) historyReads++;
      const response = await transport(input, init);

      if (path.endsWith("/api/stock/products/7") && hold) {
        signal = init?.signal;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }

      return response;
    }),
  );
  onTestFinished(() => release?.());
  await user.click(trigger);
  await waitFor(() => expect(release).toBeDefined());
  dialog = screen.getByRole("dialog", { name: "Product overview" });
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Table options" }));
  await user.click(screen.getByRole("button", { name: "Reset" }));
  await user.click(screen.getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(signal?.aborted).toBe(true);
  hold = false;
  await act(async () => release?.());
  expect(historyReads).toBe(0);
  overview.quantity_unit_stock.name_plural = "broken %";
  overview.stock_amount = 4;
  await user.click(
    (await screen.findAllByRole("button", { name: "Product overview: Coffee" }))[0]!,
  );
  dialog = await screen.findByRole("dialog", { name: "Product overview" });
  await within(dialog).findByText("4", { exact: false, selector: "dd > span" });
  const amount = within(dialog).getByText("Stock amount", { selector: "dt" }).nextElementSibling;
  expect(amount?.firstElementChild?.textContent).toBe("4 ");
  expect(
    within(dialog).getByText("Stock value", { selector: "dt" }).nextElementSibling?.textContent,
  ).toBe("");
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  overview.quantity_unit_stock.name_plural = "Pieces";
  await user.click(
    (await screen.findAllByRole("button", { name: "Product overview: Coffee" }))[0]!,
  );
  dialog = await screen.findByRole("dialog", { name: "Product overview" });
  await within(dialog).findByRole("button", { name: "Show more" });
});

test("native embedded entries retain exact actions, retry, and Undo across row replacement", async () => {
  const { writes, requests } = mount("/stockentries?embedded&product=7", { fail: true });
  const user = userEvent.setup();
  const view = screen;
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
  await user.click(
    within(view.getByRole("status", { name: "Stock updated" })).getByRole("button", {
      name: "Undo",
    }),
  );
  await view.findByText("Undo failed");
  await user.click(
    within(view.getByRole("status", { name: "Stock updated" })).getByRole("button", {
      name: "Undo",
    }),
  );
  await waitFor(() =>
    expect(
      view.getByRole<HTMLButtonElement>("button", { name: "Open stock entry 51" }).disabled,
    ).toBe(false),
  );
  await user.click(view.getByRole("button", { name: "Consume stock entry 51 as spoiled" }));
  await waitFor(() =>
    expect(view.queryByRole("button", { name: "Consume stock entry 51" })).toBeNull(),
  );
  await waitFor(() =>
    expect(requests.filter(({ path }) => path === "/api/v2/stock/entries")).toHaveLength(2),
  );
  await view.findByRole("button", { name: "Consume stock entry 52" });
  expect(view.queryByRole("status", { name: "Stock updated" })).toBeNull();
  await user.click(view.getByRole("button", { name: "Consume stock entry 52" }));
  await waitFor(() =>
    expect(requests.filter(({ path }) => path === "/api/v2/stock/entries")).toHaveLength(3),
  );
  await view.findByText("Tare batch");
  expect(view.queryByRole("button", { name: "Consume stock entry 52" })).toBeNull();
  expect(writes.filter((w) => w.path.endsWith("/open")).map((w) => w.body)).toEqual([
    { amount: 2.5, stock_entry_id: "mint" },
    { amount: 2.5, stock_entry_id: "mint" },
  ]);
  expect(writes.filter((w) => w.path.endsWith("/consume")).map((w) => w.body)).toEqual([
    { amount: 2.5, spoiled: true, location_id: "1", stock_entry_id: "mint", exact_amount: true },
    { amount: 1, spoiled: false, location_id: "2", stock_entry_id: "opened", exact_amount: true },
  ]);
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

test.each(["/stockentries", "/stockentry/51"])(
  "native %s loads stock data with its module disabled",
  async (path) => {
    const app = mount(path, { stock: false });

    if (path === "/stockentries") await screen.findByText("Mint batch");
    else await screen.findByRole("form", { name: "Edit stock entry" });
    expect(app.writes).toEqual([]);
  },
);

test("modern product ledger preserves entry validation and transaction-scoped upload retry", async () => {
  const { writes, labels } = mount("/products/7", {
    editRetry: true,
    printer: true,
  });

  const user = userEvent.setup();
  const entries = within(await screen.findByRole("region", { name: "Entries and bookings" }));
  await waitFor(() => expect(entries.getAllByRole("button", { name: "Edit" })).toHaveLength(7));
  await user.click(entries.getAllByRole("button", { name: "Edit" })[0]!);
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
  await user.click(entries.getAllByRole("button", { name: "Edit" })[0]!);
  const reopened = await screen.findByRole("dialog", { name: "Edit stock entry" });
  expect(
    (await within(reopened).findByRole<HTMLInputElement>("textbox", { name: "Note" })).value,
  ).toBe("Edited batch");
  fireEvent(reopened, new Event("cancel", { bubbles: true, cancelable: true }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Edit stock entry" })).toBeNull(),
  );
  expect(screen.getByRole("region", { name: "Entries and bookings" })).toBeTruthy();
  expect(document.activeElement).toBe(entries.getAllByRole("button", { name: "Edit" })[0]!);
});

test("entry dates retain legacy shortcut focus, calendar values, and label reprint rules", async () => {
  const { writes, labels } = mount("/stockentry/51", { printer: true });
  const user = userEvent.setup();
  await screen.findByRole("spinbutton", { name: /^Amount/ });
  const purchased = screen.getByLabelText<HTMLInputElement>("Purchased date");
  const due = screen.getByLabelText<HTMLInputElement>("Due date");
  const never = screen.getByRole<HTMLInputElement>("checkbox", { name: "Never overdue" });

  const reprint = screen.getByRole<HTMLInputElement>("checkbox", {
    name: "Reprint stock entry label",
  });

  expect(never.checked).toBe(false);
  expect(due.readOnly).toBe(false);
  await user.click(screen.getByRole("button", { name: "Due date: Calendar" }));
  await user.click(screen.getByRole("button", { name: "Close the picker" }));
  expect(never.checked).toBe(true);
  expect(due.readOnly).toBe(true);
  expect(reprint.checked).toBe(true);
  await user.click(reprint);
  await user.click(due);
  // The pinned picker consumes the browser's legacy keyCode; user-event leaves it at zero.
  fireEvent.keyUp(due, { key: "ArrowUp", keyCode: 38 });
  expect(due.value).toBe("2999-12-30");
  expect(never.checked).toBe(false);
  expect(due.readOnly).toBe(false);
  expect(reprint.checked).toBe(true);
  await user.click(never);
  await user.click(never);
  await user.click(reprint);
  await user.type(due, "20320229");
  expect(due.value).toBe("2032-02-29");
  expect(document.activeElement).toBe(due);
  expect(reprint.checked).toBe(false);
  await user.click(screen.getByRole("button", { name: "Due date: Calendar" }));
  await user.click(screen.getByRole("button", { name: "March 1, 2032" }));
  expect(due.value).toBe("2032-03-01");
  expect(reprint.checked).toBe(true);
  await user.click(reprint);
  await user.clear(purchased);
  await user.type(purchased, "20320229");
  expect(purchased.value).toBe("2032-02-29");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "OK" }));
  expect(reprint.checked).toBe(false);
  await user.click(screen.getByRole("button", { name: "Purchased date: Calendar" }));
  await user.click(screen.getByRole("button", { name: "Next Month" }));
  await user.click(screen.getByRole("button", { name: "April 2, 2032" }));
  expect(purchased.value).toBe("2032-04-02");
  expect(reprint.checked).toBe(false);
  await user.selectOptions(screen.getByRole("combobox", { name: "Location" }), "2");
  await user.selectOptions(screen.getByRole("combobox", { name: "Store" }), "");
  await user.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Stock entry successfully updated");
  expect(writes.find((write) => write.path === "/api/stock/entry/51")?.body).toMatchObject({
    best_before_date: "2032-03-01",
    purchased_date: "2032-04-02",
    shopping_location_id: "",
  });
  expect(labels).toHaveLength(0);
});

test("the modern ledger entry editor applies disabled tracking values and reloads saved data", async () => {
  const { writes, releaseSavedRead, requests } = mount("/products/7", {
    tracking: false,
    precision: 0,
    deferSavedRead: true,
  });

  const user = userEvent.setup();
  const ledger = within(await screen.findByRole("region", { name: "Entries and bookings" }));
  await waitFor(() => expect(ledger.getAllByRole("button", { name: "Edit" })).toHaveLength(7));
  await user.click(ledger.getAllByRole("button", { name: "Edit" })[0]!);
  let fields = within(await screen.findByRole("dialog", { name: "Edit stock entry" }));
  const amount = await fields.findByRole<HTMLInputElement>("spinbutton", { name: /^Amount/ });
  expect(amount.value).toBe("3");
  expect(amount.min).toBe("1");
  expect(amount.step).toBe("1");
  const purchased = fields.getByLabelText<HTMLInputElement>("Purchased date");
  await user.clear(purchased);
  await user.click(fields.getByRole("button", { name: "OK" }));
  expect(purchased.validity.valueMissing).toBe(true);
  expect(writes).toHaveLength(0);
  fireEvent.change(purchased, { target: { value: "2026-10-22" } });
  await user.clear(fields.getByRole("textbox", { name: "Note" }));
  await user.type(fields.getByRole("textbox", { name: "Note" }), "Direct edit");
  await user.click(fields.getByRole("button", { name: "OK" }));
  await user.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await user.click(ledger.getAllByRole("button", { name: "Edit" })[0]!);
  fields = within(await screen.findByRole("dialog", { name: "Edit stock entry" }));
  await waitFor(() =>
    expect(
      requests.filter(({ path }) => path === "/api/v2/stock/entries/51/editor").length,
    ).toBeGreaterThan(1),
  );
  await act(async () => releaseSavedRead());
  await fields.findByDisplayValue("Mint batch");
  expect(fields.getByLabelText<HTMLInputElement>("Purchased date").value).toBe("2026-10-20");
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
  const { writes, updateEntry } = mount("/stockentries?product=7", { firstAmount: 1 });
  const user = userEvent.setup();
  await screen.findByText("Mint batch");
  await user.selectOptions(screen.getByRole("combobox", { name: "Location" }), "1");
  await user.click(screen.getByRole("button", { name: "Table options" }));
  let options = within(await screen.findByRole("dialog", { name: "Table options" }));
  await user.click(options.getByRole("radio", { name: "Location" }));
  await user.click(options.getByRole("button", { name: "OK" }));
  await user.click(screen.getByRole("link", { name: "Edit stock entry 51" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit stock entry" });
  const frame = within(dialog).getByTitle<HTMLIFrameElement>("Edit stock entry");
  // The child's native writer has its own owner proof. This parent receives its
  // real protocol after the fixture's persisted record changes.
  updateEntry(51, {
    amount: 10,
    location_id: 2,
    note: "Edited cache",
    stock_values: { batch: "Lime" },
  });
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        source: frame.contentWindow,
        data: { Message: "BroadcastMessage", Payload: { Message: "ProductChanged", Payload: 7 } },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        source: frame.contentWindow,
        data: { Message: "CloseLastModal" },
      }),
    );
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await screen.findByText("Edited cache");

  const changed = () =>
    within(screen.getByRole("link", { name: "Edit stock entry 51" }).closest("tr")!);

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
      .getAllByRole("link", { name: /^Edit stock entry/ })
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
  expect(screen.queryByRole("link", { name: "Edit stock entry 51" })).toBeNull();
});

test("entry refresh Retry keeps the completed booking and partial display update", async () => {
  const { writes, allowRowRefresh } = mount("/stockentries?product=7", { failRowRefresh: true });
  const user = userEvent.setup();
  await screen.findByText("Mint batch");
  await user.click(screen.getByRole("button", { name: "Open stock entry 51" }));
  await screen.findByText("Entry refresh unavailable");
  const row = within(screen.getByRole("link", { name: "Edit stock entry 51" }).closest("tr")!);
  expect(row.getByText("Opened")).toBeTruthy();
  expect(row.getByText("$7.50 per Box")).toBeTruthy();
  allowRowRefresh();
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
    expect(within(table).getAllByRole("link", { name: /^Edit stock entry/ })).toHaveLength(3);
  },
);

test("entry dates show special labels, Today, and date-only relative time", async () => {
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-10-28T12:00:00").getTime());
  mount("/stockentries?product=7", { dateCases: true });
  const user = userEvent.setup();
  await screen.findByText("Mint batch");

  const row = (id: number) =>
    within(screen.getByRole("link", { name: `Edit stock entry ${id}` }).closest("tr")!);

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
  expect(screen.queryByRole("link", { name: "Edit stock entry 51" })).toBeNull();
  expect(screen.getByRole("link", { name: "Edit stock entry 54" })).toBeTruthy();
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
      .getAllByRole("link", { name: /^Edit stock entry/ })
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
  await waitFor(() =>
    expect(entries()).toEqual([
      "Edit stock entry 55",
      "Edit stock entry 56",
      "Edit stock entry 57",
    ]),
  );
});

function heldResetResponse() {
  let release = (_response: Response) => {};

  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

const entryStateKey = "datatables_state_stockentries-table";
const entryGroupKey = "datatables_rowGroup_stockentries-table";

function savedEntryPreferences(): UserSettings {
  const search = { search: "", smart: true, regex: false, caseInsensitive: true };

  return {
    stock_decimal_places_amounts: 2,
    stock_decimal_places_prices_input: 2,
    stock_decimal_places_prices_display: 2,
    [entryStateKey]: JSON.stringify({
      time: 1,
      start: 0,
      length: 10,
      order: [[2, "asc"]],
      search,
      columns: Array.from({ length: 14 }, (_, i) => ({ visible: i !== 10, search })),
      ColReorder: Array.from({ length: 14 }, (_, i) => i),
      select: { rows: [], columns: [], cells: [] },
      childRows: [],
    }),
  };
}

function tablePreferenceWire(initial: UserSettings, failFirstState = false) {
  const upstream = fetch;
  const server: UserSettings = { ...initial };

  const puts: {
    key: string;
    value: string;
    body: { value: string };
    signal: AbortSignal | null | undefined;
    reply: ReturnType<typeof heldResetResponse>;
    failure: boolean;
  }[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input), "http://localhost").pathname;

      if (path === "/api/user/settings" && (!init?.method || init.method === "GET"))
        return Response.json(server);

      if (init?.method === "PUT" && path.startsWith("/api/user/settings/datatables_")) {
        const key = decodeURIComponent(path.split("/").at(-1)!);
        const body: { value: string } = JSON.parse(String(init.body));

        const failure =
          failFirstState && key === entryStateKey && !puts.some((put) => put.key === entryStateKey);

        const reply = heldResetResponse();
        puts.push({ key, value: body.value, body, signal: init.signal, reply, failure });

        // Commit order is independent from delivery order; a retired request may already be stored.
        if (!failure) server[key] = body.value;

        return reply.promise;
      }

      return upstream(input, init);
    }),
  );

  return {
    server,
    puts,
    async settle(index: number) {
      const put = puts[index]!;
      await act(async () =>
        put.reply.release(
          put.failure
            ? Response.json({ error_message: "Private table PUT failed" }, { status: 503 })
            : new Response(null, { status: 204 }),
        ),
      );
    },
  };
}

async function entryOptions() {
  await screen.findByRole("table", { name: "Stock entries" });
  await userEvent.click(screen.getByRole("button", { name: "Table options" }));

  return screen.findByRole("dialog", { name: "Table options" });
}

test("ordinary table PUTs keep OK and Reset usable and failures stay console-only without unchanged replay", async () => {
  const settings = savedEntryPreferences();
  const app = mount("/stockentries?product=7", { tableState: String(settings[entryStateKey]) });
  const wire = tablePreferenceWire(settings, true);
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  let dialog = await entryOptions();
  expect(wire.puts).toEqual([]);
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "Note" }));
  await waitFor(() => expect(wire.puts).toHaveLength(1));
  expect(within(dialog).getByRole("button", { name: "OK" }).matches(":disabled")).toBe(false);
  expect(within(dialog).getByRole("button", { name: "Reset" }).matches(":disabled")).toBe(false);
  expect(
    JSON.parse(
      String(app.client.getQueryData<UserSettings>(queryKeys.userSettings)?.[entryStateKey]),
    ).columns[11].visible,
  ).toBe(false);
  await userEvent.click(within(dialog).getByRole("button", { name: "OK" }));
  expect(screen.queryByRole("dialog", { name: "Table options" })).toBeNull();
  expect(wire.puts[0]!.signal?.aborted).toBe(false);
  await wire.settle(0);
  await waitFor(() => expect(logger).toHaveBeenCalledTimes(1));
  expect(screen.queryByText("Private table PUT failed")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry table options" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  dialog = await entryOptions();
  expect(within(dialog).getByRole<HTMLInputElement>("checkbox", { name: "Note" }).checked).toBe(
    false,
  );
  expect(
    JSON.parse(
      String(app.client.getQueryData<UserSettings>(queryKeys.userSettings)?.[entryStateKey]),
    ).columns[11].visible,
  ).toBe(false);
  await userEvent.click(within(dialog).getByRole("button", { name: "OK" }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Location" }), "2");
  await userEvent.click(screen.getByRole("button", { name: "Clear filter" }));
  await act(async () => {});
  expect(wire.puts).toHaveLength(1);
  dialog = await entryOptions();
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "Note" }));
  await waitFor(() => expect(wire.puts).toHaveLength(2));
  await wire.settle(1);
  expect(JSON.parse(String(wire.server[entryStateKey])).columns[11].visible).toBe(true);
});

test("reverse table PUT replies cannot backdate the newest draft or cause an unsolicited state replay", async () => {
  const settings = savedEntryPreferences();
  const app = mount("/stockentries?product=7", { tableState: String(settings[entryStateKey]) });
  const wire = tablePreferenceWire(settings);
  const dialog = await entryOptions();
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "Note" }));
  await waitFor(() => expect(wire.puts).toHaveLength(1));
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "Timestamp" }));
  await waitFor(() => expect(wire.puts).toHaveLength(2));
  expect(
    wire.puts.map((put) => ({
      key: put.key,
      note: JSON.parse(put.value).columns[11].visible,
      timestamp: JSON.parse(put.value).columns[10].visible,
    })),
  ).toEqual([
    { key: entryStateKey, note: false, timestamp: false },
    { key: entryStateKey, note: false, timestamp: true },
  ]);
  await wire.settle(1);
  await wire.settle(0);
  await act(async () => {});
  expect
    .soft(
      JSON.parse(
        String(app.client.getQueryData<UserSettings>(queryKeys.userSettings)?.[entryStateKey]),
      ),
    )
    .toEqual(JSON.parse(wire.puts[1]!.value));
  expect(within(dialog).getByRole<HTMLInputElement>("checkbox", { name: "Note" }).checked).toBe(
    false,
  );
  expect(
    within(dialog).getByRole<HTMLInputElement>("checkbox", { name: "Timestamp" }).checked,
  ).toBe(true);
  await userEvent.click(within(dialog).getByRole("button", { name: "OK" }));
  expect(screen.queryByRole("columnheader", { name: "Note" })).toBeNull();
  expect(screen.getByRole("columnheader", { name: "Timestamp" })).toBeTruthy();
  expect(JSON.parse(String(wire.server[entryStateKey])).columns[10].visible).toBe(true);
  expect(wire.puts).toHaveLength(2);
});

test("group preference PUT launches independently of held layout saves and saved searches stay blank", async () => {
  const settings = savedEntryPreferences();
  mount("/stockentries?product=7", { tableState: String(settings[entryStateKey]) });
  const wire = tablePreferenceWire(settings);
  const dialog = await entryOptions();
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "Note" }));
  await waitFor(() => expect(wire.puts).toHaveLength(1));
  await userEvent.click(within(dialog).getByRole("radio", { name: "Location" }));
  await waitFor(() => expect(wire.puts.some((put) => put.key === entryGroupKey)).toBe(true));
  const groupIndex = wire.puts.findIndex((put) => put.key === entryGroupKey);
  expect(wire.puts[groupIndex]!.body).toEqual({ value: '{"enable":true,"dataSrc":"5"}' });
  expect(screen.getByRole("button", { name: "Shelf" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cellar" })).toBeTruthy();
  await userEvent.click(within(dialog).getByRole("button", { name: "OK" }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Location" }), "2");
  await userEvent.click(screen.getByRole("button", { name: "Clear filter" }));

  for (const put of wire.puts.filter((put) => put.key === entryStateKey)) {
    const saved = JSON.parse(put.value);
    expect(put.body).toEqual({ value: put.value });
    expect(saved.time).not.toBe(1);
    expect(saved.search.search).toBe("");
    expect(
      saved.columns.every((column: { search: { search: string } }) => column.search.search === ""),
    ).toBe(true);
  }

  const count = wire.puts.length;

  for (let i = count - 1; i >= 0; i--) await wire.settle(i);
  await act(async () => {});
  expect(wire.puts).toHaveLength(count);
});

test("embedded table options close retains PUT ownership but actual document replacement retires late cache writes", async () => {
  const settings = savedEntryPreferences();

  const app = mount("/stockentries?embedded&product=7", {
    tableState: String(settings[entryStateKey]),
  });

  const wire = tablePreferenceWire(settings);
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  let dialog = await entryOptions();
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "Note" }));
  await waitFor(() => expect(wire.puts).toHaveLength(1));
  fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
  expect(screen.queryByRole("dialog", { name: "Table options" })).toBeNull();
  expect(wire.puts[0]!.signal?.aborted).toBe(false);
  await act(async () => app.router.navigate({ href: "/settings?tab=connection" }));
  expect(wire.puts[0]!.signal?.aborted).toBe(true);
  await act(async () => app.router.navigate({ href: "/stockentries?embedded&product=7" }));
  dialog = await entryOptions();
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "Timestamp" }));
  await waitFor(() => expect(wire.puts).toHaveLength(2));
  await wire.settle(1);
  const newest = app.client.getQueryData<UserSettings>(queryKeys.userSettings)?.[entryStateKey];
  await wire.settle(0);
  expect(app.client.getQueryData<UserSettings>(queryKeys.userSettings)?.[entryStateKey]).toBe(
    newest,
  );
  expect(app.client.getQueryState(queryKeys.userSettings)?.isInvalidated).toBe(true);
  expect(
    within(dialog).getByRole<HTMLInputElement>("checkbox", { name: "Timestamp" }).checked,
  ).toBe(true);
  expect(screen.queryByRole("button", { name: "Retry table options" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(logger).not.toHaveBeenCalled();
  expect(wire.puts).toHaveLength(2);
});

async function confirmEntriesReset(user: ReturnType<typeof userEvent.setup>) {
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
}

test("native Reset dispatches absent group and state deletions independently, then retires held group errors", async () => {
  const app = mount("/stockentries");
  const user = userEvent.setup();
  await screen.findByText("Mint batch");
  const table = screen.getByRole("link", { name: "Edit stock entry 51" }).closest("table")!;
  const group = heldResetResponse();
  const state = heldResetResponse();
  const deletes: { path: string; signal: AbortSignal | null | undefined; body: unknown }[] = [];
  const originalFetch = fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;

    if (init?.method === "DELETE" && path.startsWith("/api/user/settings/")) {
      deletes.push({ path, signal: init.signal, body: init.body });

      return path.endsWith("datatables_rowGroup_stockentries-table")
        ? group.promise
        : state.promise;
    }

    return originalFetch(input, init);
  });
  await confirmEntriesReset(user);
  await waitFor(() =>
    expect(deletes.map((entry) => entry.path)).toEqual([
      "/api/user/settings/datatables_rowGroup_stockentries-table",
      "/api/user/settings/datatables_state_stockentries-table",
    ]),
  );
  expect(deletes.map((entry) => entry.body)).toEqual(["{}", "{}"]);
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Table options" }));
  const options = within(await screen.findByRole("dialog", { name: "Table options" }));
  expect(options.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(false);
  expect(options.getByRole<HTMLButtonElement>("button", { name: "Reset" }).disabled).toBe(false);
  await user.click(options.getByRole("button", { name: "OK" }));
  expect(table.isConnected).toBe(true);
  expect(
    app.client.getQueryData<UserSettings>(queryKeys.userSettings)?.[
      "datatables_state_stockentries-table"
    ],
  ).toBeUndefined();
  await act(async () => state.release(new Response(null, { status: 204 })));
  await waitFor(() => expect(table.isConnected).toBe(false));
  await screen.findByText("Mint batch");
  expect(deletes[0]?.signal?.aborted).toBe(true);
  await act(async () =>
    group.release(
      Response.json(
        { error_message: "Old group deletion failed" },
        { status: 503, statusText: "Service Unavailable" },
      ),
    ),
  );
  expect(screen.queryByText("Error while deleting, please retry")).toBeNull();
  expect(screen.queryByText("Old group deletion failed")).toBeNull();
  expect(app.client.getQueryState(queryKeys.userSettings)?.isInvalidated).toBe(true);
  expect(screen.queryByRole("button", { name: "Retry table options" })).toBeNull();
});

test.each([
  { failed: "group", succeeds: "state", replaces: true, statusText: "Service Unavailable" },
  { failed: "state", succeeds: "group", replaces: false, statusText: "Service Unavailable" },
  { failed: "state", succeeds: "group", replaces: false, statusText: "" },
])(
  "native Reset handles $failed failure (statusText=$statusText) independently of $succeeds success",
  async ({ failed, replaces, statusText }) => {
    const app = mount("/stockentries");
    const user = userEvent.setup();
    await screen.findByText("Mint batch");
    const table = screen.getByRole("link", { name: "Edit stock entry 51" }).closest("table")!;
    const group = heldResetResponse();
    const state = heldResetResponse();
    const deletes: string[] = [];
    const originalFetch = fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;

      if (init?.method === "DELETE" && path.startsWith("/api/user/settings/")) {
        deletes.push(path);

        return path.endsWith("datatables_rowGroup_stockentries-table")
          ? group.promise
          : state.promise;
      }

      return originalFetch(input, init);
    });
    await confirmEntriesReset(user);
    await waitFor(() => expect(deletes).toHaveLength(2));
    const failure = failed === "group" ? group : state;
    const success = failed === "group" ? state : group;
    await act(async () =>
      failure.release(
        Response.json({ error_message: `${failed} deletion failed` }, { status: 503, statusText }),
      ),
    );

    if (statusText) await screen.findByText("Error while deleting, please retry");
    else expect(screen.queryByText("Error while deleting, please retry")).toBeNull();
    expect(table.isConnected).toBe(true);
    expect(screen.queryByRole("button", { name: "Retry table options" })).toBeNull();
    await act(async () => success.release(new Response(null, { status: 204 })));

    if (replaces) {
      await waitFor(() => expect(table.isConnected).toBe(false));
      await screen.findByText("Mint batch");
    } else {
      expect(table.isConnected).toBe(true);
      expect(
        app.client.getQueryData<UserSettings>(queryKeys.userSettings)?.[
          "datatables_state_stockentries-table"
        ],
      ).toBeUndefined();
      expect(screen.queryByRole("button", { name: "Retry table options" })).toBeNull();
    }
  },
);
