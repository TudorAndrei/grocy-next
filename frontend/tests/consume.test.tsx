import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
    stockLocations,
    delayThirdStockLookup = false,
    failScanSetting = false,
    delayBooking = false,
    recipes = [{ id: 4, name: "Coffee cake" }],
    camera = false,
  }: {
    scan?: boolean;
    quick?: boolean;
    tracking?: boolean;
    failRead?: boolean;
    failSave?: boolean;
    failEntries?: boolean;
    failBarcode?: boolean;
    openPermission?: boolean;
    duplicateEntry?: boolean;
    singleUnit?: boolean;
    stockLocations?: number[];
    delayThirdStockLookup?: boolean;
    failScanSetting?: boolean;
    delayBooking?: boolean;
    recipes?: { id: number; name: string }[];
    camera?: boolean;
  } = {},
) {
  const writes: { path: string; body: JsonObject }[] = [];
  const sounds: string[] = [];
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    sounds.push(new URL(this.src).pathname);

    return Promise.resolve();
  });
  const reads: string[] = [];
  let detailReads = 0;
  let entryReads = 0;
  let bookings = 0;
  let scanEnabled = scan;
  let stock = { amount: 10, opened: 2 };
  let previousStock = { ...stock };
  let stockLookups = 0;
  let releaseThirdStockLookup!: () => void;

  const thirdStockLookup = new Promise<void>((resolve) => {
    releaseThirdStockLookup = resolve;
  });

  let releaseBooking!: () => void;

  const bookingReply = new Promise<void>((resolve) => {
    releaseBooking = resolve;
  });

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

  if (stockLocations?.includes(3))
    rows.push({ ...rows[0]!, id: 105, stock_id: "back-stock", location_id: 3, amount: 5 });

  const fetchData = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;

    if (init?.method === "POST" || init?.method === "PUT") {
      const body = JSON.parse(String(init.body ?? "{}"));
      writes.push({ path, body });

      if (path.endsWith("/scan_mode_consume_enabled")) {
        if (failScanSetting)
          return Response.json({ error_message: "Scan setting unavailable" }, { status: 503 });
        scanEnabled = body.value;
      }

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

        if (delayBooking) await bookingReply;

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
        FEATURE_FLAG_DISABLE_BROWSER_BARCODE_CAMERA_SCANNING: !camera,
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
        recipes,
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
          default_consume_location_id: stockLocations?.at(-1) ?? 2,
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
      return Response.json(
        stockLocations?.map((location) => ({
          location_id: location,
          location_name: ["", "Shelf", "Pantry", "Back"][location],
          amount: rows
            .filter((row) => row.location_id === location)
            .reduce((sum, row) => sum + row.amount, 0),
        })) ?? [
          { location_id: 1, location_name: "Shelf", amount: 4 },
          { location_id: 2, location_name: "Pantry", amount: 6 },
          { location_id: 2, location_name: "Pantry", amount: 2 },
        ],
      );

    if (path.endsWith("/entries")) {
      if (failEntries && ++entryReads === 1)
        return Response.json({ error_message: "Entries unavailable" }, { status: 503 });

      if (url.searchParams.has("query[]")) {
        if (++stockLookups === 3 && delayThirdStockLookup) await thirdStockLookup;

        return Response.json([rows[0]]);
      }

      return Response.json(rows);
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

  return {
    sounds,
    writes,
    reads,
    router,
    entries: rows,
    releaseThirdStockLookup,
    releaseBooking,
  };
}

async function choose(name = "Coffee") {
  const picker = await screen.findByLabelText("Product");
  fireEvent.change(picker, { target: { value: name } });
  fireEvent.keyDown(picker, { key: "Enter" });
  const amount = screen.getByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.disabled).toBe(false));

  return amount;
}

async function recipeField() {
  await choose();
  // Complete the form's scheduled focus before the user edits the next field.
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

  return screen.getByLabelText<HTMLInputElement>("Recipe");
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
  fireEvent.keyDown(screen.getByLabelText("Recipe"), { key: "Tab" });
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

test.each([
  { text: "cake", confirm: "Enter", expected: undefined },
  { text: "CAKE", confirm: "Tab", expected: "4" },
  { text: "Coffee cake", confirm: "blur", expected: undefined },
  { text: "Other recipe", confirm: "blur", expected: undefined },
  { text: "grcy:r:4", confirm: "blur", expected: "4" },
  { text: "grcy:p:4", confirm: "blur", expected: undefined },
])(
  "consume recipe text $text with $confirm books recipe $expected",
  async ({ text, confirm, expected }) => {
    const { writes } = mount("/consume");
    const picker = await recipeField();
    await userEvent.type(picker, text);

    if (confirm === "blur") fireEvent.blur(picker);
    else fireEvent.keyDown(picker, { key: confirm });

    if (confirm === "blur" && text === "Coffee cake") {
      fireEvent.click(screen.getByRole("button", { name: "OK" }));
      expect(writes).toEqual([]);
      await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    }

    if (confirm === "Enter") await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());

    expect(writes).toEqual([]);
    expect(picker.value).toBe(expected ? "Coffee cake" : text.startsWith("grcy") ? "" : text);
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Removed 4 Pieces of Coffee from stock");
    expect(writes.filter((row) => row.path.endsWith("/consume"))).toHaveLength(1);
    expect(writes.find((row) => row.path.endsWith("/consume"))?.body.recipe_id).toBe(expected);
  },
);

test("consume recipe choices retain native matching order, navigation, pointer selection, and clear", async () => {
  const { writes } = mount("/consume", {
    recipes: [
      { id: 1, name: "A cake" },
      { id: 2, name: "cake one" },
      { id: 3, name: "A CAKE" },
      { id: 4, name: "cake two" },
    ],
  });

  const picker = await recipeField();
  await userEvent.type(picker, "cake");
  expect(
    within(screen.getByRole("listbox", { name: "Recipes" }))
      .getAllByRole("option")
      .map((row) => row.textContent),
  ).toEqual(["cake one", "cake two", "A cake", "A CAKE"]);
  await userEvent.keyboard("{ArrowUp}{Tab}");
  expect(picker.value).toBe("A CAKE");
  await userEvent.click(screen.getByRole("button", { name: "Recipe: Clear" }));
  expect(picker.value).toBe("");
  await userEvent.type(picker, "cake{Escape}");
  await userEvent.click(screen.getByRole("button", { name: "Recipes" }));
  expect(picker.value).toBe("");
  await userEvent.click(screen.getByRole("option", { name: "cake two" }));
  expect(picker.value).toBe("cake two");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Removed 4 Pieces of Coffee from stock");
  expect(writes.find((row) => row.path.endsWith("/consume"))?.body.recipe_id).toBe("4");
});

test("editing or dismissing a recipe choice retains text and clears its booking ID", async () => {
  const { writes } = mount("/consume");
  const picker = await recipeField();
  await userEvent.type(picker, "cake{Tab}");
  expect(picker.value).toBe("Coffee cake");
  await userEvent.type(picker, "x");
  await userEvent.keyboard("{Backspace}{Escape}{Tab}");
  expect(picker.value).toBe("Coffee cake");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Removed 4 Pieces of Coffee from stock");
  expect(writes.find((row) => row.path.endsWith("/consume"))?.body.recipe_id).toBeUndefined();
});

test("Enter selects a recipe before the consume form has a product", async () => {
  const { writes } = mount("/consume");
  const picker = await screen.findByLabelText<HTMLInputElement>("Recipe");
  await userEvent.type(picker, "cake{Enter}");
  expect(picker.value).toBe("Coffee cake");
  expect(writes).toEqual([]);
  await choose();
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Removed 4 Pieces of Coffee from stock");
  expect(writes.find((row) => row.path.endsWith("/consume"))?.body.recipe_id).toBe("4");
});

test("scan mode waits for an open recipe list before it can book", async () => {
  const { writes } = mount("/consume", { scan: true, singleUnit: true });
  const recipe = await screen.findByLabelText("Recipe");
  await userEvent.type(recipe, "cake");
  fireEvent.blur(recipe);
  await choose("grcy:p:7");
  expect(writes).toEqual([]);
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Removed 1 Piece of Coffee from stock");
  expect(writes.filter((row) => row.path.endsWith("/consume"))).toHaveLength(1);
  expect(writes.find((row) => row.path.endsWith("/consume"))?.body.recipe_id).toBeUndefined();
});

test("the recipe camera action retains the selected recipe when camera access fails", async () => {
  const { writes } = mount("/consume", { camera: true });
  const picker = await recipeField();
  await userEvent.type(picker, "cake{Tab}");
  const camera = screen.getByRole("button", { name: "Recipe: Scan with camera" });
  await userEvent.click(camera);
  const dialog = await screen.findByRole("dialog", { name: "Scan a barcode" });
  await within(dialog).findByText(/Camera access failed:/);
  await userEvent.click(within(dialog).getByRole("button", { name: "Close camera" }));
  expect(document.activeElement).toBe(camera);
  expect(picker.value).toBe("Coffee cake");
  expect(writes).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Removed 4 Pieces of Coffee from stock");
  expect(writes.find((row) => row.path.endsWith("/consume"))?.body.recipe_id).toBe("4");
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

test.each([
  { locations: [1], choices: 1, checked: true, maximum: "0.50", delayed: false },
  { locations: [1, 2], choices: 2, checked: false, maximum: "1.00", delayed: false },
  { locations: [1, 3, 2], choices: 3, checked: true, maximum: "1.50", delayed: false },
  { locations: [1, 3, 2], choices: 3, checked: true, maximum: "0.50", delayed: true },
])(
  "initial stock-code callbacks retain choices and booking values for $locations with delayed=$delayed",
  async ({ locations, choices, checked, maximum, delayed }) => {
    const { writes, releaseThirdStockLookup } = mount("/consume", {
      stockLocations: locations,
      delayThirdStockLookup: delayed,
    });

    const picker = await screen.findByLabelText("Product");

    fireEvent.change(picker, { target: { value: "grcy:p:7:shelf-stock" } });
    fireEvent.keyDown(picker, { key: "Enter" });
    const entry = screen.getByLabelText<HTMLSelectElement>("Specific stock item");
    const matches = () => [...entry.options].filter((row) => row.value === "shelf-stock");

    if (delayed) {
      await waitFor(() => expect(matches()).toHaveLength(2));
      releaseThirdStockLookup();
    }

    const amount = screen.getByLabelText<HTMLInputElement>("Amount");
    await waitFor(() => expect(amount.disabled).toBe(false));
    expect(matches()).toHaveLength(choices);
    expect(entry.value).toBe("shelf-stock");
    expect(entry.disabled).toBe(!checked);
    expect(screen.getByLabelText<HTMLInputElement>("Use a specific stock item").checked).toBe(
      checked,
    );
    expect(screen.getByLabelText<HTMLSelectElement>("Location").value).toBe("1");
    expect(amount.value).toBe("4");
    expect(amount.max).toBe(maximum);
    expect(document.querySelector<HTMLInputElement>('input[name="amount"]')!.value).toBe("4.");
    fireEvent.change(amount, { target: { value: "0.25" } });
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Removed 2 Pieces of Coffee from stock");

    const expected: JsonObject = {
      amount: "2.",
      allow_subproduct_substitution: true,
      exact_amount: false,
      spoiled: false,
      location_id: "1",
    };

    if (checked) expected.stock_entry_id = "shelf-stock";
    expect(writes[0]).toEqual({
      path: "/api/stock/products/7/consume",
      body: expected,
    });
  },
);

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

test.each(["Enter", "browser list"])(
  "full-page scan mode saves its setting and consumes one display unit with %s",
  async (confirmation) => {
    const { writes, sounds } = mount("/consume");
    await userEvent.click(await screen.findByRole("button", { name: "Scan mode off" }));
    await screen.findByRole("button", { name: "Scan mode on" });
    const picker = screen.getByLabelText("Product");
    await userEvent.type(picker, confirmation === "Enter" ? "Coffee" : "Cof");
    expect(writes).toEqual([
      {
        path: "/api/user/settings/scan_mode_consume_enabled",
        body: { value: true },
      },
    ]);
    expect(sounds).toEqual(["/uisounds/silence.mp3"]);

    if (confirmation === "Enter") fireEvent.keyDown(picker, { key: "Enter" });
    else
      fireEvent(
        picker,
        createEvent("input", picker, { bubbles: true, target: { value: "Coffee" } }),
      );
    await screen.findByText("Removed 8 Pieces of Coffee from stock");
    expect(
      writes.filter((row) => row.path.endsWith("/consume")).map((row) => row.body.amount),
    ).toEqual(["8."]);
    expect(sounds).toEqual([
      "/uisounds/silence.mp3",
      ...(confirmation === "browser list" ? ["/uisounds/barcodescannerbeep.mp3"] : []),
      "/uisounds/barcodescannerbeep.mp3",
      "/uisounds/success.mp3",
    ]);
  },
);

test.each([{ locations: [1] }, { locations: [1, 2] }, { locations: [1, 3, 2] }])(
  "scan mode books the scanned stock item from the first location reply in $locations",
  async ({ locations }) => {
    const { writes, sounds } = mount("/consume", {
      scan: true,
      singleUnit: true,
      stockLocations: locations,
    });

    await choose("grcy:p:7:shelf-stock");
    await screen.findByText("Removed 1 Piece of Coffee from stock");
    expect(writes.filter((row) => row.path.endsWith("/consume"))).toEqual([
      {
        path: "/api/stock/products/7/consume",
        body: {
          amount: "1.",
          allow_subproduct_substitution: true,
          stock_entry_id: "shelf-stock",
          exact_amount: false,
          spoiled: false,
          location_id: "1",
        },
      },
    ]);
    expect(sounds).toEqual([
      "/uisounds/barcodescannerbeep.mp3",
      "/uisounds/barcodescannerbeep.mp3",
      "/uisounds/success.mp3",
    ]);
  },
);

test("scan mode remains active after its setting cannot be saved", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { writes, sounds } = mount("/consume", { failScanSetting: true, singleUnit: true });
  await userEvent.click(await screen.findByRole("button", { name: "Scan mode off" }));
  const toggle = await screen.findByRole<HTMLButtonElement>("button", { name: "Scan mode on" });
  expect(toggle.disabled).toBe(false);
  await choose("grcy:p:7:shelf-stock");
  await screen.findByText("Removed 1 Piece of Coffee from stock");
  expect(writes[0]).toEqual({
    path: "/api/user/settings/scan_mode_consume_enabled",
    body: { value: true },
  });
  expect(writes.find((row) => row.path.endsWith("/consume"))?.body.stock_entry_id).toBe(
    "shelf-stock",
  );
  expect(sounds).toEqual([
    "/uisounds/silence.mp3",
    "/uisounds/barcodescannerbeep.mp3",
    "/uisounds/barcodescannerbeep.mp3",
    "/uisounds/success.mp3",
  ]);
});

test("scan mode can stop while a booking reply is pending and suppress its success sound", async () => {
  const { writes, sounds, releaseBooking } = mount("/consume", { scan: true, delayBooking: true });
  const picker = await screen.findByLabelText("Product");
  fireEvent.change(picker, { target: { value: "COFFEE-2" } });
  fireEvent.keyDown(picker, { key: "Enter" });
  await waitFor(() => expect(writes.some((row) => row.path.endsWith("/consume"))).toBe(true));
  const toggle = screen.getByRole<HTMLButtonElement>("button", { name: "Scan mode on" });
  expect(toggle.disabled).toBe(false);
  await userEvent.click(toggle);
  await screen.findByRole("button", { name: "Scan mode off" });
  releaseBooking();
  await screen.findByText("Removed 2 Pieces of Coffee from stock");
  expect(sounds).toEqual(["/uisounds/barcodescannerbeep.mp3", "/uisounds/barcodescannerbeep.mp3"]);
  expect(writes.find((row) => row.path.endsWith("/scan_mode_consume_enabled"))?.body).toEqual({
    value: false,
  });
});

test("an invalid scan sounds an error and a corrected manual amount can be consumed", async () => {
  const { entries, writes, sounds } = mount("/consume", {
    scan: true,
    singleUnit: true,
    stockLocations: [1],
  });

  entries[0]!.amount = 0.25;
  const amount = await choose("grcy:p:7:shelf-stock");
  await screen.findByText(
    "Scan mode is on but not all required fields could be populated automatically",
  );
  expect(writes).toEqual([]);
  expect(sounds).toEqual([
    "/uisounds/barcodescannerbeep.mp3",
    "/uisounds/barcodescannerbeep.mp3",
    "/uisounds/error.mp3",
  ]);
  fireEvent.change(amount, { target: { value: "0.1" } });
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Removed 0.1 Pieces of Coffee from stock");
  expect(writes[0]?.body.amount).toBe("0.1");
  expect(sounds.at(-1)).toBe("/uisounds/success.mp3");
});

test("embedded scan mode stays off while quick consume amounts use the selected factor", async () => {
  const { writes, sounds } = mount("/consume?embedded&product=7", { scan: true, quick: true });
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.disabled).toBe(false));
  expect(amount.value).toBe("0.5");
  expect(screen.queryByRole("button", { name: /Scan mode/ })).toBeNull();
  expect(writes).toEqual([]);
  expect(sounds).toEqual([]);
});

test("barcode amounts survive scan mode and stock codes choose their entry location", async () => {
  const { writes, sounds } = mount("/consume", { scan: true });
  await choose("COFFEE-2");
  await screen.findByText("Removed 2 Pieces of Coffee from stock");
  expect(writes[0]?.body.amount).toBe("2.");
  expect(sounds).toEqual([
    "/uisounds/barcodescannerbeep.mp3",
    "/uisounds/barcodescannerbeep.mp3",
    "/uisounds/success.mp3",
  ]);
  await userEvent.click(screen.getByRole("button", { name: "Scan mode on" }));
  await screen.findByRole("button", { name: "Scan mode off" });
  const amount = await choose("grcy:p:7:shelf-stock");
  expect(amount.value).toBe("4");
  expect(screen.getByLabelText<HTMLSelectElement>("Location").value).toBe("1");
  expect(screen.getByLabelText<HTMLSelectElement>("Specific stock item").value).toBe("shelf-stock");
  await userEvent.click(screen.getByLabelText("Use a specific stock item"));
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
    const { sounds } = mount("/consume");
    const amount = await choose();
    fireEvent.change(screen.getByLabelText("Quantity unit"), { target: { value: "1" } });
    fireEvent.change(amount, { target: { value: "2" } });
    const facts = () => screen.getByText("Stock amount").nextElementSibling!.textContent;
    await waitFor(() => expect(facts()).toBe("10 Pieces 2 opened"));

    if (action === "open") {
      await userEvent.click(screen.getByRole("button", { name: "Scan mode off" }));
      await screen.findByRole("button", { name: "Scan mode on" });
    }

    await userEvent.click(
      screen.getByRole("button", { name: action === "open" ? "Mark as opened" : "OK" }),
    );
    await screen.findByText(
      action === "open"
        ? "Marked 2 Pieces of Coffee as opened"
        : "Removed 2 Pieces of Coffee from stock",
    );
    expect(sounds).toEqual(action === "open" ? ["/uisounds/silence.mp3"] : []);
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe(""));
    const retained = action === "open" ? "10 Pieces 2 opened" : "8 Pieces 2 opened";
    await waitFor(() => expect(facts()).toBe(retained));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).toBeNull());
    expect(facts()).toBe(retained);

    if (action === "open") {
      await userEvent.click(screen.getByRole("button", { name: "Scan mode on" }));
      await screen.findByRole("button", { name: "Scan mode off" });
    }

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
