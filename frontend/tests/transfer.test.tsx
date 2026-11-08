import { overviewFixture } from "./fixtures/stock-overview";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    readFailure = false,
    saveFailure = false,
    transferAllowed = true,
    locations = true,
    barcodeReply,
    bookingReply,
    barcodeLookup,
    locationsReply,
    transferSettings = { stock_default_transfer_amount: 7 },
  }: {
    readFailure?: boolean;
    saveFailure?: boolean;
    transferAllowed?: boolean;
    locations?: boolean;
    barcodeReply?: (index: number) => Response | Promise<Response>;
    bookingReply?: (index: number) => Response | Promise<Response>;
    barcodeLookup?: Promise<Response>;
    locationsReply?: (product: string) => Response | Promise<Response>;
    transferSettings?: JsonObject;
  } = {},
) {
  const writes: { path: string; body: JsonObject }[] = [];
  let detailReads = 0;
  let saves = 0;
  let barcodes = 0;
  let heldDetails: Promise<Response> | undefined;
  let heldEntries: Promise<Response> | undefined;
  let entryReads = 0;
  const signals: (AbortSignal | null | undefined)[] = [];
  let locationReads = 0;
  let barcodeReads = 0;

  const catalog = {
    barcode_lookup_plugin_name: "Demo",
    products: [
      { id: 7, name: "Coffee" },
      { id: 8, name: "Tare jar" },
      { id: 9, name: "Tea" },
    ],
    locations: [
      { id: 2, name: "Freezer", is_freezer: 1 },
      { id: 3, name: "Pantry", is_freezer: 0 },
    ],
    units: [{ id: 1, name: "Piece", name_plural: "Pieces" }],
    barcodes: [{ product_id: 7, barcodes: "COFFEE-2" }],
    conversions: [
      {
        product_id: 9,
        from_qu_id: 1,
        to_qu_id: 1,
        factor: "1",
        to_qu_name: "Piece",
        to_qu_name_plural: "Pieces",
      },
      {
        product_id: 9,
        from_qu_id: 1,
        to_qu_id: 4,
        factor: "0.25",
        to_qu_name: "Cup",
        to_qu_name_plural: "Cups",
      },
      {
        product_id: 7,
        from_qu_id: 3,
        to_qu_id: 1,
        factor: "7",
        to_qu_name: "Piece",
        to_qu_name_plural: "Pieces",
      },
      {
        product_id: 7,
        from_qu_id: 1,
        to_qu_id: 3,
        factor: "0.5",
        to_qu_name: "Saved box",
        to_qu_name_plural: "Saved boxes",
      },
      {
        product_id: null,
        from_qu_id: 1,
        to_qu_id: 3,
        factor: "6",
        to_qu_name: "Global box",
        to_qu_name_plural: null,
      },
    ],
  };

  const entries = [
    {
      stock_id: "mint",
      amount: 2,
      location_id: 1,
      best_before_date: "2027-01-01",
      purchased_date: "2026-10-01",
      open: 1,
      note: "First",
    },
    {
      stock_id: "mint",
      amount: 3,
      location_id: 1,
      best_before_date: "2027-01-01",
      purchased_date: "2026-10-01",
      open: 0,
      note: "Second",
    },
    {
      stock_id: "other",
      amount: 4,
      location_id: 2,
      best_before_date: "2999-12-31",
      purchased_date: "2026-10-02",
      open: 0,
      note: null,
    },
  ];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname;

      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}"));
        writes.push({ path, body });

        if (path.endsWith("/objects/product_barcodes")) {
          signals.push(init.signal);
          const reply = barcodeReply?.(++barcodes);

          if (reply) return reply;
        }

        if (path.endsWith("/transfer")) {
          signals.push(init.signal);
          ++saves;

          if (saveFailure && saves === 1)
            return Response.json({ error_message: "Transfer unavailable" }, { status: 503 });
          const reply = bookingReply?.(saves);

          if (reply) return reply;
        }

        return path.endsWith("/transfer")
          ? Response.json([
              {
                id: 90,
                product_id: 7,
                amount: 3,
                transaction_id: "move-transaction",
                transaction_type: "transfer_from",
              },
            ])
          : Response.json({});
      }

      if (path.endsWith("/api/v2/system/about"))
        return Response.json({
          system_info: {
            grocy_version: { Version: "4.5.0", ReleaseDate: "2026-01-01" },
            php_version: "8.4",
            python_version: "3.13",
            sqlite_version: "3.48",
            db_version: 1,
            os: "Linux",
            client: "",
          },
          changelog: { newest_release_number: 1, changelog_items: [] },
        });

      if (path.endsWith("/api/v2/setup")) return Response.json({ needs_setup: false });

      if (path.endsWith("/api/user")) return Response.json([{ id: 1, username: "Owner" }]);

      if (path.endsWith("/api/v2/localization"))
        return Response.json({
          locale: "en",
          direction: "ltr",
          languages: ["en"],
          catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
        });

      if (path.endsWith("/api/user/settings"))
        return Response.json({ stock_decimal_places_amounts: 2, ...transferSettings });

      if (path.endsWith("/api/system/config"))
        return Response.json({
          FEATURE_FLAG_STOCK: true,
          FEATURE_FLAG_STOCK_LOCATION_TRACKING: locations,
          FEATURE_FLAG_STOCK_PRICE_TRACKING: false,
          FEATURE_FLAG_DISABLE_BROWSER_BARCODE_CAMERA_SCANNING: true,
        });

      if (path.endsWith("/api/v2/stock/transfer/editor")) return Response.json(catalog);

      if (path.endsWith("/api/v2/user/permissions"))
        return Response.json({ STOCK_TRANSFER: transferAllowed });

      if (path.endsWith("/api/objects/locations"))
        return Response.json([{ id: 2, name: "Freezer" }]);

      if (path.endsWith("/api/v2/stock/overview"))
        return Response.json(
          overviewFixture(
            [
              {
                product_id: 7,
                product: { id: 7, name: "Coffee", location_id: 2 },
                amount: 5,
                amount_aggregated: 9,
                amount_opened: 0,
                amount_opened_aggregated: 0,
                is_aggregated_amount: true,
              },
              {
                product_id: 9,
                product: { id: 9, name: "Parent", location_id: 2 },
                amount: 0,
                amount_aggregated: 4,
                amount_opened: 0,
                amount_opened_aggregated: 0,
                is_aggregated_amount: true,
              },
            ],
            "Freezer",
          ),
        );

      if (path.endsWith("/api/stock"))
        return Response.json([
          {
            product_id: 7,
            product: { id: 7, name: "Coffee", location_id: 2 },
            amount: 5,
            amount_aggregated: 9,
            amount_opened: 0,
            amount_opened_aggregated: 0,
            is_aggregated_amount: true,
          },
          {
            product_id: 9,
            product: { id: 9, name: "Parent", location_id: 2 },
            amount: 0,
            amount_aggregated: 4,
            amount_opened: 0,
            amount_opened_aggregated: 0,
            is_aggregated_amount: true,
          },
        ]);

      if (path.includes("/api/stock/volatile")) return Response.json({ missing_products: [] });

      if (path.includes("/shopping-lists/")) return Response.json({ items: [] });

      if (/\/api\/stock\/products\/[789]$/.test(path)) {
        ++detailReads;
        signals.push(init?.signal);

        if (heldDetails) {
          const response = heldDetails;
          heldDetails = undefined;

          return response;
        }

        if (readFailure && detailReads === 1)
          return Response.json({ error_message: "Product unavailable" }, { status: 503 });

        return transferDetails(Number(path.split("/").at(-1)));
      }

      if (/\/api\/stock\/products\/[789]\/locations$/.test(path)) {
        ++locationReads;
        const reply = locationsReply?.(path.split("/").at(-2)!);

        if (reply) return reply;

        return Response.json([
          { location_id: 1, location_name: "Old shelf", location_is_freezer: 0 },
          { location_id: 2, location_name: "Freezer", location_is_freezer: 1 },
        ]);
      }

      if (/\/api\/stock\/products\/[79]\/entries$/.test(path)) {
        ++entryReads;

        if (heldEntries) {
          const response = heldEntries;
          heldEntries = undefined;

          return response;
        }

        return Response.json(entries);
      }

      if (path.endsWith("/api/objects/product_barcodes_view")) {
        ++barcodeReads;

        if (barcodeLookup) return barcodeLookup;

        return Response.json(url.search.includes("COFFEE-2") ? [{ amount: 1.5, qu_id: 3 }] : []);
      }

      return Response.json([]);
    }),
  );

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
    writes,
    router,
    client,
    view,
    signals,
    holdDetails: (reply: Promise<Response>) => {
      heldDetails = reply;
    },
    holdEntries: (reply: Promise<Response>) => {
      heldEntries = reply;
    },
    entryReads: () => entryReads,
    entriesResponse: () => Response.json(entries),
    detailReads: () => detailReads,
    locationReads: () => locationReads,
    barcodeReads: () => barcodeReads,
  };
}

test("overview transfer uses own stock and retains the page filters and focus", async () => {
  const { writes } = mount("/stock");
  const trigger = await screen.findByRole<HTMLButtonElement>("button", { name: "Transfer Coffee" });
  await waitFor(() => expect(trigger.disabled).toBe(false));
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Transfer Parent" }).disabled).toBe(
    true,
  );
  const search = screen.getByRole<HTMLInputElement>("searchbox", { name: "Search stock" });
  await userEvent.type(search, "Coffee");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Location" }), "Freezer");
  await userEvent.click(trigger);
  await screen.findByRole("dialog", { name: "Transfer" });
  const amount = screen.getByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.max).toBe("5.00"));
  expect(screen.getByLabelText<HTMLSelectElement>("From location").value).toBe("1");
  expect(screen.getByLabelText<HTMLInputElement>("Use a specific stock item").checked).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(document.activeElement).toBe(trigger);
  expect(search.value).toBe("Coffee");
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Location" }).value).toBe(
    "Freezer",
  );
  expect(writes).toEqual([]);
  await userEvent.click(trigger);
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Amount").max).toBe("5.00"));
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
  await userEvent.selectOptions(screen.getByLabelText("To location"), "2");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Transfer" })).toBeNull());
  expect(writes.map((row) => row.path)).toEqual(["/api/stock/products/7/transfer"]);
  expect(document.activeElement).toBe(trigger);
  expect(search.value).toBe("Coffee");
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Location" }).value).toBe(
    "Freezer",
  );
});

test.each([
  { locations: true, transferAllowed: false },
  { locations: false, transferAllowed: true },
])("overview transfer follows location and permission settings: %j", async (options) => {
  mount("/stock", options);
  await screen.findByRole("link", { name: "Coffee" });

  if (options.locations)
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Transfer Coffee" }).disabled,
    ).toBe(true);
  else expect(screen.queryByRole("button", { name: "Transfer Coffee" })).toBeNull();
});

test("transfer retains native unit limits and stock identity, resets, and undoes the transaction", async () => {
  const { writes } = mount("/transfer?product=7&locationId=1&stockId=mint");
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await chooseTransferProduct("Coffee");
  await waitFor(() => expect(amount.max).toBe("5.00"));
  expect(amount.value).toBe("");
  expect(
    amount.closest("form")?.querySelector<HTMLInputElement>('input[name="amount"]')?.value,
  ).toBe("NaN");
  expect(screen.getByLabelText<HTMLSelectElement>("From location").value).toBe("1");
  expect(screen.getByLabelText<HTMLInputElement>("Use a specific stock item").checked).toBe(false);
  await userEvent.selectOptions(screen.getByLabelText("Quantity unit"), "3");
  expect(amount.max).toBe("4.50");
  await userEvent.click(screen.getByLabelText("Use a specific stock item"));
  await userEvent.selectOptions(screen.getByLabelText("Specific stock item"), "mint");
  expect(amount.max).toBe("2.00");
  fireEvent.change(amount, { target: { value: "1.5" } });
  await userEvent.selectOptions(screen.getByLabelText("To location"), "2");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(writes.some((row) => row.path.endsWith("/transfer"))).toBe(true));
  expect(writes.find((row) => row.path.endsWith("/transfer"))?.body).toEqual({
    amount: "3.",
    location_id_from: "1",
    location_id_to: "2",
    stock_entry_id: "mint",
  });
  await waitFor(() => expect(amount.value).toBe("7"));
  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(writes.some((row) => row.path.endsWith("/transactions/move-transaction/undo"))).toBe(
      true,
    ),
  );
});

test("embedded stock selection keeps the forced item and the native source and unit limits", async () => {
  mount("/transfer?embedded&product=7&locationId=1&stockId=mint");
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.max).toBe("5.00"));
  const check = screen.getByLabelText<HTMLInputElement>("Use a specific stock item");
  const stock = screen.getByLabelText<HTMLSelectElement>("Specific stock item");
  expect(check.checked).toBe(true);
  expect(stock.value).toBe("mint");
  expect(stock.options.length).toBe(2);
  expect(stock.options[1]?.text).toBe(
    "Amount: 2; Due on 2027-01-01; Bought on 2026-10-01; Opened First",
  );
  await userEvent.selectOptions(screen.getByLabelText("Quantity unit"), "3");
  expect(amount.max).toBe("4.50");
  await userEvent.click(check);
  await waitFor(() => expect(amount.max).toBe("2.50"));
  expect(check.checked).toBe(false);
  expect(stock.disabled).toBe(true);
  expect(stock.value).toBe("mint");
  await userEvent.selectOptions(screen.getByLabelText("From location"), "2");
  await waitFor(() => expect(stock.options.length).toBe(2));
  expect(check.checked).toBe(true);
  expect(stock.value).toBe("");
  await userEvent.selectOptions(screen.getByLabelText("To location"), "2");
  expect(screen.getByLabelText<HTMLSelectElement>("To location").value).toBe("");
  expect(screen.getByText('This cannot be the same as the "From" location')).toBeTruthy();
});

test("barcode metadata prefills the amount and unit and unknown codes can be assigned on submit", async () => {
  const { writes } = mount("/transfer?embedded");
  let product = await screen.findByLabelText<HTMLInputElement>("Product");
  fireEvent.change(product, { target: { value: "COFFEE-2" } });
  await userEvent.type(product, "{Enter}");
  let amount = screen.getByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.value).toBe("1.5"));
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("3");
  expect(screen.getByText("This equals 3 Pieces")).toBeTruthy();
  fireEvent.change(product, { target: { value: "NEW-CODE" } });
  await userEvent.type(product, "{Enter}");
  await userEvent.click(
    await screen.findByRole("button", { name: /Add as barcode to existing product/ }),
  );
  await waitFor(() => expect(product.isConnected).toBe(false));
  product = await screen.findByLabelText<HTMLInputElement>("Product");
  amount = screen.getByLabelText<HTMLInputElement>("Amount");
  fireEvent.change(product, { target: { value: "Coffee" } });
  await waitFor(() => expect(amount.max).toBe("5.00"));
  fireEvent.change(amount, { target: { value: "1" } });
  await userEvent.selectOptions(screen.getByLabelText("To location"), "2");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(writes.some((row) => row.path.endsWith("/objects/product_barcodes"))).toBe(true),
  );
  expect(writes.map((row) => row.path)).toEqual([
    "/api/stock/products/7/transfer",
    "/api/objects/product_barcodes",
  ]);
  expect(writes[1]?.body).toEqual({ product_id: "7", barcode: "NEW-CODE" });
});

test.each(["stock first", "locations first"])(
  "stock Grocycodes keep native source and stock choices when %s finishes",
  async (order) => {
    mount("/transfer?embedded");
    const fetchData = fetch;
    const requested = new Set<string>();
    let finishLocations!: (response: Response) => void;
    let finishStock!: (response: Response) => void;

    const locations = new Promise<Response>((resolve) => {
      finishLocations = resolve;
    });

    const stock = new Promise<Response>((resolve) => {
      finishStock = resolve;
    });

    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;

      if (path.endsWith("/products/7/locations")) {
        requested.add("locations");

        return locations;
      }

      if (path.endsWith("/objects/stock")) {
        requested.add("stock");

        return stock;
      }

      return fetchData(input, init);
    });

    const product = await screen.findByLabelText<HTMLInputElement>("Product");
    fireEvent.change(product, { target: { value: "grcy:p:7:other" } });
    await userEvent.type(product, "{Enter}");
    await waitFor(() => expect([...requested].sort()).toEqual(["locations", "stock"]));

    const completeLocations = () =>
      finishLocations(
        Response.json([
          { location_id: 1, location_name: "Old shelf", location_is_freezer: 0 },
          { location_id: 2, location_name: "Freezer", location_is_freezer: 1 },
        ]),
      );

    const completeStock = () => finishStock(Response.json([{ location_id: 2 }]));
    await act(async () => (order === "stock first" ? completeStock() : completeLocations()));
    await act(async () => (order === "stock first" ? completeLocations() : completeStock()));
    const amount = screen.getByLabelText<HTMLInputElement>("Amount");
    await waitFor(() => expect(amount.disabled).toBe(false));
    const from = screen.getByLabelText<HTMLSelectElement>("From location");
    const item = screen.getByLabelText<HTMLSelectElement>("Specific stock item");
    expect(from.value).toBe(order === "stock first" ? "1" : "2");
    expect(amount.max).toBe("5.00");
    expect(screen.getByLabelText<HTMLInputElement>("Use a specific stock item").checked).toBe(true);
    expect(item.value).toBe("");
    expect([...item.options].map((option) => option.value)).toEqual(["", "mint"]);
    await userEvent.selectOptions(from, "1");
    await userEvent.selectOptions(from, "2");
    await waitFor(() => expect(item.value).toBe("other"));
    expect(amount.max).toBe("4.00");
  },
);

test("failed reads and transfers can be retried with the draft and tare products are rejected", async () => {
  const { writes } = mount("/transfer?embedded&product=7", {
    readFailure: true,
    saveFailure: true,
  });

  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  await waitFor(() => expect(errors).toHaveBeenCalled());
  expect(screen.queryByText("Product unavailable")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  await chooseTransferProduct("Coffee");
  const amount = screen.getByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.max).toBe("5.00"));
  const product = screen.getByLabelText<HTMLInputElement>("Product");
  fireEvent.change(product, { target: { value: "Tare jar" } });
  await screen.findByText(
    "Products with tare weight enabled are currently not supported for transfer",
  );
  await waitFor(() => expect(product.value).toBe(""));
  fireEvent.change(product, { target: { value: "Coffee" } });
  await waitFor(() => expect(amount.disabled).toBe(false));
  fireEvent.change(amount, { target: { value: "2" } });
  await userEvent.selectOptions(screen.getByLabelText("To location"), "2");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(writes.filter((row) => row.path.endsWith("/transfer"))).toHaveLength(1),
  );
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(false),
  );
  expect(screen.queryByText("Transfer unavailable")).toBeNull();
  expect(errors).toHaveBeenCalledTimes(2);
  expect(amount.value).toBe("2");
  expect(screen.getByLabelText<HTMLSelectElement>("To location").value).toBe("2");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(writes.filter((row) => row.path.endsWith("/transfer")).length).toBe(2),
  );
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Saving…" }).disabled).toBe(true),
  );
  expect(product.disabled).toBe(true);
});

function heldTransferResponse() {
  let resolve!: (response: Response) => void;

  const promise = new Promise<Response>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

async function releaseTransferResponse(
  gate: ReturnType<typeof heldTransferResponse>,
  response: Response,
) {
  await act(async () => {
    gate.resolve(response);
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
  });
}

function transferBooking(index = 1) {
  return Response.json([
    {
      id: 90 + index,
      product_id: 7,
      amount: 1,
      transaction_id: `move-${index}`,
      transaction_type: "transfer_from",
    },
  ]);
}

async function chooseTransferProduct(name: string) {
  const product = await screen.findByLabelText<HTMLInputElement>("Product");

  if (product.value === name) fireEvent.change(product, { target: { value: "" } });
  fireEvent.change(product, { target: { value: name } });
  const amount = screen.getByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.max).toBe("5.00"));
  await waitFor(() => expect(document.activeElement).toBe(amount));

  return amount;
}

async function readyTransfer() {
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.max).toBe("5.00"));
  await waitFor(() => expect(document.activeElement).toBe(amount));

  return amount;
}

async function submitTransfer(amount: HTMLInputElement, value = "1", destination = "2") {
  fireEvent.change(amount, { target: { value } });
  await userEvent.selectOptions(screen.getByLabelText("To location"), destination);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
}

test.each([false, true])(
  "a successful transfer completes independently of held barcode metadata (embedded=%s)",
  async (embedded) => {
    const metadata = heldTransferResponse();

    const host = {
      IsGrocy: true,
      postMessage: vi.fn(),
      get parent() {
        return this;
      },
    };

    if (embedded) vi.stubGlobal("parent", host);

    const app = mount(
      `/transfer?${embedded ? "embedded&product=7&" : ""}flow=InplaceAddBarcodeToExistingProduct&barcode=NEW`,
      {
        barcodeReply: () => metadata.promise,
      },
    );

    const amount = embedded ? await readyTransfer() : await chooseTransferProduct("Coffee");
    const product = screen.getByLabelText<HTMLInputElement>("Product");
    await submitTransfer(amount);
    await waitFor(() =>
      expect(app.writes.map((row) => row.path)).toEqual([
        "/api/stock/products/7/transfer",
        "/api/objects/product_barcodes",
      ]),
    );

    if (embedded) {
      await waitFor(() =>
        expect(host.postMessage.mock.calls.some(([bag]) => bag.Message === "CloseLastModal")).toBe(
          true,
        ),
      );
      expect(
        host.postMessage.mock.calls
          .filter(([bag]) =>
            ["BroadcastMessage", "ShowSuccessMessage", "CloseLastModal"].includes(bag.Message),
          )
          .map(([bag]) => bag.Message),
      ).toEqual(["BroadcastMessage", "ShowSuccessMessage", "CloseLastModal"]);
      expect(
        screen.queryByText(
          "Transfered 1 Piece of Coffee from Old shelf (Default location) to Freezer",
        ),
      ).toBeNull();
    } else {
      await screen.findByText(
        "Transfered 1 Piece of Coffee from Old shelf (Default location) to Freezer",
      );
      await waitFor(() => expect(amount.value).toBe("7"));
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(false);
    }

    expect(app.writes[1]?.body).toEqual({ product_id: "7", barcode: "NEW" });
    await releaseTransferResponse(metadata, Response.json({}));
    await waitFor(() => expect(app.router.history.location.href).toBe("/transfer"));
    expect(screen.getByLabelText("Product")).toBe(product);
    expect(app.writes.filter((row) => row.path.endsWith("/transfer"))).toHaveLength(1);
  },
);

test("an earlier barcode failure unlocks a later transfer without replacing its captured body or live receipt controls", async () => {
  const metadata = heldTransferResponse();
  const secondBooking = heldTransferResponse();

  const app = mount("/transfer?flow=InplaceAddBarcodeToExistingProduct&barcode=FIRST", {
    barcodeReply: (index) => (index === 1 ? metadata.promise : Response.json({})),
    bookingReply: (index) => (index === 2 ? secondBooking.promise : transferBooking(index)),
  });

  const amount = await chooseTransferProduct("Coffee");
  await submitTransfer(amount);
  await screen.findByText(
    "Transfered 1 Piece of Coffee from Old shelf (Default location) to Freezer",
  );
  await waitFor(() => expect(amount.value).toBe("7"));
  expect((await screen.findByText("Frozen")).closest(".toast")?.getAttribute("data-tone")).toBe(
    "info",
  );
  expect(
    screen
      .getByText("This product shouldn't be frozen")
      .closest(".toast")
      ?.getAttribute("data-tone"),
  ).toBe("warning");
  await chooseTransferProduct("Coffee");
  await submitTransfer(amount);
  await waitFor(() =>
    expect(app.writes.filter((row) => row.path.endsWith("/transfer"))).toHaveLength(2),
  );
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Saving…" }).disabled).toBe(true);
  await releaseTransferResponse(
    metadata,
    Response.json({ error_message: "Metadata unavailable" }, { status: 503 }),
  );
  await screen.findByText("Error while saving, probably this item already exists");
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(false),
  );
  await userEvent.selectOptions(screen.getByLabelText("From location"), "2");
  await userEvent.selectOptions(screen.getByLabelText("To location"), "3");
  fireEvent.change(amount, { target: { value: "2" } });
  await act(async () => {
    app.router.history.replace(
      "/transfer?flow=InplaceAddBarcodeToExistingProduct&barcode=SECOND+RAW=ignored&barcode=WRONG",
    );
  });
  await releaseTransferResponse(secondBooking, transferBooking(2));
  const receipt = await screen.findByText("Transfered 1 Piece of Coffee from Freezer to Pantry");
  expect(receipt).toBeTruthy();
  expect(app.writes.filter((row) => row.path.endsWith("/transfer"))[1]?.body).toEqual({
    amount: "1.",
    location_id_from: "1",
    location_id_to: "2",
  });
  await waitFor(() =>
    expect(app.writes.filter((row) => row.path.endsWith("/objects/product_barcodes"))).toHaveLength(
      2,
    ),
  );
  expect(
    app.writes.filter((row) => row.path.endsWith("/objects/product_barcodes"))[1]?.body,
  ).toEqual({ product_id: "7", barcode: "SECOND+RAW" });
  expect(screen.getByText("Thawed").closest(".toast")?.getAttribute("data-tone")).toBe("info");
});

test("a failed pre-save product read logs, unlocks the draft, and a fresh Save reads and books again", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount("/transfer?embedded&product=7");
  const amount = await readyTransfer();
  const details = heldTransferResponse();
  app.holdDetails(details.promise);
  await submitTransfer(amount, "2");
  await releaseTransferResponse(
    details,
    Response.json({ error_message: "Read unavailable" }, { status: 503 }),
  );
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(false),
  );
  expect(errors).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Read unavailable")).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>("Use a specific stock item").checked).toBe(false);
  expect(screen.getByLabelText<HTMLSelectElement>("Specific stock item").disabled).toBe(false);
  expect(amount.value).toBe("2");
  expect(screen.getByLabelText<HTMLSelectElement>("To location").value).toBe("2");
  expect(app.writes).toEqual([]);
  const before = app.detailReads();
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(app.writes.filter((row) => row.path.endsWith("/transfer"))).toHaveLength(1),
  );
  expect(app.detailReads()).toBeGreaterThan(before);
  expect(app.writes[0]?.body).toEqual({ amount: "2.", location_id_from: "1", location_id_to: "2" });
});

test.each(["details", "booking"] as const)(
  "departing during %s retires transfer callbacks but preserves committed cache invalidation",
  async (stage) => {
    const held = heldTransferResponse();

    const host = {
      IsGrocy: true,
      postMessage: vi.fn(),
      get parent() {
        return this;
      },
    };

    vi.stubGlobal("parent", host);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const app = mount("/transfer?embedded&product=7", {
      bookingReply: stage === "booking" ? () => held.promise : undefined,
    });

    const amount = await readyTransfer();
    const keys = [["stock"], ["products"], ["recipe-fulfillment"], ["mealplan-calendar"]];

    for (const key of keys) app.client.setQueryData(key, { old: true });

    if (stage === "details") app.holdDetails(held.promise);
    await submitTransfer(amount);

    if (stage === "booking") await waitFor(() => expect(app.writes).toHaveLength(1));
    await act(async () => {
      await app.router.navigate({ to: "/about" });
    });
    await screen.findByRole("heading", { name: "About Grocy" });
    const before = host.postMessage.mock.calls.length;
    await releaseTransferResponse(
      held,
      stage === "booking" ? transferBooking() : transferDetails(),
    );
    await waitFor(() => expect(screen.getByRole("heading", { name: "About Grocy" })).toBeTruthy());
    expect(app.writes).toHaveLength(stage === "booking" ? 1 : 0);
    expect(host.postMessage.mock.calls).toHaveLength(before);
    expect(screen.queryByText(/Transfered /)).toBeNull();
    expect(errors).not.toHaveBeenCalled();

    if (stage === "booking")
      for (const key of keys)
        expect(app.client.getQueryState(key)?.isInvalidated ?? true).toBe(true);
    expect(app.signals.some((signal) => signal?.aborted)).toBe(true);
  },
);

test("a held optional barcode lookup does not block unit, source, or entry initialization and its failure only logs", async () => {
  const lookup = heldTransferResponse();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount("/transfer?embedded", { barcodeLookup: lookup.promise });
  const product = await screen.findByLabelText<HTMLInputElement>("Product");
  fireEvent.change(product, { target: { value: "COFFEE-2" } });
  await userEvent.type(product, "{Enter}");
  await waitFor(() => expect(app.barcodeReads()).toBe(1));
  const amount = screen.getByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.max).toBe("5.00"));
  expect(amount.disabled).toBe(false);
  expect(screen.getByLabelText<HTMLSelectElement>("From location").value).toBe("1");
  expect(
    [...screen.getByLabelText<HTMLSelectElement>("Quantity unit").options].map(
      (option) => option.value,
    ),
  ).toEqual(["1", "3"]);
  await releaseTransferResponse(
    lookup,
    Response.json({ error_message: "Optional lookup unavailable" }, { status: 503 }),
  );
  await waitFor(() => expect(errors).toHaveBeenCalledTimes(1));
  expect(screen.queryByText("Optional lookup unavailable")).toBeNull();
  await submitTransfer(amount, "1");
  await waitFor(() =>
    expect(app.writes.filter((row) => row.path.endsWith("/transfer"))).toHaveLength(1),
  );
});

test.each([
  { raw: 2.675, unit: 1, display: "2.68", wire: "2.67", maximum: "9.00", help: undefined },
  {
    raw: 0.675,
    unit: 3,
    display: "0.68",
    wire: "1.35",
    maximum: "4.50",
    help: "This equals 1.35 Pieces",
  },
])(
  "barcode quantity group captures hidden amount, help, and maximum before formatting (unit=$unit)",
  async ({ raw, unit, display, wire, maximum, help }) => {
    const lookup = heldTransferResponse();
    onTestFinished(() => lookup.resolve(Response.json([])));
    const app = mount("/transfer?embedded", { barcodeLookup: lookup.promise });
    const product = await screen.findByLabelText<HTMLInputElement>("Product");
    fireEvent.change(product, { target: { value: "COFFEE-2" } });
    await userEvent.type(product, "{Enter}");
    await waitFor(() => expect(app.barcodeReads()).toBe(1));
    const amount = screen.getByLabelText<HTMLInputElement>("Amount");
    await waitFor(() => expect(amount.max).toBe("5.00"));
    expect(screen.getByLabelText<HTMLSelectElement>("From location").value).toBe("1");
    await releaseTransferResponse(lookup, Response.json([{ amount: raw, qu_id: unit }]));
    await waitFor(() => expect(amount.value).toBe(display));
    expect(amount.max).toBe(maximum);
    expect(amount.checkValidity()).toBe(true);

    if (help) expect(screen.getByText(help)).toBeTruthy();
    else expect(screen.queryByText(/^This equals /)).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText("To location"), "2");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(app.writes.find((row) => row.path.endsWith("/transfer"))?.body).toEqual({
        amount: wire,
        location_id_from: "1",
        location_id_to: "2",
      }),
    );
    expect(app.writes.filter((row) => row.path.endsWith("/transfer"))).toHaveLength(1);
  },
);

function transferDetails(id = 7) {
  return Response.json({
    ...productOverview,
    product: {
      ...productOverview.product,
      description: null,
      name: id === 9 ? "Tea" : "Coffee",
      id,
      enable_tare_weight_handling: id === 8 ? 1 : 0,
      should_not_be_frozen: 1,
    },
    quantity_unit_stock: { ...productOverview.quantity_unit_stock, id: 1 },
    location: { id: 1, name: "Old shelf" },
    stock_amount: 9,
  });
}

test("an older product response still replaces units and launches locations while the current picker stays selected", async () => {
  const older = heldTransferResponse();
  const app = mount("/transfer?embedded");
  const product = await screen.findByLabelText<HTMLInputElement>("Product");
  app.holdDetails(older.promise);
  fireEvent.change(product, { target: { value: "Coffee" } });
  await waitFor(() => expect(app.detailReads()).toBe(1));
  const pendingSignal = app.signals.at(-1);
  await chooseTransferProduct("Tea");
  expect(
    [...screen.getByLabelText<HTMLSelectElement>("Quantity unit").options].map(
      (option) => option.text,
    ),
  ).toEqual(["Piece", "Cup"]);
  const locationsBefore = app.locationReads();
  await releaseTransferResponse(older, transferDetails());
  await waitFor(() =>
    expect(
      [...screen.getByLabelText<HTMLSelectElement>("Quantity unit").options].map(
        (option) => option.text,
      ),
    ).toEqual(["Piece", "Saved box"]),
  );
  await waitFor(() => expect(app.locationReads()).toBe(locationsBefore + 1));
  expect(product.value).toBe("Tea");
  expect(screen.getByLabelText<HTMLSelectElement>("From location").value).toBe("1");
  expect(pendingSignal?.aborted).toBe(false);
});

test.each([
  { name: "missing", settings: {}, expected: "" },
  { name: "fractional", settings: { stock_default_transfer_amount: "3.1415" }, expected: "3.14" },
])(
  "the $name transfer default follows the raw settings response at startup and reset",
  async ({ settings, expected }) => {
    mount("/transfer", { transferSettings: settings });
    const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
    expect(amount.value).toBe(expected);
    await chooseTransferProduct("Coffee");
    await submitTransfer(amount);
    await screen.findByText(
      "Transfered 1 Piece of Coffee from Old shelf (Default location) to Freezer",
    );
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe(""));
    expect(amount.value).toBe(expected);
    expect(amount.validity.stepMismatch).toBe(false);
  },
);

test("specific-item success starts an independent old-source entries read whose reply can repopulate the reset form", async () => {
  const app = mount("/transfer");
  const amount = await chooseTransferProduct("Coffee");
  await userEvent.click(screen.getByLabelText("Use a specific stock item"));
  const item = screen.getByLabelText<HTMLSelectElement>("Specific stock item");
  await userEvent.selectOptions(item, "mint");
  expect(amount.max).toBe("2.00");
  const reset = heldTransferResponse();
  const before = app.entryReads();
  app.holdEntries(reset.promise);
  await submitTransfer(amount);
  await screen.findByText(
    "Transfered 1 Piece of Coffee from Old shelf (Default location) to Freezer",
  );
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe(""));
  await waitFor(() => expect(app.entryReads()).toBe(before + 1));
  expect([...item.options].map((option) => option.value)).toEqual([""]);
  expect(amount.max).toBe("");
  await releaseTransferResponse(reset, app.entriesResponse());
  await waitFor(() =>
    expect([...item.options].map((option) => option.value)).toEqual(["", "mint"]),
  );
  expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("");
  expect(screen.getByLabelText<HTMLInputElement>("Use a specific stock item").checked).toBe(false);
  expect(item.disabled).toBe(true);
  expect(amount.max).toBe("NaN");
  expect(app.writes).toHaveLength(1);
  expect(app.writes[0]?.body.stock_entry_id).toBe("mint");
});
