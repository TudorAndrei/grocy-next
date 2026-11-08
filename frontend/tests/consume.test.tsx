import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

beforeEach(() => {
  supportDialogs();
  vi.stubGlobal("scrollTo", () => {});
});

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
    barcodeResponse,
    firstEntriesResponse,
    defaultAmount = 0.5,
    quickAmount = 4,
    barcodeAmount = 0.25,
    barcodeUnit = 3,
    barcodeRead,
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
    barcodeResponse?: Promise<Response>;
    firstEntriesResponse?: Promise<Response>;
    defaultAmount?: number;
    quickAmount?: number;
    barcodeAmount?: number;
    barcodeUnit?: number;
    barcodeRead?: Promise<Response>;
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
  let committed = 0;
  let pendingDetails: Promise<Response> | undefined;
  let pendingBooking: Promise<Response> | undefined;
  let refreshDetails: Promise<Response> | undefined;
  let refreshReads = 0;
  const detailSignals: (AbortSignal | null | undefined)[] = [];
  const bookingSignals: (AbortSignal | null | undefined)[] = [];
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

  function detailsResponse(id = 7) {
    const tare = id === 8;
    const parent = id === 9;

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
        quick_consume_amount: quickAmount,
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

      if (path.endsWith("/objects/product_barcodes") && barcodeResponse)
        return await barcodeResponse;

      if (path.endsWith("/objects/product_barcodes") && failBarcode)
        return Response.json({ error_message: "Barcode unavailable" }, { status: 400 });

      if (path.endsWith("/consume") || path.endsWith("/open")) {
        bookingSignals.push(init.signal);

        if (failSave && ++bookings === 1)
          return Response.json({ error_message: "Booking unavailable" }, { status: 503 });

        if (path.endsWith("/7/consume") || path.endsWith("/7/open")) {
          previousStock = { ...stock };

          if (path.endsWith("/consume")) stock.amount -= Number(body.amount);
          else stock.opened += Number(body.amount);
        }

        committed++;

        const held = pendingBooking;
        pendingBooking = undefined;

        if (held) await held;

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

    if (path.endsWith("/api/v2/localization"))
      return Response.json({
        locale: "en",
        direction: "ltr",
        languages: ["en"],
        catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
      });

    if (path.endsWith("/api/v2/user/permissions"))
      return Response.json({ STOCK_OPEN: openPermission });

    if (path.endsWith("/api/user/settings"))
      return Response.json({
        stock_decimal_places_amounts: 2,
        stock_default_consume_amount: defaultAmount,
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
      detailSignals.push(init?.signal);
      const pending = pendingDetails;
      pendingDetails = undefined;

      if (pending) return await pending;

      if (refreshDetails && committed > 0) {
        refreshReads++;

        return await refreshDetails;
      }

      return detailsResponse(path.endsWith("/8") ? 8 : path.endsWith("/9") ? 9 : 7);
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
      entryReads++;

      if (firstEntriesResponse && entryReads === 1) return await firstEntriesResponse;

      if (failEntries && entryReads === 1)
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
    ) {
      if (barcodeRead && url.search.includes("COFFEE-2")) return barcodeRead;

      return Response.json(
        url.search.includes("COFFEE-2") ? [{ amount: barcodeAmount, qu_id: barcodeUnit }] : [],
      );
    }

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
    client,
    view,
    stock: () => ({ ...stock }),
    detailSignals,
    bookingSignals,
    detailsResponse,
    entryReads: () => entryReads,
    holdBooking: (reply: Promise<Response>) => {
      pendingBooking = reply;
    },
    holdDetails: (reply: Promise<Response>) => {
      pendingDetails = reply;
    },
    holdRefresh: (reply: Promise<Response>) => {
      refreshDetails = reply;
    },
    refreshReads: () => refreshReads,
  };
}

async function choose(name = "Coffee") {
  const picker = await screen.findByLabelText<HTMLInputElement>("Product");

  if (picker.value === name) fireEvent.change(picker, { target: { value: "" } });
  fireEvent.change(picker, { target: { value: name } });

  if (name.startsWith("grcy:") || name.startsWith("COFFEE-"))
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
  await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>("Location").value).toBe("2"));
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Use a specific stock item").checked).toBe(true),
  );
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
  await waitFor(() =>
    expect([...entry.options].filter((row) => row.value === "pantry-stock")).toHaveLength(2),
  );
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
  await screen.findByRole("option", { name: /Amount: 6; Due on 2026-11-03/ });
  await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>("Location").value).toBe("2"));
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
  expect(screen.getByText("Moved to Pantry").closest(".toast")?.getAttribute("data-tone")).toBe(
    "info",
  );
});

test("a failed booking enables native input controls until their own handlers change them", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const { writes } = mount("/consume", { singleUnit: true, failSave: true });
  await choose();
  const unit = screen.getByLabelText<HTMLSelectElement>("Quantity unit");
  const stockItem = screen.getByLabelText<HTMLSelectElement>("Specific stock item");
  expect(unit.disabled).toBe(true);
  expect(stockItem.disabled).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByRole("button", {
    name: /Error while saving, probably this item already exists/,
  });
  await waitFor(() => expect(logged).toHaveBeenCalledOnce());
  expect(
    within(screen.getByRole("form", { name: "Consume" })).queryByText("Booking unavailable"),
  ).toBeNull();
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

test("selection and booking failures log, preserve the draft and permit new attempts without an extra booking", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount("/consume", { failRead: true, failSave: true });
  const picker = await screen.findByLabelText<HTMLInputElement>("Product");
  fireEvent.change(picker, { target: { value: "Coffee" } });
  await waitFor(() => expect(logged).toHaveBeenCalledOnce());
  expect(screen.queryByText("Details unavailable")).toBeNull();
  expect(picker.value).toBe("Coffee");
  expect(
    within(screen.getByRole("form", { name: "Consume" })).queryByRole("button", { name: "Retry" }),
  ).toBeNull();
  await userEvent.clear(picker);
  await userEvent.type(picker, "Coffee");
  fireEvent.keyDown(picker, { key: "Enter" });
  await screen.findByRole("option", { name: /Amount: 6; Due on 2026-11-03/ });
  const amount = screen.getByLabelText<HTMLInputElement>("Amount");
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(false),
  );
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByRole("button", {
    name: /Error while saving, probably this item already exists/,
  });
  await waitFor(() => expect(logged).toHaveBeenCalledTimes(2));
  expect(
    within(screen.getByRole("form", { name: "Consume" })).queryByText("Booking unavailable"),
  ).toBeNull();
  expect(amount.value).toBe("0.5");
  expect(amount.disabled).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Removed 4 Pieces of Coffee from stock");
  expect(app.writes.filter((row) => row.path.endsWith("/consume"))).toHaveLength(2);
});

test("an entry read failure only logs and a new selection retries while hidden tracking controls leave the booking body unchanged", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});

  const app = mount("/consume?embedded&product=7", {
    tracking: false,
    failEntries: true,
    openPermission: false,
  });

  await waitFor(() => expect(logged).toHaveBeenCalledOnce());
  expect(screen.queryByText("Entries unavailable")).toBeNull();
  expect(
    within(screen.getByRole("form", { name: "Consume" })).queryByRole("button", { name: "Retry" }),
  ).toBeNull();
  const picker = screen.getByLabelText<HTMLInputElement>("Product");
  expect(picker.value).toBe("Coffee");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Amount")));
  // Finish the initial selection's queued focus work before starting the retry.
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  await userEvent.clear(picker);
  await userEvent.type(picker, "Coffee");
  fireEvent.keyDown(picker, { key: "Enter" });
  await screen.findByRole("option", { name: /Amount: 6; Due on 2026-11-03/ });
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(false),
  );
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Mark as opened" }).disabled).toBe(
    true,
  );
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Removed 4 Pieces of Coffee from stock");
  expect(app.writes[0]?.body).toEqual({
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
  const refresh = heldConsumeResponse();

  const app = mount(
    "/consume?flow=InplaceAddBarcodeToExistingProduct&barcode=NEW-CODE&product-name=Coffee&locationId=2",
    { failBarcode: true },
  );

  await choose();
  app.holdRefresh(refresh.promise);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Removed 4 Pieces of Coffee from stock");
  await screen.findByRole("button", {
    name: /Error while saving, probably this item already exists/,
  });
  await waitFor(() => expect(app.refreshReads()).toBeGreaterThan(0));
  expect(app.writes[1]).toEqual({
    path: "/api/objects/product_barcodes",
    body: { barcode: "NEW-CODE", product_id: "7" },
  });
  await waitFor(() => expect(app.router.state.location.search).toEqual({ locationId: "2" }));
  const product = screen.getByLabelText<HTMLInputElement>("Product");
  expect(product.value).toBe("");
  expect(product.matches(":disabled")).toBe(false);
  await userEvent.type(product, "Next draft");
  await releaseConsume(refresh, app.detailsResponse());
  expect(product.value).toBe("Next draft");
});

function heldConsumeResponse() {
  let resolve = (_response: Response) => {};

  const promise = new Promise<Response>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

async function releaseConsume(gate: ReturnType<typeof heldConsumeResponse>, response: Response) {
  await act(async () => {
    gate.resolve(response);
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
  });
}

async function readyConsume() {
  const amount = await choose();
  await waitFor(() => expect(document.activeElement).toBe(amount));

  return amount;
}

test.each(["consume", "open"] as const)(
  "a fresh %s details failure only logs and unlocks the preserved draft",
  async (action) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = mount("/consume");
    const amount = await readyConsume();
    app.holdDetails(
      Promise.resolve(Response.json({ error_message: "Save details rejected" }, { status: 503 })),
    );
    await userEvent.click(
      screen.getByRole("button", { name: action === "open" ? "Mark as opened" : "OK" }),
    );
    await waitFor(() => expect(logged).toHaveBeenCalledOnce());
    expect(screen.queryByText("Save details rejected")).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: /Error while saving, probably this item already exists/,
      }),
    ).toBeNull();
    expect(amount.matches(":disabled")).toBe(false);
    expect(amount.value).toBe("0.5");
    expect(app.writes).toEqual([]);
    await userEvent.click(
      screen.getByRole("button", { name: action === "open" ? "Mark as opened" : "OK" }),
    );
    await screen.findByText(
      action === "open"
        ? "Marked 4 Pieces of Coffee as opened"
        : "Removed 4 Pieces of Coffee from stock",
    );
    expect(app.writes.filter((row) => row.path.endsWith(`/${action}`))).toHaveLength(1);
  },
);

test("an Open POST failure only logs, restores native controls and permits retry without losing recipe or location", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount("/consume?embedded&product=7", { failSave: true });
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  fireEvent.change(screen.getByLabelText("Recipe"), { target: { value: "grcy:r:4" } });
  fireEvent.blur(screen.getByLabelText("Recipe"));
  await userEvent.click(screen.getByRole("button", { name: "Mark as opened" }));
  await waitFor(() => expect(logged).toHaveBeenCalledOnce());
  expect(screen.queryByText("Booking unavailable")).toBeNull();
  expect(
    screen.queryByRole("button", { name: /Error while saving, probably this item already exists/ }),
  ).toBeNull();
  expect(amount.matches(":disabled")).toBe(false);
  expect(screen.getByLabelText<HTMLInputElement>("Recipe").value).toBe("Coffee cake");
  expect(screen.getByLabelText<HTMLSelectElement>("Location").value).toBe("2");
  await userEvent.click(screen.getByRole("button", { name: "Mark as opened" }));
  await screen.findByText("Marked 4 Pieces of Coffee as opened");
  expect(app.writes.filter((row) => row.path.endsWith("/open"))).toHaveLength(2);
  expect(screen.getByLabelText<HTMLInputElement>("Recipe").value).toBe("Coffee cake");
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("3");
  expect(screen.getByLabelText<HTMLSelectElement>("Location").value).toBe("2");
  expect(screen.queryByRole("heading", { name: "About" })).toBeNull();
});

test.each([
  { action: "consume", retirement: "departure" },
  { action: "open", retirement: "unmount" },
] as const)(
  "a held $action save-details read cannot dispatch a stock write after $retirement",
  async ({ action, retirement }) => {
    const details = heldConsumeResponse();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = mount("/consume");
    await readyConsume();
    const initialReads = app.detailSignals.length;
    app.holdDetails(details.promise);
    await userEvent.click(
      screen.getByRole("button", { name: action === "open" ? "Mark as opened" : "OK" }),
    );
    await waitFor(() => expect(app.detailSignals).toHaveLength(initialReads + 1));
    const signal = app.detailSignals.at(-1);

    if (retirement === "unmount") app.view.unmount();
    else
      await act(async () => {
        await app.router.navigate({ to: "/about" });
      });
    await releaseConsume(details, app.detailsResponse());
    expect(app.writes).toEqual([]);
    expect(logged).not.toHaveBeenCalled();
    expect(screen.queryByText(/Removed .* from stock|Marked .* as opened/)).toBeNull();
    expect(signal?.aborted).toBe(true);
  },
);

test.each(["consume", "open"] as const)(
  "a committed held %s POST only invalidates caches after document retirement",
  async (action) => {
    const parent = vi.fn();
    vi.stubGlobal("parent", { postMessage: parent });
    vi.spyOn(window, "postMessage").mockImplementation(() => {});
    const app = mount("/consume?embedded&product=7", { delayBooking: true });
    const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
    await waitFor(() => expect(document.activeElement).toBe(amount));
    await userEvent.click(
      screen.getByRole("button", { name: action === "open" ? "Mark as opened" : "OK" }),
    );
    await waitFor(() =>
      expect(app.writes.filter((row) => row.path.endsWith(`/${action}`))).toHaveLength(1),
    );
    expect(app.stock()).toEqual(
      action === "consume" ? { amount: 6, opened: 2 } : { amount: 10, opened: 6 },
    );
    await act(async () => {
      await app.router.navigate({ to: "/about" });
    });

    const keys = [
      ["stock", "new-document"],
      ["products"],
      ["recipe-fulfillment"],
      ["shopping", 50],
      ["mealplan-calendar"],
      ["product-overview", 7],
    ];

    for (const key of keys) app.client.setQueryData(key, { fresh: true });
    const readsAfterDeparture = app.reads.length;
    await act(async () => {
      app.releaseBooking();
      await new Promise<void>((resolve) => notifyManager.schedule(resolve));
    });
    expect(
      parent.mock.calls.filter(([bag]) =>
        ["BroadcastMessage", "ShowSuccessMessage", "CloseLastModal"].includes(bag.Message),
      ),
    ).toEqual([]);
    expect(screen.queryByText(/Removed .* from stock|Marked .* as opened/)).toBeNull();
    expect(app.reads.length).toBe(readsAfterDeparture);

    for (const key of keys) {
      const state = app.client.getQueryState(key);
      expect(!state || state.isInvalidated).toBe(true);
    }

    expect(app.bookingSignals[0]?.aborted).toBe(true);
  },
);

test("an older barcode failure can unlock a pending Open whose wire body follows the latest Open click while its receipt retains the earlier amount", async () => {
  const barcode = heldConsumeResponse();
  const earlierOpen = heldConsumeResponse();

  const app = mount(
    "/consume?flow=InplaceAddBarcodeToExistingProduct&barcode=NEW-CODE&product-name=Coffee",
    { barcodeResponse: barcode.promise },
  );

  await readyConsume();
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Removed 4 Pieces of Coffee from stock");
  const amount = await readyConsume();
  await userEvent.selectOptions(screen.getByLabelText("Quantity unit"), "1");
  await userEvent.clear(amount);
  await userEvent.type(amount, "1");
  const details = app.detailsResponse();
  const reads = app.detailSignals.length;
  app.holdDetails(earlierOpen.promise);
  await userEvent.click(screen.getByRole("button", { name: "Mark as opened" }));
  await waitFor(() => expect(app.detailSignals).toHaveLength(reads + 1));
  expect(amount.matches(":disabled")).toBe(true);
  await releaseConsume(
    barcode,
    Response.json({ error_message: "Older barcode failed" }, { status: 409 }),
  );
  await screen.findByRole("button", {
    name: /Error while saving, probably this item already exists/,
  });
  await waitFor(() => expect(amount.matches(":disabled")).toBe(false));
  await userEvent.clear(amount);
  await userEvent.type(amount, "2");
  await userEvent.click(screen.getByRole("button", { name: "Mark as opened" }));
  await screen.findByText("Marked 2 Pieces of Coffee as opened");
  await releaseConsume(earlierOpen, details);
  await screen.findByText("Marked 1 Piece of Coffee as opened");
  expect(app.writes.filter((row) => row.path.endsWith("/open")).map((row) => row.body)).toEqual([
    { amount: "2.", allow_subproduct_substitution: true },
    { amount: "2.", allow_subproduct_substitution: true },
  ]);
  expect(app.stock()).toEqual({ amount: 6, opened: 6 });
});

test("a delayed initial embedded location read appends its options and sum after the product default location, then applies the forced stock checkbox", async () => {
  const initialEntries = heldConsumeResponse();

  const app = mount("/consume?embedded&product=7&locationId=1&stockId=shelf-stock", {
    firstEntriesResponse: initialEntries.promise,
  });

  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(app.entryReads()).toBeGreaterThanOrEqual(2));
  const location = screen.getByLabelText<HTMLSelectElement>("Location");
  const entry = screen.getByLabelText<HTMLSelectElement>("Specific stock item");
  await waitFor(() =>
    expect([...entry.options].map((option) => option.value)).toEqual([
      "",
      "pantry-stock",
      "opened-stock",
    ]),
  );
  expect(location.value).toBe("2");
  expect(amount.max).toBe("1.00");
  expect(screen.getByLabelText<HTMLInputElement>("Use a specific stock item").checked).toBe(false);
  await releaseConsume(initialEntries, Response.json(app.entries));
  await waitFor(() =>
    expect([...entry.options].map((option) => option.value)).toEqual([
      "",
      "pantry-stock",
      "opened-stock",
      "shelf-stock",
    ]),
  );
  await waitFor(() => expect(amount.max).toBe("1.50"));
  expect(location.value).toBe("2");
  expect(screen.getByLabelText<HTMLInputElement>("Use a specific stock item").checked).toBe(true);
  expect(entry.disabled).toBe(false);
  expect(entry.value).toBe("shelf-stock");
  expect(app.writes).toEqual([]);
});

test("Consume sends its captured stock body even when live controls change during the fresh details request", async () => {
  const details = heldConsumeResponse();
  const app = mount("/consume");
  const amount = await readyConsume();
  fireEvent.change(screen.getByLabelText("Recipe"), { target: { value: "grcy:r:4" } });
  fireEvent.blur(screen.getByLabelText("Recipe"));
  await userEvent.click(screen.getByLabelText("Use a specific stock item"));
  await userEvent.selectOptions(screen.getByLabelText("Specific stock item"), "pantry-stock");
  app.holdDetails(details.promise);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(amount.matches(":disabled")).toBe(true);
  // External changes do not alter the native JSON captured when Save was clicked.
  fireEvent.change(amount, { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Quantity unit"), { target: { value: "1" } });
  fireEvent.click(screen.getByLabelText("Spoiled"));
  fireEvent.change(screen.getByLabelText("Recipe"), { target: { value: "" } });
  fireEvent.blur(screen.getByLabelText("Recipe"));
  fireEvent.change(screen.getByLabelText("Location"), { target: { value: "1" } });
  await releaseConsume(details, app.detailsResponse());
  await screen.findByText("Removed 4 Pieces of Coffee from stock");
  expect(app.writes.find((row) => row.path.endsWith("/consume"))?.body).toEqual({
    amount: "4.",
    allow_subproduct_substitution: true,
    exact_amount: false,
    spoiled: false,
    recipe_id: "4",
    location_id: "2",
    stock_entry_id: "pantry-stock",
  });
});

test.each([
  {
    description: "first literal flow and bare barcode",
    query: "?flow=InplaceAddBarcodeToExistingProduct&flow=wrong&barcode&barcode=SECOND&embedded",
    barcode: true,
    embedded: true,
  },
  {
    description: "literal plus and ignored raw extra equals",
    query: "?flow=InplaceAddBarcodeToExistingProduct=ignored&barcode=FIRST+RAW=ignored&embedded",
    barcode: "FIRST+RAW",
    embedded: true,
  },
  {
    description: "decoded equals inside the first barcode",
    query: "?flow=InplaceAddBarcodeToExistingProduct&barcode=FIRST%3Dkept&embedded",
    barcode: "FIRST=kept",
    embedded: true,
  },
  {
    description: "encoded parameter names are not literal JavaScript flags",
    query: "?%66low=InplaceAddBarcodeToExistingProduct&barcode=IGNORED&%65mbedded",
    barcode: undefined,
    embedded: false,
  },
])(
  "Consume POST completion reads $description from the live raw URI",
  async ({ query, barcode: expectedBarcode, embedded }) => {
    const barcode = heldConsumeResponse();

    const host = {
      IsGrocy: true,
      postMessage: vi.fn(),
      get parent() {
        return this;
      },
    };

    vi.stubGlobal("parent", host);
    const app = mount("/consume", { delayBooking: true, barcodeResponse: barcode.promise });
    const amount = await readyConsume();
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(app.writes.some((row) => row.path.endsWith("/consume"))).toBe(true));
    await act(async () => {
      app.router.history.replace(`/consume${query}`);
    });
    await act(async () => {
      app.releaseBooking();
      await new Promise<void>((resolve) => notifyManager.schedule(resolve));
    });

    if (embedded) {
      await waitFor(() =>
        expect(host.postMessage.mock.calls.some(([bag]) => bag.Message === "CloseLastModal")).toBe(
          true,
        ),
      );
      expect(screen.queryByText("Removed 4 Pieces of Coffee from stock")).toBeNull();
    } else {
      await screen.findByText("Removed 4 Pieces of Coffee from stock");
      expect(host.postMessage.mock.calls.some(([bag]) => bag.Message === "CloseLastModal")).toBe(
        false,
      );
    }

    const assignments = app.writes.filter((row) => row.path.endsWith("/objects/product_barcodes"));

    if (expectedBarcode === undefined) expect(assignments).toEqual([]);
    else {
      expect(assignments).toEqual([
        {
          path: "/api/objects/product_barcodes",
          body: { barcode: expectedBarcode, product_id: "7" },
        },
      ]);
      await releaseConsume(barcode, Response.json({}));
      await waitFor(() => expect(app.router.history.location.search).toBe(""));
      expect(app.router.history.location.pathname).toBe("/consume");
      expect(screen.getByLabelText("Amount")).toBe(amount);
    }
  },
);

test("an older barcode success replaces the URI while a later Consume POST is pending and changes that completion's live embedded branch", async () => {
  const barcode = heldConsumeResponse();
  const laterBooking = heldConsumeResponse();

  const host = {
    IsGrocy: true,
    postMessage: vi.fn(),
    get parent() {
      return this;
    },
  };

  vi.stubGlobal("parent", host);

  const app = mount("/consume?flow=InplaceAddBarcodeToExistingProduct&barcode=OLD-CODE", {
    barcodeResponse: barcode.promise,
  });

  await readyConsume();
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Removed 4 Pieces of Coffee from stock");
  const amount = await readyConsume();
  app.holdBooking(laterBooking.promise);
  await act(async () => {
    app.router.history.replace("/consume?embedded&keep=later");
  });
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(app.writes.filter((row) => row.path.endsWith("/consume"))).toHaveLength(2),
  );
  await releaseConsume(barcode, Response.json({}));
  await waitFor(() => expect(app.router.history.location.search).toBe(""));
  expect(screen.getByLabelText("Amount")).toBe(amount);
  await releaseConsume(laterBooking, Response.json({}));
  await waitFor(() =>
    expect(screen.getAllByText("Removed 4 Pieces of Coffee from stock")).toHaveLength(2),
  );
  expect(host.postMessage.mock.calls.some(([bag]) => bag.Message === "CloseLastModal")).toBe(false);
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("");
  expect(app.writes.filter((row) => row.path.endsWith("/objects/product_barcodes"))).toHaveLength(
    1,
  );
  expect(app.router.history.location.pathname).toBe("/consume");
});

test("an older different-product response publishes its units and captured locations while those location callbacks read the current picker product", async () => {
  const earlier = heldConsumeResponse();
  const app = mount("/consume");
  const picker = await screen.findByLabelText<HTMLInputElement>("Product");
  const reads = app.detailSignals.length;
  app.holdDetails(earlier.promise);
  fireEvent.change(picker, { target: { value: "Coffee" } });
  await waitFor(() => expect(app.detailSignals.length).toBeGreaterThan(reads));
  const earlierSignal = app.detailSignals[reads];
  fireEvent.change(picker, { target: { value: "Tare coffee" } });
  const amount = screen.getByLabelText<HTMLInputElement>("Amount");
  const unit = screen.getByLabelText<HTMLSelectElement>("Quantity unit");
  await waitFor(() => expect(unit.value).toBe("1"));
  await screen.findByRole("option", { name: /Amount: 6; Due on 2026-11-03/ });
  await waitFor(() => expect(amount.min).toBe("3"));
  const beforeLateReply = app.reads.length;
  await releaseConsume(earlier, app.detailsResponse(7));
  await waitFor(() => expect(unit.value).toBe("3"));
  await waitFor(() =>
    expect(app.reads.slice(beforeLateReply)).toContain(
      "/api/stock/products/8/entries?include_sub_products=true",
    ),
  );
  await waitFor(() => expect(amount.min).toBe("3"));
  const laterReads = app.reads.slice(beforeLateReply);
  expect(laterReads).toContain("/api/stock/products/7/locations?include_sub_products=true");
  expect(laterReads).toContain("/api/stock/products/8");
  expect(laterReads).not.toContain("/api/stock/products/7/entries?include_sub_products=true");
  expect(picker.value).toBe("Tare coffee");
  expect(unit.selectedOptions[0]?.textContent).toBe("Saved box");
  expect(earlierSignal?.aborted).toBe(false);
  expect(app.writes).toEqual([]);
});

test.each(["consume", "open"] as const)(
  "%s normalizes a saved default at selection and reset, while initial markup and typed amounts stay raw",
  async (operation) => {
    const app = mount("/consume", { defaultAmount: 0.5555 });
    const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
    expect(amount.value).toBe("0.5555");
    expect(amount.validity.stepMismatch).toBe(true);
    await readyConsume();
    await waitFor(() => expect(amount.value).toBe("0.56"));
    expect(amount.validity.stepMismatch).toBe(false);
    expect(
      amount.closest("form")?.querySelector<HTMLInputElement>('input[name="amount"]')?.value,
    ).toBe("4.48");
    fireEvent.change(amount, { target: { value: "0.5555" } });
    expect(amount.value).toBe("0.5555");
    expect(amount.validity.stepMismatch).toBe(true);
    fireEvent.change(amount, { target: { value: "0.56" } });
    await userEvent.click(
      screen.getByRole("button", { name: operation === "open" ? "Mark as opened" : "OK" }),
    );
    await waitFor(() =>
      expect(app.writes.filter((row) => row.path.endsWith(`/${operation}`))).toHaveLength(1),
    );
    expect(app.writes.find((row) => row.path.endsWith(`/${operation}`))?.body.amount).toBe("4.48");
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe(""));
    expect(amount.value).toBe("0.56");
  },
);

test("quick consume normalizes the product amount multiplied by its unit factor before conversion and Open reset", async () => {
  const app = mount("/consume", { quick: true, quickAmount: 4.4444 });
  const amount = await readyConsume();
  await waitFor(() => expect(amount.value).toBe("0.56"));
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("3");
  expect(amount.validity.stepMismatch).toBe(false);
  expect(
    amount.closest("form")?.querySelector<HTMLInputElement>('input[name="amount"]')?.value,
  ).toBe("4.48");
  await userEvent.click(screen.getByRole("button", { name: "Mark as opened" }));
  await screen.findByText("Marked 4.48 Pieces of Coffee as opened");
  expect(app.writes.find((row) => row.path.endsWith("/open"))?.body.amount).toBe("4.48");
  expect(amount.value).toBe("0.56");
});

test.each([false, true])(
  "barcode locale refresh preserves the earlier converted wire amount (scan=%s)",
  async (scan) => {
    const lookup = heldConsumeResponse();

    const app = mount("/consume", {
      scan,
      barcodeAmount: scan ? 2.675 : 0.5555,
      barcodeUnit: scan ? 1 : 3,
      barcodeRead: scan ? undefined : lookup.promise,
    });

    const amount = await choose("COFFEE-2");

    if (!scan) {
      await waitFor(() => expect(document.activeElement).toBe(amount));
      await releaseConsume(lookup, Response.json([{ amount: 0.5555, qu_id: 3 }]));
      await waitFor(() => expect(amount.value).toBe("0.56"));
      await waitFor(() =>
        expect(screen.getByLabelText<HTMLSelectElement>("Location").value).toBe("2"),
      );
      expect(amount.validity.stepMismatch).toBe(false);
      expect(
        amount.closest("form")?.querySelector<HTMLInputElement>('input[name="amount"]')?.value,
      ).toBe("4.44");
      await userEvent.click(screen.getByRole("button", { name: "OK" }));
    }

    const expected = scan ? "2.67" : "4.44";
    await screen.findByText(`Removed ${expected} Pieces of Coffee from stock`);
    expect(app.writes.filter((row) => row.path.endsWith("/consume"))).toHaveLength(1);
    expect(app.writes.find((row) => row.path.endsWith("/consume"))?.body.amount).toBe(expected);
  },
);

test.each(["new product", "held barcode", "open retains flow"] as const)(
  "unknown product actions follow live flow after %s",
  async (mode) => {
    const barcode = heldConsumeResponse();

    const flow =
      mode === "held barcode" ? "InplaceAddBarcodeToExistingProduct" : "InplaceNewProductWithName";

    const app = mount(`/consume?flow=${flow}&barcode=FIRST&product-name=Coffee`, {
      barcodeResponse: mode === "held barcode" ? barcode.promise : undefined,
    });

    await readyConsume();
    await userEvent.click(
      screen.getByRole("button", { name: mode === "open retains flow" ? "Mark as opened" : "OK" }),
    );
    await screen.findByText(
      mode === "open retains flow"
        ? "Marked 4 Pieces of Coffee as opened"
        : "Removed 4 Pieces of Coffee from stock",
    );
    const product = screen.getByLabelText<HTMLInputElement>("Product");
    await waitFor(() => expect(product.value).toBe(""));
    expect(app.router.history.location.search.includes("flow=")).toBe(mode === "open retains flow");
    fireEvent.change(product, { target: { value: "NEXT-UNKNOWN" } });
    fireEvent.keyDown(product, { key: "Enter" });

    if (mode === "open retains flow") {
      await act(async () => {
        await new Promise<void>((resolve) => notifyManager.schedule(resolve));
      });
      expect(
        screen.queryByRole("button", { name: /Add as barcode to existing product/ }),
      ).toBeNull();
      expect(app.reads.some((path) => path.includes("name%3DNEXT-UNKNOWN"))).toBe(false);
    } else await screen.findByRole("button", { name: /Add as barcode to existing product/ });
    expect(
      app.writes.filter((row) => row.path.endsWith("/consume") || row.path.endsWith("/open")),
    ).toHaveLength(1);

    if (mode === "held barcode") await releaseConsume(barcode, Response.json({}));
  },
);
