import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import type { JsonObject } from "@/lib/json";
import { productOverview } from "./fixtures/product-overview";
import { supportDialogs } from "./fixtures/dialogs";

beforeEach(supportDialogs);

function mount(
  path: string,
  {
    scan = false,
    quick = false,
    tracking = true,
    failRead = false,
    failSave = false,
    failEntries = false,
    failBarcode = false,
    openPermission = true,
    duplicateEntry = false,
    singleUnit = false,
  } = {},
) {
  const writes: { path: string; body: JsonObject }[] = [];
  const reads: string[] = [];
  let detailReads = 0;
  let entryReads = 0;
  let bookings = 0;
  let scanEnabled = scan;
  let stock = { amount: 10, opened: 2 };
  let previousStock = { ...stock };

  const rows = [
    {
      id: 101,
      stock_id: "shelf-stock",
      amount: 4,
      location_id: 1,
      best_before_date: "2026-11-01",
      purchased_date: "2026-10-01",
      open: 0,
      note: null,
    },
    {
      id: 102,
      stock_id: "pantry-stock",
      amount: 6,
      location_id: 2,
      best_before_date: "2026-11-03",
      purchased_date: "2026-10-02",
      open: 0,
      note: "Batch two",
    },
    {
      id: 103,
      stock_id: "opened-stock",
      amount: 2,
      location_id: 2,
      best_before_date: "2026-11-02",
      purchased_date: "2026-10-03",
      open: 1,
      note: null,
    },
  ];

  if (duplicateEntry) rows.push({ ...rows[1]!, id: 104, amount: 1 });

  const fetchData = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;

    if (init?.method === "POST" || init?.method === "PUT") {
      const body = JSON.parse(String(init.body ?? "{}"));
      writes.push({ path, body });

      if (path.endsWith("/scan_mode_consume_enabled")) scanEnabled = body.value;

      if (path.endsWith("/objects/product_barcodes") && failBarcode)
        return Response.json({ error_message: "Barcode unavailable" }, { status: 400 });

      if (path.endsWith("/consume") || path.endsWith("/open")) {
        if (failSave && ++bookings === 1)
          return Response.json({ error_message: "Booking unavailable" }, { status: 503 });

        if (path.endsWith("/7/consume") || path.endsWith("/7/open")) {
          previousStock = { ...stock };

          if (path.endsWith("/consume")) stock.amount -= Number(body.amount);
          else stock.opened += Number(body.amount);
        }

        return Response.json([
          {
            id: 90,
            product_id: 7,
            amount: Number(body.amount),
            transaction_id: "consume-transaction",
            transaction_type: path.endsWith("/open") ? "product-opened" : "consume",
          },
        ]);
      }

      if (path.endsWith("/consume-transaction/undo")) stock = { ...previousStock };

      return Response.json({});
    }

    reads.push(url.pathname + url.search);

    if (path.endsWith("/api/v2/setup")) return Response.json({ needs_setup: false });

    if (path.endsWith("/api/user")) return Response.json([{ id: 1, username: "Owner" }]);

    if (path.endsWith("/api/v2/user/permissions"))
      return Response.json({ STOCK_OPEN: openPermission });

    if (path.endsWith("/api/user/settings"))
      return Response.json({
        stock_decimal_places_amounts: 2,
        stock_default_consume_amount: 0.5,
        stock_default_consume_amount_use_quick_consume_amount: quick,
        scan_mode_consume_enabled: scanEnabled,
      });

    if (path.endsWith("/api/system/config"))
      return Response.json({
        FEATURE_FLAG_STOCK: true,
        FEATURE_FLAG_STOCK_LOCATION_TRACKING: tracking,
        FEATURE_FLAG_RECIPES: tracking,
        FEATURE_FLAG_STOCK_PRODUCT_OPENED_TRACKING: true,
        FEATURE_FLAG_DISABLE_BROWSER_BARCODE_CAMERA_SCANNING: true,
      });

    if (path.endsWith("/api/v2/stock/consume/editor"))
      return Response.json({
        barcode_lookup_plugin_name: "Demo",
        products: [
          { id: 7, name: "Coffee" },
          { id: 8, name: "Tare coffee" },
          { id: 9, name: "Coffee group" },
        ],
        locations: [
          { id: 1, name: "Shelf", is_freezer: 0 },
          { id: 2, name: "Pantry", is_freezer: 0 },
        ],
        units: [{ id: 1, name: "Piece", name_plural: "Pieces" }],
        barcodes: [{ product_id: 7, barcodes: "COFFEE-2" }],
        recipes: [{ id: 4, name: "Coffee cake" }],
        conversions: [7, 8, 9]
          .flatMap((product_id) => [
            {
              product_id,
              from_qu_id: 1,
              to_qu_id: 1,
              factor: "99",
              to_qu_name: "Piece",
              to_qu_name_plural: "Pieces",
            },
            {
              product_id,
              from_qu_id: 1,
              to_qu_id: 3,
              factor: "0.125",
              to_qu_name: "Saved box",
              to_qu_name_plural: "Saved boxes",
            },
          ])
          .filter((row) => !singleUnit || row.to_qu_id === 1),
      });

    if (/\/api\/stock\/products\/[789]$/.test(path)) {
      if (failRead && ++detailReads === 1)
        return Response.json({ error_message: "Details unavailable" }, { status: 503 });
      const tare = path.endsWith("/8");
      const parent = path.endsWith("/9");

      return Response.json({
        ...productOverview,
        product: {
          ...productOverview.product,
          id: tare ? 8 : parent ? 9 : 7,
          name: tare ? "Tare coffee" : parent ? "Coffee group" : "Coffee",
          description: null,
          enable_tare_weight_handling: tare ? 1 : 0,
          tare_weight: 3,
          default_consume_location_id: 2,
          quick_consume_amount: 4,
          disable_open: 0,
          move_on_open: 1,
        },
        stock_amount: parent ? 0 : tare ? 10 : stock.amount,
        stock_amount_opened: parent ? 0 : tare ? 2 : stock.opened,
        stock_amount_aggregated: parent ? 12.5 : tare ? 10 : stock.amount,
        stock_amount_opened_aggregated: parent ? 2 : tare ? 2 : stock.opened,
        is_aggregated_amount: parent ? 1 : 0,
        has_childs: parent,
        quantity_unit_stock: { ...productOverview.quantity_unit_stock, id: 1 },
        default_quantity_unit_consume: {
          id: tare || singleUnit ? 1 : 3,
          name: "Box",
          name_plural: "Boxes",
        },
        location: { id: 1, name: "Shelf", is_freezer: 0 },
        default_consume_location: { id: 2, name: "Pantry" },
      });
    }

    if (path.endsWith("/locations"))
      return Response.json([
        { location_id: 1, location_name: "Shelf", amount: 4 },
        { location_id: 2, location_name: "Pantry", amount: 6 },
        { location_id: 2, location_name: "Pantry", amount: 2 },
      ]);

    if (path.endsWith("/entries")) {
      if (failEntries && ++entryReads === 1)
        return Response.json({ error_message: "Entries unavailable" }, { status: 503 });

      return Response.json(url.searchParams.has("query[]") ? [rows[0]] : rows);
    }

    if (
      path.endsWith("/api/objects/product_barcodes") ||
      path.endsWith("/api/objects/product_barcodes_view")
    )
      return Response.json(url.search.includes("COFFEE-2") ? [{ amount: 0.25, qu_id: 3 }] : []);

    if (path.includes("/shopping-lists/")) return Response.json({ items: [] });

    return Response.json([]);
  });

  vi.stubGlobal("fetch", fetchData);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });

  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });

  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  onTestFinished(() => {
    view.unmount();
    client.clear();
  });

  return { writes, reads, router, entries: rows };
}

async function choose(name = "Coffee") {
  const picker = await screen.findByLabelText("Product");
  fireEvent.change(picker, { target: { value: name } });
  fireEvent.keyDown(picker, { key: "Enter" });
  const amount = screen.getByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.disabled).toBe(false));

  return amount;
}

test("consume uses saved units, child-stock readers, recipes, spoiled state, reset, and Undo", async () => {
  const { writes, reads } = mount("/consume");
  const amount = await choose();
  expect(amount.value).toBe("0.5");
  expect(amount.max).toBe("1.00");
  expect(screen.getByText("This equals 4 Pieces")).toBeTruthy();
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("3");
  expect(screen.getByLabelText<HTMLSelectElement>("Location").value).toBe("2");
  expect(screen.getAllByRole("option", { name: "Pantry (Default location)" })).toHaveLength(1);
  expect(reads).toContain("/api/stock/products/7/locations?include_sub_products=true");
  expect(reads).toContain("/api/stock/products/7/entries?include_sub_products=true");
  fireEvent.click(screen.getByLabelText("Spoiled"));
  fireEvent.change(screen.getByLabelText("Recipe"), { target: { value: "Coffee cake" } });
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Removed 4 Pieces of Coffee from stock");
  expect(writes[0]).toEqual({
    path: "/api/stock/products/7/consume",
    body: {
      amount: "4.",
      exact_amount: false,
      spoiled: true,
      allow_subproduct_substitution: true,
      location_id: "2",
      recipe_id: "4",
    },
  });
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("");
  expect(screen.getByLabelText<HTMLInputElement>("Recipe").value).toBe("");
  expect(screen.getByLabelText<HTMLSelectElement>("Location").options).toHaveLength(1);
  expect(screen.getByLabelText<HTMLInputElement>("Spoiled").checked).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(writes.at(-1)?.path).toBe("/api/stock/transactions/consume-transaction/undo"),
  );
});

test("specific stock limits use raw entry amounts and persist after switching the item off", async () => {
  const { writes } = mount("/consume?embedded&product=7&locationId=1&stockId=pantry-stock");
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.disabled).toBe(false));
  expect(screen.getByLabelText<HTMLSelectElement>("Location").value).toBe("2");
  expect(screen.getByLabelText<HTMLInputElement>("Use a specific stock item").checked).toBe(true);
  const stock = screen.getByLabelText<HTMLSelectElement>("Specific stock item");
  expect(stock.value).toBe("pantry-stock");
  expect(
    screen.getByRole("option", {
      name: /Amount: 6; Due on 2026-11-03; Bought on 2026-10-02; Not opened Batch two/,
    }),
  ).toBeTruthy();
  fireEvent.change(stock, { target: { value: "opened-stock" } });
  expect(amount.max).toBe("2.00");
  fireEvent.click(screen.getByLabelText("Use a specific stock item"));
  expect(amount.max).toBe("2.00");
  fireEvent.click(screen.getByLabelText("Use a specific stock item"));
  fireEvent.change(stock, { target: { value: "pantry-stock" } });
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Removed 4 Pieces of Coffee from stock");
  expect(writes[0]?.body.stock_entry_id).toBe("pantry-stock");
  expect(amount.disabled).toBe(true);
});

test("tare consumption accepts gross weight and keeps exact and spoiled choices across products", async () => {
  const { writes } = mount("/consume");
  const amount = await choose("Tare coffee");
  expect(amount.min).toBe("3");
  expect(amount.max).toBe("11.00");
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Mark as opened" }).disabled).toBe(
    true,
  );
  fireEvent.change(amount, { target: { value: "8" } });
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Removed 5 Pieces of Tare coffee from stock");
  expect(writes[0]?.body.amount).toBe("8.");
  await choose("Tare coffee");
  fireEvent.click(screen.getByLabelText("Consume exact amount"));
  expect(amount.min).toBe("0.01");
  expect(amount.max).toBe("8.00");
  fireEvent.change(amount, { target: { value: "2" } });
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Removed 2 Pieces of Tare coffee from stock");
  await choose();
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(writes.filter((row) => row.path.endsWith("/consume"))).toHaveLength(3),
  );
  expect(writes.at(-1)?.body.exact_amount).toBe(true);
});

test("a repeated stock code retains both choices and the native unchecked prefill", async () => {
  mount("/consume?embedded&product=7&stockId=pantry-stock", { duplicateEntry: true });
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.disabled).toBe(false));
  const entry = screen.getByLabelText<HTMLSelectElement>("Specific stock item");
  expect([...entry.options].filter((row) => row.value === "pantry-stock")).toHaveLength(2);
  expect(screen.getByLabelText<HTMLInputElement>("Use a specific stock item").checked).toBe(false);
  expect(entry.disabled).toBe(true);
  expect(entry.value).toBe("pantry-stock");
  expect(amount.max).toBe("1.13");
});

test("opening retains recipe, unit, and location and does not close an embedded form", async () => {
  const { writes } = mount("/consume?embedded&product=7");
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.disabled).toBe(false));
  fireEvent.change(screen.getByLabelText("Recipe"), { target: { value: "grcy:r:4" } });
  fireEvent.blur(screen.getByLabelText("Recipe"));
  fireEvent.click(screen.getByLabelText("Spoiled"));
  await userEvent.click(screen.getByRole("button", { name: "Mark as opened" }));
  await screen.findByText("Marked 4 Pieces of Coffee as opened");
  expect(writes[0]).toEqual({
    path: "/api/stock/products/7/open",
    body: { amount: "4.", allow_subproduct_substitution: true },
  });
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("");
  expect(screen.getByLabelText<HTMLInputElement>("Recipe").value).toBe("Coffee cake");
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("3");
  expect(screen.getByLabelText<HTMLSelectElement>("Location").value).toBe("2");
  expect(amount.disabled).toBe(false);
  expect(screen.getByLabelText<HTMLSelectElement>("Specific stock item").disabled).toBe(false);
  expect(screen.getByText("Moved to Pantry")).toBeTruthy();
});

test("a failed booking enables native input controls until their own handlers change them", async () => {
  const { writes } = mount("/consume", { singleUnit: true, failSave: true });
  await choose();
  const unit = screen.getByLabelText<HTMLSelectElement>("Quantity unit");
  const stockItem = screen.getByLabelText<HTMLSelectElement>("Specific stock item");
  expect(unit.disabled).toBe(true);
  expect(stockItem.disabled).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Booking unavailable");
  expect(unit.disabled).toBe(false);
  expect(stockItem.disabled).toBe(false);
  fireEvent.change(stockItem, { target: { value: "pantry-stock" } });
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Removed 0.5 Pieces of Coffee from stock");
  expect(writes.at(-1)?.body).toEqual({
    amount: "0.5",
    allow_subproduct_substitution: true,
    exact_amount: false,
    spoiled: false,
    location_id: "2",
  });
  expect(stockItem.disabled).toBe(false);
  await choose();
  expect(unit.disabled).toBe(true);
  expect(stockItem.disabled).toBe(false);
  fireEvent.click(screen.getByLabelText("Use a specific stock item"));
  fireEvent.click(screen.getByLabelText("Use a specific stock item"));
  expect(stockItem.disabled).toBe(true);
});

test("parent stock has no amount ceiling and its own-stock opening guard remains disabled", async () => {
  mount("/consume");
  const amount = await choose("Coffee group");
  expect(amount.max).toBe("");
  fireEvent.change(amount, { target: { value: "1000" } });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(false);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Mark as opened" }).disabled).toBe(
    true,
  );
});

test("read and booking failures keep the draft and permit retry without an extra booking", async () => {
  const { writes } = mount("/consume", { failRead: true, failSave: true });
  fireEvent.change(await screen.findByLabelText("Product"), { target: { value: "Coffee" } });
  await screen.findByText("Details unavailable");
  await userEvent.click(
    within(screen.getByRole("form", { name: "Consume" })).getByRole("button", { name: "Retry" }),
  );
  const amount = screen.getByLabelText<HTMLInputElement>("Amount");
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(false),
  );
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Booking unavailable");
  expect(amount.value).toBe("0.5");
  expect(amount.disabled).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Removed 4 Pieces of Coffee from stock");
  expect(writes.filter((row) => row.path.endsWith("/consume"))).toHaveLength(2);
});

test("an entry read failure has a separate retry and hidden tracking controls do not change the body", async () => {
  const { writes } = mount("/consume?embedded&product=7", {
    tracking: false,
    failEntries: true,
    openPermission: false,
  });

  await screen.findByText("Entries unavailable");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(false),
  );
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Mark as opened" }).disabled).toBe(
    true,
  );
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Removed 4 Pieces of Coffee from stock");
  expect(writes[0]?.body).toEqual({
    amount: "4.",
    exact_amount: false,
    spoiled: false,
    allow_subproduct_substitution: true,
  });
});

test("full-page scan mode saves its setting and consumes one display unit", async () => {
  const { writes } = mount("/consume");
  await userEvent.click(await screen.findByRole("button", { name: "Scan mode off" }));
  await screen.findByRole("button", { name: "Scan mode on" });
  await choose();
  await screen.findByText("Removed 8 Pieces of Coffee from stock");
  expect(writes.find((row) => row.path.endsWith("/consume"))?.body.amount).toBe("8.");
});

test("embedded scan mode stays off while quick consume amounts use the selected factor", async () => {
  const { writes } = mount("/consume?embedded&product=7", { scan: true, quick: true });
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.disabled).toBe(false));
  expect(amount.value).toBe("0.5");
  expect(screen.queryByRole("button", { name: /Scan mode/ })).toBeNull();
  expect(writes).toEqual([]);
});

test("barcode amounts survive scan mode and stock codes choose their entry location", async () => {
  const { writes } = mount("/consume", { scan: true });
  await choose("COFFEE-2");
  await screen.findByText("Removed 2 Pieces of Coffee from stock");
  expect(writes[0]?.body.amount).toBe("2.");
  await userEvent.click(screen.getByRole("button", { name: "Scan mode on" }));
  await screen.findByRole("button", { name: "Scan mode off" });
  const amount = await choose("grcy:p:7:shelf-stock");
  expect(amount.value).toBe("4");
  expect(screen.getByLabelText<HTMLSelectElement>("Location").value).toBe("1");
  expect(screen.getByLabelText<HTMLSelectElement>("Specific stock item").value).toBe("shelf-stock");
  fireEvent.change(amount, { target: { value: "0.25" } });
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(writes.filter((row) => row.path.endsWith("/consume"))).toHaveLength(2),
  );
  expect(writes.at(-1)?.body.stock_entry_id).toBe("shelf-stock");
});

test("full-page bookmarks retain native empty defaults until the product is selected", async () => {
  mount("/consume?product=7&product-name=Coffee");
  const product = await screen.findByLabelText<HTMLInputElement>("Product");
  expect(product.value).toBe("Coffee");
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("");
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(true);
  fireEvent.keyDown(product, { key: "Enter" });
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("3"),
  );
});

test.each(["open", "consume"] as const)(
  "the consume card retains its native values after %s and Undo until selection",
  async (action) => {
    mount("/consume");
    const amount = await choose();
    fireEvent.change(screen.getByLabelText("Quantity unit"), { target: { value: "1" } });
    fireEvent.change(amount, { target: { value: "2" } });
    const facts = () => screen.getByText("Stock amount").nextElementSibling!.textContent;
    await waitFor(() => expect(facts()).toBe("10 Pieces 2 opened"));
    await userEvent.click(
      screen.getByRole("button", { name: action === "open" ? "Mark as opened" : "OK" }),
    );
    await screen.findByText(
      action === "open"
        ? "Marked 2 Pieces of Coffee as opened"
        : "Removed 2 Pieces of Coffee from stock",
    );
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe(""));
    const retained = action === "open" ? "10 Pieces 2 opened" : "8 Pieces 2 opened";
    await waitFor(() => expect(facts()).toBe(retained));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).toBeNull());
    expect(facts()).toBe(retained);
    await choose();
    await waitFor(() => expect(facts()).toBe("10 Pieces 2 opened"));
  },
);

test.each(["location", "amount"] as const)(
  "stock-code location changes retain amounts with focus on %s",
  async (focus) => {
    const { entries, writes } = mount("/consume");
    const amount = await choose("grcy:p:7:shelf-stock");
    expect(amount.value).toBe("4");
    expect(document.querySelector<HTMLInputElement>('input[name="amount"]')!.value).toBe("4.");
    expect(screen.getByText("This equals 4 Pieces")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Quantity unit"), { target: { value: "1" } });
    await userEvent.click(amount);
    fireEvent.change(amount, { target: { value: "1" } });
    entries[0]!.location_id = 2;
    entries[0]!.amount = 3;

    if (focus === "location") await userEvent.selectOptions(screen.getByLabelText("Location"), "2");
    else fireEvent.change(screen.getByLabelText("Location"), { target: { value: "2" } });
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLSelectElement>("Location").value).toBe("2"),
    );
    await waitFor(() => expect(amount.value).toBe("3"));
    expect(screen.getByLabelText<HTMLSelectElement>("Location").value).toBe("2");
    expect(amount.value).toBe("3");
    expect(screen.getByLabelText<HTMLSelectElement>("Specific stock item").value).toBe(
      "shelf-stock",
    );
    expect(document.querySelector<HTMLInputElement>('input[name="amount"]')!.value).toBe("1.");

    if (focus === "location") {
      await userEvent.selectOptions(screen.getByLabelText("Location"), "");
      await waitFor(() =>
        expect(screen.getByLabelText<HTMLSelectElement>("Location").value).toBe("2"),
      );
      expect(amount.value).toBe("3");
    }

    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText(
      focus === "location"
        ? "Removed 1 Piece of Coffee from stock"
        : "Removed 3 Pieces of Coffee from stock",
    );
    expect(writes[0]?.body).toEqual({
      amount: focus === "location" ? "1." : "3.",
      allow_subproduct_substitution: true,
      exact_amount: false,
      spoiled: false,
      location_id: "2",
      stock_entry_id: "shelf-stock",
    });
  },
);

test("barcode assignment uses only its native values and a failed assignment still completes consumption", async () => {
  const { writes, router } = mount(
    "/consume?flow=InplaceAddBarcodeToExistingProduct&barcode=NEW-CODE&product-name=Coffee&locationId=2",
    { failBarcode: true },
  );

  await choose();
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Removed 4 Pieces of Coffee from stock");
  await screen.findByText("Barcode unavailable");
  expect(writes[1]).toEqual({
    path: "/api/objects/product_barcodes",
    body: { barcode: "NEW-CODE", product_id: "7" },
  });
  await waitFor(() => expect(router.state.location.search).toEqual({ locationId: "2" }));
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("");
});
