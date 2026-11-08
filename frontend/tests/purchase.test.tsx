import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import type { JsonObject } from "@/lib/json";
import type { UserfieldDefinition } from "@/lib/userfields";
import { isoDay } from "@/lib/format";
import { productOverview } from "./fixtures/product-overview";
import { supportDialogs } from "./fixtures/dialogs";

beforeEach(supportDialogs);

function mount(
  path: string,
  {
    custom = false,
    customRequired = true,
    failField = false,
    failRead = false,
    failSave = false,
    failBarcode = false,
    tracking = true,
    scan = false,
    labels = false,
    serverLabels = true,
    customFields,
    fieldResponse,
    clearResponse,
    fileResponse,
    bookingGate,
    transactionResponse,
    failPrint = false,
    printJSON = true,
    printParams = {},
    labelLookup = "unexpected",
    dueCaption = "DD",
    barcodeResponse,
    usedBarcodeResponse,
    warnEarlier = false,
    dates = tracking,
    purchaseDefault = 2,
    barcodeLookup,
    barcodeAmount = 1.5,
    barcodeUnit = 3,
    shoppingAuto = false,
    barcodePrice = 9,
    priceInputPrecision = 3,
    priceDisplayPrecision = 2,
    lastPrice = 1,
  }: {
    custom?: boolean;
    customRequired?: boolean;
    failField?: boolean;
    failRead?: boolean;
    failSave?: boolean;
    failBarcode?: boolean;
    tracking?: boolean;
    scan?: boolean;
    labels?: boolean;
    serverLabels?: boolean;
    customFields?: UserfieldDefinition[];
    fieldResponse?: (body: JsonObject) => Promise<Response>;
    clearResponse?: () => Promise<Response>;
    fileResponse?: () => Promise<Response>;
    bookingGate?: Promise<unknown>;
    transactionResponse?: () => Promise<Response>;
    failPrint?: boolean;
    printJSON?: boolean;
    printParams?: JsonObject;
    labelLookup?: "failure" | "unexpected";
    dueCaption?: string;
    barcodeResponse?: (body: JsonObject) => Promise<Response>;
    usedBarcodeResponse?: (body: JsonObject) => Promise<Response>;
    warnEarlier?: boolean;
    dates?: boolean;
    purchaseDefault?: string | number;
    barcodeLookup?: Promise<Response>;
    barcodeAmount?: number;
    barcodeUnit?: number;
    shoppingAuto?: boolean;
    barcodePrice?: number;
    priceInputPrecision?: number;
    priceDisplayPrecision?: number;
    lastPrice?: number;
  } = {},
) {
  vi.stubGlobal("scrollTo", vi.fn());
  const writes: { path: string; body: JsonObject }[] = [];
  const fileWrites: { path: string; file: BodyInit | null | undefined }[] = [];
  const labelLookups: string[] = [];
  let clearReads = 0;
  const detailNames = { coffee: "Coffee", tare: "Tare coffee" };
  const detailReads: { id: number; name: string }[] = [];
  const secondarySignals: (AbortSignal | null | undefined)[] = [];
  let pendingDetails: Promise<Response> | undefined;
  let refreshDetails: Promise<Response> | undefined;
  let refreshReads = 0;
  const nextDue = { coffee: "2999-12-31", tare: "2999-12-31" };

  function detailsResponse(id = 7, overrides: { nextDue?: string; stock?: number } = {}) {
    const tare = id === 8;

    return Response.json({
      ...productOverview,
      product: {
        ...productOverview.product,
        id,
        name: tare ? detailNames.tare : detailNames.coffee,
        description: null,
        enable_tare_weight_handling: tare ? 1 : 0,
        tare_weight: 3,
        default_best_before_days: 5,
        default_best_before_days_after_freezing: -1,
        default_purchase_price_type: 3,
        default_stock_label_type: 0,
      },
      stock_amount: overrides.stock ?? 5,
      quantity_unit_stock: {
        ...productOverview.quantity_unit_stock,
        id: 1,
        name: "Piece",
        name_plural: "Pieces",
      },
      default_quantity_unit_purchase: { id: 3, name: "Box", name_plural: "Boxes" },
      location: { id: 1, name: "Shelf", is_freezer: 0 },
      last_price: lastPrice,
      last_shopping_location_id: 1,
      default_shopping_location_id: null,
      next_due_date: overrides.nextDue ?? (tare ? nextDue.tare : nextDue.coffee),
    });
  }

  let reads = 0;
  let fieldWrites = 0;
  let bookings = 0;
  let receipts = 0;
  let scanEnabled = scan;

  const fields =
    customFields ??
    (custom
      ? [
          {
            id: 1,
            name: "batch",
            caption: "Batch",
            type: "text-single-line",
            input_required: customRequired ? 1 : 0,
            default_value: null,
            config: null,
          },
        ]
      : []);

  const fetchData = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;

    if (init?.method === "POST" || init?.method === "PUT") {
      if (path.includes("/api/files/userfiles/")) {
        fileWrites.push({ path, file: init.body });

        return fileResponse?.() ?? Response.json({});
      }

      const form = new Headers(init.headers)
        .get("Content-Type")
        ?.startsWith("application/x-www-form-urlencoded");

      const body: JsonObject = form
        ? Object.fromEntries(new URLSearchParams(String(init.body)))
        : JSON.parse(String(init.body ?? "{}"));

      writes.push({ path, body });

      if (path === "/labels" && failPrint)
        return new Response("Printer unavailable", { status: 503 });

      if (path.includes("/api/userfields/stock/") && fieldResponse) return fieldResponse(body);

      if (path.endsWith("/scan_mode_purchase_enabled")) scanEnabled = body.value === true;

      if (path.includes("/objects/product_barcodes")) secondarySignals.push(init.signal);

      if (/\/objects\/product_barcodes\/\d+$/.test(path) && usedBarcodeResponse)
        return usedBarcodeResponse(body);

      if (path.endsWith("/objects/product_barcodes") && barcodeResponse)
        return barcodeResponse(body);

      if (path.endsWith("/objects/product_barcodes") && failBarcode)
        return Response.json({ error_message: "Barcode unavailable" }, { status: 400 });

      if (path.endsWith("/add")) {
        if (failSave && ++bookings === 1)
          return Response.json({ error_message: "Booking unavailable" }, { status: 503 });

        await bookingGate;

        const transaction =
          ++receipts === 1 ? "purchase-transaction" : `purchase-transaction-${receipts}`;

        if (body.stock_label_type === "2")
          return Response.json(
            ["one", "two"].map((stock_id, index) => ({
              id: 90 + index,
              product_id: 7,
              amount: 1,
              transaction_id: transaction,
              stock_id,
              transaction_type: "purchase",
              best_before_date: index === 0 ? "2026-12-24" : "2027-01-31",
            })),
          );

        return Response.json([
          {
            id: 90,
            product_id: 7,
            amount: Number(body.amount),
            transaction_id: transaction,
            stock_id: receipts === 1 ? "purchase-stock" : `purchase-stock-${receipts}`,
            transaction_type: "purchase",
            best_before_date: "2026-12-24",
          },
        ]);
      }

      if (
        path.endsWith("/api/userfields/stock/purchase-transaction") &&
        failField &&
        ++fieldWrites === 1
      )
        return Response.json({ error_message: "Batch unavailable" }, { status: 503 });

      return Response.json({});
    }

    if (path.endsWith("/api/v2/setup")) return Response.json({ needs_setup: false });

    if (
      path.endsWith("/api/objects/userfields") &&
      url.searchParams.get("query[]") === "entity=stock"
    ) {
      if (receipts === 0) return Response.json(fields);
      clearReads++;

      return clearResponse?.() ?? Response.json(fields);
    }

    if (path.endsWith("/api/user")) return Response.json([{ id: 1, username: "Owner" }]);

    if (path.endsWith("/api/v2/user/permissions")) return Response.json({});

    if (path.endsWith("/api/v2/localization"))
      return Response.json({
        locale: "en",
        direction: "ltr",
        languages: ["en"],
        catalog: {
          domain: "grocy/strings",
          "plural-forms": null,
          messages: { "": { DD: [dueCaption] } },
        },
      });

    if (path.endsWith("/api/user/settings"))
      return Response.json({
        stock_decimal_places_amounts: 2,
        stock_default_purchase_amount: purchaseDefault,
        stock_decimal_places_prices_input: priceInputPrecision,
        stock_decimal_places_prices_display: priceDisplayPrecision,
        show_purchased_date_on_purchase: true,
        scan_mode_purchase_enabled: scanEnabled,
        shopping_list_to_stock_workflow_auto_submit_when_prefilled: shoppingAuto,
        show_warning_on_purchase_when_due_date_is_earlier_than_next: warnEarlier,
      });

    if (path.endsWith("/api/system/config"))
      return Response.json({
        FEATURE_FLAG_STOCK: true,
        FEATURE_FLAG_STOCK_PRICE_TRACKING: tracking,
        FEATURE_FLAG_STOCK_LOCATION_TRACKING: tracking,
        FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: dates,
        FEATURE_FLAG_LABEL_PRINTER: labels,
        LABEL_PRINTER_RUN_SERVER: serverLabels,
        LABEL_PRINTER_WEBHOOK: "https://printer.example.test/labels",
        LABEL_PRINTER_HOOK_JSON: printJSON,
        LABEL_PRINTER_PARAMS: printParams,
        FEATURE_FLAG_DISABLE_BROWSER_BARCODE_CAMERA_SCANNING: true,
      });

    if (path.endsWith("/api/stock/transactions/purchase-transaction"))
      return transactionResponse?.() ?? Response.json([{ stock_id: "one" }, { stock_id: "two" }]);

    if (path.endsWith("/printlabel")) {
      labelLookups.push(path);

      return labelLookup === "failure"
        ? Response.json({ error_message: "Entry label endpoint must not be used" }, { status: 503 })
        : Response.json({
            product: "Unexpected current entry name",
            grocycode: "unexpected-entry-code",
            due_date: "Unexpected current entry due date",
          });
    }

    if (path.endsWith("/api/v2/stock/purchase/editor"))
      return Response.json({
        barcode_lookup_plugin_name: "Demo",
        products: [
          { id: 7, name: "Coffee" },
          { id: 8, name: "Tare coffee" },
        ],
        locations: [
          { id: 1, name: "Shelf", is_freezer: 0 },
          { id: 2, name: "Freezer", is_freezer: 1 },
        ],
        stores: [
          { id: 1, name: "Market" },
          { id: 2, name: "Roaster" },
        ],
        units: [{ id: 1, name: "Piece", name_plural: "Pieces" }],
        barcodes: [{ product_id: 7, barcodes: "COFFEE-2,COFFEE-3" }],
        fields,
        conversions: [7, 8].flatMap((product_id) => [
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
        ]),
      });

    if (path.includes("/shopping-lists/")) return Response.json({ items: [] });

    if (/\/api\/stock\/products\/[78]$/.test(path)) {
      if (failRead && ++reads === 1)
        return Response.json({ error_message: "Details unavailable" }, { status: 503 });
      const tare = path.endsWith("/8");
      detailReads.push({ id: tare ? 8 : 7, name: tare ? detailNames.tare : detailNames.coffee });

      const pending = pendingDetails;
      pendingDetails = undefined;

      if (pending) return await pending;

      if (refreshDetails && receipts > 0) {
        refreshReads++;

        return await refreshDetails;
      }

      return detailsResponse(tare ? 8 : 7);
    }

    if (path.endsWith("/api/objects/product_barcodes_view")) {
      if (barcodeLookup) return (await barcodeLookup).clone();

      return Response.json(
        url.search.includes("COFFEE-2") || url.search.includes("COFFEE-3")
          ? [
              {
                id: url.search.includes("COFFEE-3") ? 78 : 77,
                amount: barcodeAmount,
                qu_id: barcodeUnit,
                shopping_location_id: 2,
                last_price: barcodePrice,
                note: "Barcode note",
              },
            ]
          : [],
      );
    }

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
    writes,
    fileWrites,
    labelLookups,
    clearReads: () => clearReads,
    detailReads,
    secondarySignals,
    detailsResponse,
    holdDetails: (response: Promise<Response>) => {
      pendingDetails = response;
    },
    holdRefresh: (response: Promise<Response>) => {
      refreshDetails = response;
    },
    refreshReads: () => refreshReads,
    setNextDue: (coffee: string, tare = coffee) => {
      nextDue.coffee = coffee;
      nextDue.tare = tare;
    },
    router,
    client,
    view,
    rename: (coffee: string, tare = "Tare coffee") => {
      detailNames.coffee = coffee;
      detailNames.tare = tare;
    },
  };
}

const stockFields: UserfieldDefinition[] = ["Earlier", "Last", "Untouched"].map((caption, i) => ({
  id: i + 1,
  name: caption.toLowerCase(),
  caption,
  type: "text-single-line",
  input_required: 0,
  default_value: null,
  config: null,
}));

test("purchase clears the live draft only after definitions arrive and resaves cleared dirty fields on the next booking", async () => {
  const batch: UserfieldDefinition = {
    ...stockFields[0]!,
    name: "batch",
    caption: "Batch",
    default_value: "Configured default",
  };

  let release!: (response: Response) => void;

  const clear = new Promise<Response>((resolve) => {
    release = resolve;
  });

  let clears = 0;

  const { writes } = mount("/purchase", {
    customFields: [batch],
    clearResponse: () => (++clears === 1 ? clear : Promise.resolve(Response.json([batch]))),
  });

  fireEvent.change(await screen.findByLabelText("Product"), { target: { value: "Coffee" } });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Amount")));
  await userEvent.type(screen.getByLabelText("Batch"), "First lot");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Added 16 Pieces of Coffee to stock");
  expect(screen.getByLabelText<HTMLInputElement>("Batch").value).toBe("First lot");
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Batch").disabled).toBe(false),
  );
  await userEvent.clear(screen.getByLabelText("Batch"));
  await userEvent.type(screen.getByLabelText("Batch"), "Next draft before Clear");
  await act(async () => release(Response.json([batch])));
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Batch").value).toBe(""));
  fireEvent.change(screen.getByLabelText("Product"), { target: { value: "Coffee" } });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Amount")));
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(writes.filter((row) => row.path.endsWith("/add"))).toHaveLength(2));
  await waitFor(() =>
    expect(writes.filter((row) => row.path.includes("/userfields/"))).toEqual([
      { path: "/api/userfields/stock/purchase-transaction", body: { batch: "First lot" } },
      { path: "/api/userfields/stock/purchase-transaction-2", body: { batch: "" } },
    ]),
  );
});

test.each([false, true])(
  "the last dirty purchase field completes without overwriting the next draft when an earlier field later fails=%s",
  async (failEarlier) => {
    let release!: (response: Response) => void;

    const earlier = new Promise<Response>((resolve) => {
      release = resolve;
    });

    const { writes } = mount("/purchase", {
      customFields: stockFields,
      fieldResponse: async (body) => (Object.hasOwn(body, "earlier") ? earlier : Response.json({})),
    });

    fireEvent.change(await screen.findByLabelText("Product"), { target: { value: "Coffee" } });
    const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
    await waitFor(() => expect(document.activeElement).toBe(amount));
    await userEvent.type(screen.getByLabelText("Earlier"), "First batch");
    await userEvent.type(screen.getByLabelText("Last"), "Last batch");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(
        writes.filter((row) => row.path.includes("/userfields/")).map((row) => row.body),
      ).toEqual([{ earlier: "First batch" }, { last: "Last batch" }]),
    );
    await screen.findByText("Added 16 Pieces of Coffee to stock");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Product")));
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Earlier").value).toBe(""));
    await userEvent.type(screen.getByLabelText("Earlier"), "Next batch");
    await act(async () =>
      release(
        failEarlier
          ? Response.json({ error_message: "Earlier metadata failed" }, { status: 503 })
          : Response.json({}),
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>("Earlier").value).toBe("Next batch"),
    );
    expect(screen.queryByText("Earlier metadata failed")).toBeNull();
    expect(writes.filter((row) => row.path.endsWith("/add"))).toHaveLength(1);
  },
);

test.each([false, true])(
  "embedded purchase waits for its last file, then broadcasts within Grocy and completes through its parent; upload failure=%s",
  async (failUpload) => {
    const parent = vi.fn();
    const grocy = vi.fn();
    const external = vi.fn();
    const externalHost = { postMessage: external, parent: {} };
    externalHost.parent = externalHost;
    const grocyHost = { IsGrocy: true, postMessage: grocy, parent: externalHost };

    const messages = () =>
      parent.mock.calls.filter(([bag]) => bag.Message !== "ResizeResponsiveEmbeds");

    vi.stubGlobal("parent", { IsGrocy: true, postMessage: parent, parent: grocyHost });
    vi.stubGlobal("top", externalHost);
    vi.spyOn(window, "postMessage").mockImplementation(() => {});
    let release!: (response: Response) => void;

    const upload = new Promise<Response>((resolve) => {
      release = resolve;
    });

    const { writes, fileWrites } = mount("/purchase?embedded&product=7&listitemid=12", {
      customFields: [
        stockFields[0]!,
        { ...stockFields[1]!, caption: "Certificate", name: "certificate", type: "file" },
        stockFields[2]!,
      ],
      fileResponse: () => upload,
    });

    const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
    await waitFor(() => expect(document.activeElement).toBe(amount));
    await userEvent.type(screen.getByLabelText("Earlier"), "Lot one");
    const file = new File(["certificate contents"], "Batch.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("Certificate"), file);
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(fileWrites).toHaveLength(1));
    expect(fileWrites[0]?.file).toBe(file);
    expect(
      writes.filter((row) => row.path.includes("/userfields/")).map((row) => Object.keys(row.body)),
    ).toEqual([["earlier"], ["certificate"]]);
    expect(messages()).toHaveLength(0);
    expect(grocy).not.toHaveBeenCalled();
    expect(external).not.toHaveBeenCalled();
    expect(amount.matches(":disabled")).toBe(true);
    await act(async () =>
      release(
        failUpload
          ? Response.json({ error_message: "File unavailable" }, { status: 503 })
          : Response.json({}),
      ),
    );

    if (failUpload) {
      await screen.findByRole("button", {
        name: /Error while saving, probably this item already exists/,
      });
      expect(messages()).toHaveLength(0);
      expect(grocy).not.toHaveBeenCalled();
      expect(external).not.toHaveBeenCalled();
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Saving…" }).disabled).toBe(
        true,
      );
    } else {
      await waitFor(() =>
        expect(messages().map(([bag]) => bag.Message)).toEqual([
          "AfterItemAdded",
          "ShowSuccessMessage",
          "Ready",
          "CloseLastModal",
        ]),
      );
      expect(messages()[0]?.[0]).toEqual({ Message: "AfterItemAdded", Payload: "12" });
      expect(messages()[2]?.[0]).toEqual({ Message: "Ready", Payload: null });
      expect(messages()[3]?.[0]).toEqual({ Message: "CloseLastModal", Payload: null });
      expect(grocy.mock.calls).toEqual([
        [
          { Message: "BroadcastMessage", Payload: { Message: "ProductChanged", Payload: "7" } },
          window.location.origin,
        ],
      ]);
      expect(external).not.toHaveBeenCalled();

      expect(screen.queryByText(/^Added .* to stock$/)).toBeNull();

      const firstCompletion = parent.mock.calls.findIndex(
        ([bag]) => bag.Message === "AfterItemAdded",
      );

      expect(grocy.mock.invocationCallOrder[0]).toBeLessThan(
        parent.mock.invocationCallOrder[firstCompletion]!,
      );
    }

    expect(writes.filter((row) => row.path.endsWith("/add"))).toHaveLength(1);
  },
);

test.each(["booking", "field"])(
  "departing a purchase during %s stops later field stages and messages while retaining stale stock caches",
  async (stage) => {
    const parent = vi.fn();
    vi.stubGlobal("parent", { postMessage: parent });
    vi.spyOn(window, "postMessage").mockImplementation(() => {});
    let release!: (response: Response) => void;

    const metadata = new Promise<Response>((resolve) => {
      release = resolve;
    });

    const { writes, fileWrites, client, router } = mount("/purchase?embedded&product=7", {
      customFields: [
        { ...stockFields[0]!, name: "certificate", caption: "Certificate", type: "file" },
      ],
      fieldResponse: stage === "field" ? () => metadata : undefined,
      bookingGate: stage === "booking" ? metadata : undefined,
    });

    const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
    await waitFor(() => expect(document.activeElement).toBe(amount));

    const keys = [
      ["stock", "warm-proof"],
      ["products"],
      ["recipe-fulfillment"],
      ["shopping", 50],
      ["mealplan-calendar"],
    ];

    for (const key of keys) client.setQueryData(key, []);
    await userEvent.upload(
      screen.getByLabelText("Certificate"),
      new File(["pdf"], "batch.pdf", { type: "application/pdf" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(
        writes.filter((row) => row.path.includes(stage === "field" ? "/userfields/" : "/add")),
      ).toHaveLength(1),
    );
    await act(async () => {
      await router.navigate({ to: "/about" });
    });
    await act(async () => release(Response.json({})));
    expect(fileWrites).toHaveLength(0);
    expect(writes.filter((row) => row.path.includes("/userfields/"))).toHaveLength(
      stage === "field" ? 1 : 0,
    );
    expect(
      parent.mock.calls.filter(([bag]) => bag.Message !== "ResizeResponsiveEmbeds"),
    ).toHaveLength(0);

    for (const key of keys) {
      const query = client.getQueryState(key);

      expect(!query || query.isInvalidated).toBe(true);
    }

    expect(writes.filter((row) => row.path.endsWith("/add"))).toHaveLength(1);
  },
);

test("purchase uses cached units, saves custom fields, resets, and undoes", async () => {
  const { writes } = mount("/purchase", { custom: true });
  fireEvent.change(await screen.findByLabelText("Product"), { target: { value: "Coffee" } });
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.disabled).toBe(false));
  expect(amount.value).toBe("2");
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("3");
  expect(screen.getByRole("option", { name: "Saved box" })).toBeTruthy();
  expect(screen.getByText("This equals 16 Pieces")).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>("Price").value).toBe("8.000");
  expect(screen.getByLabelText<HTMLInputElement>("Due date").value).toBe(isoDay(5));
  await waitFor(() => expect(document.activeElement).toBe(amount));
  await userEvent.type(screen.getByLabelText("Batch"), "Lot one");
  fireEvent.change(screen.getByLabelText("Price"), { target: { value: "4" } });
  expect(screen.getByText("means 0.25 per Piece")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Purchased date"), { target: { value: "2026-10-01" } });
  await userEvent.type(screen.getByLabelText("Note"), "Weekly purchase");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe(""));
  const bookings = writes.filter((row) => row.path.endsWith("/add"));
  expect(bookings).toHaveLength(1);
  expect(bookings[0]?.body).toEqual({
    amount: "16.",
    price: "0.250",
    purchased_date: "2026-10-01",
    best_before_date: isoDay(5),
    location_id: "1",
    shopping_location_id: "1",
    note: "Weekly purchase",
  });
  expect(writes.filter((row) => row.path.includes("/userfields/"))).toHaveLength(1);
  expect(writes.find((row) => row.path.includes("/userfields/"))?.body).toEqual({
    batch: "Lot one",
  });
  expect(amount.value).toBe("2");
  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(writes.some((row) => row.path.endsWith("/transactions/purchase-transaction/undo"))).toBe(
      true,
    ),
  );
});

test("a failed last custom-field metadata save silently retains the booked stock and locks the purchase form", async () => {
  const { writes } = mount("/purchase?embedded&product=7", { custom: true, failField: true });
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  await userEvent.type(screen.getByLabelText("Batch"), "Lot one");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(writes.filter((row) => row.path.includes("/userfields/"))).toHaveLength(1),
  );
  expect(screen.queryByText("Batch unavailable")).toBeNull();
  expect(amount.matches(":disabled")).toBe(true);
  const save = screen.getByRole<HTMLButtonElement>("button", { name: "Saving…" });
  expect(save.disabled).toBe(true);
  await userEvent.click(save);
  expect(writes.filter((row) => row.path.endsWith("/add"))).toHaveLength(1);
  expect(writes.filter((row) => row.path.includes("/userfields/"))).toHaveLength(1);
});

test("a full-page product bookmark retains the native uninitialized purchase fields", async () => {
  mount("/purchase?product=7");
  const product = await screen.findByLabelText<HTMLInputElement>("Product");
  expect(screen.queryByRole("region", { name: "Price history" })).toBeNull();
  expect(product.value).toBe("Coffee");
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("");
  expect(screen.getByLabelText<HTMLInputElement>("Due date").value).toBe("");
  await userEvent.type(screen.getByLabelText("Product"), "{Enter}");
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("3"),
  );
});

test("barcode values fill purchase amount, price, store and note and save the barcode price", async () => {
  const { writes } = mount("/purchase?embedded");
  const product = await screen.findByLabelText("Product");
  fireEvent.change(product, { target: { value: "COFFEE-2" } });
  await userEvent.type(product, "{Enter}");
  const amount = screen.getByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.value).toBe("1.5"));
  expect(screen.getByLabelText<HTMLSelectElement>("Store").value).toBe("2");
  expect(screen.getByLabelText<HTMLInputElement>("Note").value).toBe("Barcode note");
  expect(screen.getByLabelText<HTMLInputElement>("Price").value).toBe("9.000");
  await userEvent.selectOptions(screen.getByLabelText("Location"), "2");
  expect(screen.getByLabelText<HTMLInputElement>("Due date").readOnly).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(writes.some((row) => row.path.endsWith("/product_barcodes/77"))).toBe(true),
  );
  expect(writes.find((row) => row.path.endsWith("/add"))?.body).toMatchObject({
    amount: "12.",
    price: "0.750",
    best_before_date: "2999-12-31",
    shopping_location_id: "2",
    note: "Barcode note",
  });
  expect(writes.find((row) => row.path.endsWith("/product_barcodes/77"))?.body).toEqual({
    last_price: "9.000",
  });
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Product").disabled).toBe(true),
  );
});

test("tare purchases retain gross weight and disabled tracking save rules through retry", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});

  const { writes } = mount("/purchase?embedded&product=8", {
    tracking: false,
    failRead: true,
    failSave: true,
  });

  await waitFor(() => expect(logged).toHaveBeenCalledOnce());
  expect(screen.queryByText("Details unavailable")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  const product = screen.getByLabelText("Product");
  fireEvent.change(product, { target: { value: "" } });
  fireEvent.change(product, { target: { value: "Tare coffee" } });
  const amount = screen.getByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.disabled).toBe(false));
  expect(amount.min).toBe("8");
  expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").disabled).toBe(true);
  fireEvent.change(amount, { target: { value: "15" } });
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(logged).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("Booking unavailable")).toBeNull();
  expect(amount.matches(":disabled")).toBe(false);
  expect(amount.value).toBe("15");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Added 7 Pieces of Tare coffee to stock");
  expect(writes.filter((row) => row.path.endsWith("/add"))).toHaveLength(2);
  expect(writes.at(-1)?.body).toEqual({
    amount: "15.",
    price: 0,
    best_before_date: null,
    note: "",
    purchased_date: isoDay(),
  });
});

test("purchase scan mode saves its setting and books one selected unit", async () => {
  const { writes } = mount("/purchase");
  await screen.findByLabelText("Product");
  await userEvent.click(screen.getByRole("button", { name: "Scan mode off" }));
  await screen.findByRole("button", { name: "Scan mode on" });
  fireEvent.change(screen.getByLabelText("Product"), { target: { value: "Coffee" } });
  await waitFor(() => expect(writes.some((row) => row.path.endsWith("/add"))).toBe(true));
  expect(writes.find((row) => row.path.endsWith("/add"))?.body.amount).toBe("8.");
});

test("embedded purchase disables saved scan mode and waits for an explicit booking", async () => {
  const { writes } = mount("/purchase?embedded&product=7", { scan: true });
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  expect(amount.value).toBe("2");
  expect(writes).toEqual([]);
  expect(screen.queryByRole("button", { name: /Scan mode/ })).toBeNull();
});

test("purchase barcode assignment follows the booking and retains its purchase metadata", async () => {
  const { writes } = mount("/purchase?embedded");
  const product = await screen.findByLabelText("Product");
  fireEvent.change(product, { target: { value: "NEW-COFFEE" } });
  await userEvent.type(product, "{Enter}");
  await userEvent.click(
    await screen.findByRole("button", { name: /Add as barcode to existing product/ }),
  );
  await waitFor(() => expect(screen.getByLabelText("Product")).not.toBe(product));
  const currentProduct = screen.getByLabelText("Product");
  fireEvent.change(currentProduct, { target: { value: "Coffee" } });
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Amount").disabled).toBe(false),
  );
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(writes.some((row) => row.path.endsWith("/product_barcodes"))).toBe(true),
  );
  expect(writes.map((row) => row.path)).toEqual([
    "/api/stock/products/7/add",
    "/api/objects/product_barcodes",
  ]);
  expect(writes[1]?.body).toEqual({
    barcode: "NEW-COFFEE",
    product_id: "7",
    qu_id: "3",
    amount: "2",
    note: "",
    shopping_location_id: "1",
  });
});

test("purchase product creation returns through the purchase barcode workflow", async () => {
  const { router } = mount("/purchase?embedded");
  const product = await screen.findByLabelText("Product");
  fireEvent.change(product, { target: { value: "NEW-COFFEE" } });
  await userEvent.type(product, "{Enter}");
  await userEvent.click(
    await screen.findByRole("button", { name: /Add as new product and prefill barcode/ }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe("/product/new"));
  expect(router.state.location.search).toMatchObject({
    flow: "InplaceNewProductWithBarcode",
    barcode: "NEW-COFFEE",
    returnto: "/purchase?embedded&flow=InplaceAddBarcodeToExistingProduct&barcode=NEW-COFFEE",
  });
});

test("a failed barcode assignment permits custom fields and keeps the remaining query values", async () => {
  const { writes, router } = mount(
    "/purchase?product=7&flow=InplaceAddBarcodeToExistingProduct&barcode=NEW-COFFEE&amount=16&quId=3&listitemid=10",
    { custom: true, failBarcode: true },
  );

  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  await userEvent.type(screen.getByLabelText("Batch"), "Lot one");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(writes.some((row) => row.path.includes("/userfields/"))).toBe(true));
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe(""));
  await screen.findByRole("button", {
    name: /Error while saving, probably this item already exists/,
  });
  expect(writes.map((row) => row.path)).toEqual([
    "/api/stock/products/7/add",
    "/api/objects/product_barcodes",
    "/api/userfields/stock/purchase-transaction",
  ]);
  expect(router.state.location.search).toEqual({
    product: "7",
    amount: "16",
    quId: "3",
    listitemid: "10",
  });
});

test.each([
  {
    name: "JSON with translated due date",
    tracking: true,
    json: true,
    params: { copies: 2 },
    expected: {
      product: "Coffee",
      grocycode: "grcy:p:7:purchase-stock",
      due_date: "Best before: 2026-12-24",
      copies: 2,
    },
  },
  {
    name: "JSON without due date tracking",
    tracking: false,
    json: true,
    params: {},
    expected: { product: "Coffee", grocycode: "grcy:p:7:purchase-stock" },
  },
  {
    name: "form payload with configured overrides",
    tracking: false,
    json: false,
    params: {
      product: "Configured product",
      grocycode: "Configured code",
      due_date: "Configured date",
      copies: 2,
    },
    expected: {
      product: "Configured product",
      grocycode: "Configured code",
      due_date: "Configured date",
      copies: "2",
    },
  },
])(
  "purchase single label posts booking payload directly: $name",
  async ({ tracking, json, params, expected }) => {
    const { writes, labelLookups } = mount("/purchase", {
      labels: true,
      serverLabels: false,
      custom: true,
      tracking,
      printJSON: json,
      printParams: params,
      labelLookup: "failure",
      dueCaption: "Best before",
    });

    fireEvent.change(await screen.findByLabelText("Product"), { target: { value: "Coffee" } });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Amount")));
    await userEvent.type(screen.getByLabelText("Batch"), "Direct label lot");
    await userEvent.selectOptions(screen.getByLabelText("Stock entry label"), "1");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Added 16 Pieces of Coffee to stock");
    await waitFor(() => expect(writes.filter((row) => row.path === "/labels")).toHaveLength(1));
    expect(writes.find((row) => row.path === "/labels")?.body).toEqual(expected);
    expect(labelLookups).toEqual([]);
    expect(writes.find((row) => row.path.includes("/userfields/"))?.body).toEqual({
      batch: "Direct label lot",
    });
    expect(screen.queryByRole("button", { name: /Error while executing WebHook/ })).toBeNull();
  },
);

test.each([true, false])(
  "purchase label-per-unit uses the configured print runtime (%s)",
  async (serverLabels) => {
    const { writes } = mount("/purchase?embedded&product=7", { labels: true, serverLabels });
    const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
    await waitFor(() => expect(amount.disabled).toBe(false));
    fireEvent.change(amount, { target: { value: "0.25" } });
    await userEvent.selectOptions(screen.getByLabelText("Stock entry label"), "2");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>("Product").disabled).toBe(true),
    );
    expect(writes.find((row) => row.path.endsWith("/add"))?.body).toMatchObject({
      amount: "2.",
      stock_label_type: "2",
    });
    const prints = writes.filter((row) => row.path === "/labels");
    expect(prints.map((row) => row.body.grocycode)).toEqual(
      serverLabels ? [] : ["grcy:p:7:one", "grcy:p:7:two"],
    );
  },
);

test.each([
  { outcome: "success", failRead: false, failPrint: false },
  { outcome: "read failure", failRead: true, failPrint: false },
  { outcome: "webhook failure", failRead: false, failPrint: true },
])(
  "purchase custom fields and receipt finish before the independent label read: $outcome",
  async ({ failRead, failPrint }) => {
    let release!: (response: Response) => void;

    const transaction = new Promise<Response>((resolve) => {
      release = resolve;
    });

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const { writes, labelLookups, detailReads, rename } = mount("/purchase", {
      labels: true,
      serverLabels: false,
      custom: true,
      failPrint,
      transactionResponse: () => transaction,
    });

    fireEvent.change(await screen.findByLabelText("Product"), { target: { value: "Coffee" } });
    const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
    await waitFor(() => expect(document.activeElement).toBe(amount));
    await userEvent.type(screen.getByLabelText("Batch"), "Lot one");
    await userEvent.selectOptions(screen.getByLabelText("Stock entry label"), "2");
    rename("Booked coffee");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Added 16 Pieces of Booked coffee to stock");
    expect(writes.find((row) => row.path.includes("/userfields/"))?.body).toEqual({
      batch: "Lot one",
    });
    expect(writes.some((row) => row.path === "/labels")).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Product")));
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Batch").value).toBe(""));
    rename("Later coffee", "Later tare coffee");
    fireEvent.change(screen.getByLabelText("Product"), { target: { value: "Tare coffee" } });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Amount")));
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2035-06-30" } });
    expect(screen.getByLabelText<HTMLInputElement>("Due date").value).toBe("2035-06-30");
    expect(detailReads).toContainEqual({ id: 8, name: "Later tare coffee" });
    await userEvent.type(screen.getByLabelText("Batch"), "Next lot");

    await act(async () =>
      release(
        failRead
          ? Response.json({ error_message: "Label transaction unavailable" }, { status: 503 })
          : Response.json([
              { stock_id: "one", best_before_date: "2040-01-01" },
              { stock_id: "two", best_before_date: "2041-02-02" },
            ]),
      ),
    );

    await waitFor(() => {
      if (failRead) expect(logged).toHaveBeenCalledOnce();
      else expect(writes.filter((row) => row.path === "/labels")).toHaveLength(2);
    });
    expect(screen.getByLabelText<HTMLInputElement>("Batch").value).toBe("Next lot");
    expect(screen.queryByText("Label transaction unavailable")).toBeNull();
    expect(labelLookups).toEqual([]);

    if (!failRead)
      expect(writes.filter((row) => row.path === "/labels").map((row) => row.body)).toEqual([
        { product: "Booked coffee", grocycode: "grcy:p:7:one", due_date: "DD: 2026-12-24" },
        { product: "Booked coffee", grocycode: "grcy:p:7:two", due_date: "DD: 2026-12-24" },
      ]);

    if (failPrint) {
      const errors = await screen.findAllByRole("button", {
        name: /Error while executing WebHook/,
      });

      expect(errors).toHaveLength(2);
      await userEvent.click(errors[0]!);
      expect(await screen.findByText("undefined")).toBeTruthy();
    }

    expect(writes.filter((row) => row.path.endsWith("/add"))).toHaveLength(1);
  },
);

test("untouched optional stock fields retain their native unsaved state", async () => {
  const { writes } = mount("/purchase?embedded&product=7", { custom: true, customRequired: false });
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.disabled).toBe(false));
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Product").disabled).toBe(true),
  );
  expect(writes.map((row) => row.path)).toEqual(["/api/stock/products/7/add"]);
});

test("Purchase sends unchanged Arrow-dirty fields and reads live custom textarea DOM after its booking", async () => {
  const booking = heldPurchaseResponse();

  const notes: UserfieldDefinition = {
    ...stockFields[1]!,
    name: "notes",
    caption: "Custom notes",
    type: "text-multi-line",
  };

  const app = mount("/purchase?embedded&product=7", {
    customFields: [stockFields[0]!, notes, stockFields[2]!],
    bookingGate: booking.promise,
  });

  const user = userEvent.setup();
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  const earlier = screen.getByLabelText<HTMLInputElement>("Earlier");
  await user.click(earlier);
  await user.keyboard("{ArrowLeft}");
  expect(earlier.value).toBe("");
  const textarea = screen.getByLabelText<HTMLTextAreaElement>("Custom notes");
  await user.type(textarea, "Before booking");
  await user.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(app.writes.filter((row) => row.path.endsWith("/add"))).toHaveLength(1),
  );
  expect(app.writes.filter((row) => row.path.includes("/userfields/"))).toEqual([]);
  expect(textarea.matches(":disabled")).toBe(true);
  // Controlled disabled-DOM assignment isolates the native post-booking .val() read.
  // This is a callback-binding check, not a claim that a user can edit a busy form.
  textarea.value = "First line\r\nSecond line";
  await releasePurchase(booking, Response.json({}));
  await screen.findByText("Added 16 Pieces of Coffee to stock");
  expect(app.writes.filter((row) => row.path.includes("/userfields/"))).toEqual([
    { path: "/api/userfields/stock/purchase-transaction", body: { earlier: "" } },
    {
      path: "/api/userfields/stock/purchase-transaction",
      body: { notes: "First line\nSecond line" },
    },
  ]);
});

test.each([false, true])(
  "Purchase preset and packed-link metadata follow native click and keyup events (%s)",
  async (nativeEvents) => {
    const definitions: UserfieldDefinition[] = [
      {
        ...stockFields[0]!,
        name: "priority",
        caption: "Priority",
        type: "preset-list",
        config: "Low\nHigh",
      },
      {
        ...stockFields[1]!,
        name: "resource",
        caption: "Resource",
        type: "link-with-title",
      },
      stockFields[2]!,
    ];

    const app = mount("/purchase?embedded&product=7", { customFields: definitions });
    const user = userEvent.setup();
    const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
    await waitFor(() => expect(document.activeElement).toBe(amount));
    const priority = screen.getByLabelText<HTMLSelectElement>("Priority");
    // Source select change validates; its separate click is what marks it dirty.
    fireEvent.change(priority, { target: { value: "High" } });
    const resource = within(screen.getByRole("group", { name: "Resource" }));
    const title = resource.getByRole<HTMLInputElement>("textbox", { name: "Title" });
    const link = resource.getByRole<HTMLInputElement>("textbox", { name: "Link" });
    await user.click(title);
    await user.paste("Saved title");
    await user.click(link);
    await user.paste("https://example.test/notes");

    if (nativeEvents) {
      await user.click(priority);
      await user.click(title);
      await user.keyboard("{ArrowLeft}");
      await user.tripleClick(title);
      await user.paste("Later display only");
      expect(title.value).toBe("Later display only");
    }

    await user.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Added 16 Pieces of Coffee to stock");
    expect(app.writes.filter((row) => row.path.endsWith("/add"))).toHaveLength(1);
    expect(app.writes.filter((row) => row.path.includes("/userfields/"))).toEqual(
      nativeEvents
        ? [
            { path: "/api/userfields/stock/purchase-transaction", body: { priority: "High" } },
            {
              path: "/api/userfields/stock/purchase-transaction",
              body: {
                resource: JSON.stringify({
                  title: "Saved title",
                  link: "https://example.test/notes",
                }),
              },
            },
          ]
        : [],
    );
  },
);

test("purchase date shortcuts retain their values and move focus before booking", async () => {
  const { writes } = mount("/purchase");
  fireEvent.change(await screen.findByLabelText("Product"), { target: { value: "Coffee" } });
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Amount").disabled).toBe(false),
  );
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Amount")));
  const purchased = screen.getByLabelText<HTMLInputElement>("Purchased date");
  const due = screen.getByLabelText<HTMLInputElement>("Due date");
  await userEvent.clear(purchased);
  await userEvent.type(purchased, "20320229");
  expect(purchased.value).toBe("2032-02-29");
  expect(document.activeElement).toBe(due);
  await userEvent.clear(due);
  await userEvent.type(due, "x");
  expect(due.value).toBe("2999-12-31");
  expect(due.readOnly).toBe(true);
  expect(screen.getByLabelText<HTMLInputElement>("Never overdue").checked).toBe(true);
  expect(document.activeElement).toBe(screen.getByLabelText("Price"));
  await userEvent.click(screen.getByLabelText("Never overdue"));
  expect(due.value).toBe("");
  expect(document.activeElement).toBe(due);
  await userEvent.paste("2999-12-31");
  await userEvent.keyboard("{End}");
  expect(document.activeElement).toBe(screen.getByLabelText("Price"));
  await userEvent.click(screen.getByLabelText("Never overdue"));
  expect(due.value).toBe("");
  expect(document.activeElement).toBe(due);
  await userEvent.type(due, "203511e");
  expect(due.value).toBe("2035-11-30");
  expect(document.activeElement).toBe(screen.getByLabelText("Price"));
  due.focus();
  await userEvent.tab();
  expect(document.activeElement).toBe(screen.getByLabelText("Price"));
  await userEvent.click(screen.getByRole("button", { name: "Due date: Calendar" }));
  await userEvent.click(screen.getByRole("button", { name: "November 29, 2035" }));
  expect(due.value).toBe("2035-11-29");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(writes.some((row) => row.path.endsWith("/add"))).toBe(true));
  expect(writes.find((row) => row.path.endsWith("/add"))?.body).toMatchObject({
    best_before_date: "2035-11-29",
    purchased_date: "2032-02-29",
  });
});

function heldPurchaseResponse() {
  let resolve = (_response: Response) => {};

  const promise = new Promise<Response>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

async function releasePurchase(gate: ReturnType<typeof heldPurchaseResponse>, response: Response) {
  await act(async () => {
    gate.resolve(response);
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
  });
}

async function selectPurchase(value = "Coffee") {
  const product = await screen.findByLabelText<HTMLInputElement>("Product");

  if (product.value === value) fireEvent.change(product, { target: { value: "" } });
  fireEvent.change(product, { target: { value } });

  if (value.startsWith("COFFEE-")) fireEvent.keyDown(product, { key: "Enter" });
  const amount = screen.getByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(document.activeElement).toBe(amount));

  return amount;
}

test("a failed fresh purchase read only logs, unlocks its draft and permits a new booking attempt", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = mount("/purchase?embedded&product=7");
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  app.holdDetails(
    Promise.resolve(Response.json({ error_message: "Fresh details unavailable" }, { status: 503 })),
  );
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(logged).toHaveBeenCalledOnce());
  expect(screen.queryByText("Fresh details unavailable")).toBeNull();
  expect(amount.matches(":disabled")).toBe(false);
  expect(amount.value).toBe("2");
  expect(app.writes.filter((row) => row.path.endsWith("/add"))).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Added 16 Pieces of Coffee to stock");
  expect(app.writes.filter((row) => row.path.endsWith("/add"))).toHaveLength(1);
});

test("barcode creation failure unlocks Purchase while fields continue and a second save books, prints and writes its own transaction", async () => {
  const first = heldPurchaseResponse();
  const second = heldPurchaseResponse();

  const app = mount(
    "/purchase?product=7&flow=InplaceAddBarcodeToExistingProduct&barcode=NEW-CODE&keep=one&keep=two&flag",
    {
      custom: true,
      labels: true,
      serverLabels: false,
      failBarcode: true,
      fieldResponse: (body) => (body.batch === "First batch" ? first.promise : second.promise),
    },
  );

  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  await userEvent.type(screen.getByLabelText("Batch"), "First batch");
  await userEvent.selectOptions(screen.getByLabelText("Stock entry label"), "1");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(app.writes.filter((row) => row.path.includes("/userfields/"))).toHaveLength(1),
  );
  await waitFor(() => expect(amount.matches(":disabled")).toBe(false));
  await screen.findByRole("button", {
    name: /Error while saving, probably this item already exists/,
  });
  expect(screen.queryByText("Added 16 Pieces of Coffee to stock")).toBeNull();
  await userEvent.clear(amount);
  await userEvent.type(amount, "3");
  await userEvent.clear(screen.getByLabelText("Batch"));
  await userEvent.type(screen.getByLabelText("Batch"), "Second batch");
  app.rename("Second coffee");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(app.writes.filter((row) => row.path.includes("/userfields/"))).toHaveLength(2),
  );
  expect(
    app.writes.filter((row) => row.path.endsWith("/add")).map((row) => row.body.amount),
  ).toEqual(["16.", "24."]);
  expect(app.writes.filter((row) => row.path.endsWith("/objects/product_barcodes"))).toHaveLength(
    2,
  );
  expect(app.writes.filter((row) => row.path.includes("/userfields/"))).toEqual([
    { path: "/api/userfields/stock/purchase-transaction", body: { batch: "First batch" } },
    { path: "/api/userfields/stock/purchase-transaction-2", body: { batch: "Second batch" } },
  ]);
  expect(app.writes.filter((row) => row.path === "/labels").map((row) => row.body)).toEqual([
    { product: "Coffee", grocycode: "grcy:p:7:purchase-stock", due_date: "DD: 2026-12-24" },
    {
      product: "Second coffee",
      grocycode: "grcy:p:7:purchase-stock-2",
      due_date: "DD: 2026-12-24",
    },
  ]);
  expect(app.detailReads.filter((row) => row.name === "Second coffee")).toHaveLength(1);
  await releasePurchase(first, Response.json({}));
  await screen.findByText("Added 16 Pieces of Coffee to stock");
  await releasePurchase(second, Response.json({}));
  await screen.findByText("Added 24 Pieces of Second coffee to stock");
  expect(app.router.history.location.search).toBe("?product=7&keep=one&keep=two&flag=");
});

test("Purchase captures raw amount, price and note but reads factor, price mode, dates and locations after its fresh GET", async () => {
  const details = heldPurchaseResponse();

  const app = mount(
    "/purchase?embedded&product=7&flow=InplaceAddBarcodeToExistingProduct&barcode=SNAPSHOT",
  );

  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  fireEvent.change(screen.getByLabelText("Price"), { target: { value: "4" } });
  await userEvent.click(screen.getByRole("radio", { name: "Saved box price" }));
  fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Captured note" } });
  app.holdDetails(details.promise);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(amount.matches(":disabled")).toBe(true);
  // External input updates during the request are distinct from its serialized form snapshot.
  fireEvent.change(amount, { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Price"), { target: { value: "99" } });
  fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Later note" } });
  fireEvent.change(screen.getByLabelText("Quantity unit"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("radio", { name: "Total price" }));
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Total price" }).checked).toBe(true);
  fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2030-02-03" } });
  fireEvent.change(screen.getByLabelText("Purchased date"), { target: { value: "2029-01-02" } });
  fireEvent.change(screen.getByLabelText("Store"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Location"), { target: { value: "2" } });
  await releasePurchase(details, app.detailsResponse());
  await waitFor(() => expect(app.writes.some((row) => row.path.endsWith("/add"))).toBe(true));
  expect(app.writes.find((row) => row.path.endsWith("/add"))?.body).toEqual({
    amount: "16.",
    price: "2.000",
    note: "Captured note",
    // Source BeginUiBusy disables Never; its unchecked freezer callback clicks into the clear branch.
    best_before_date: "",
    purchased_date: "2029-01-02",
    shopping_location_id: "2",
    location_id: "2",
  });
  expect(app.writes.find((row) => row.path.endsWith("/objects/product_barcodes"))?.body).toEqual({
    barcode: "SNAPSHOT",
    product_id: "7",
    qu_id: "3",
    amount: "2",
    note: "Captured note",
    shopping_location_id: "1",
  });
});

test("booking callbacks read the current barcode scanner state, price and first raw flow parameters while silent barcode-price failure leaves fields busy", async () => {
  const booking = heldPurchaseResponse();
  const field = heldPurchaseResponse();
  const barcode = heldPurchaseResponse();
  const parent = vi.fn();
  vi.stubGlobal("parent", { postMessage: parent });

  const app = mount("/purchase?embedded", {
    custom: true,
    bookingGate: booking.promise,
    fieldResponse: () => field.promise,
    usedBarcodeResponse: async () =>
      Response.json({ error_message: "Barcode price rejected" }, { status: 503 }),
    barcodeResponse: () => barcode.promise,
  });

  const amount = await selectPurchase("COFFEE-2");
  await userEvent.type(screen.getByLabelText("Batch"), "Live batch");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.writes.some((row) => row.path.endsWith("/add"))).toBe(true));
  // A scanner can update the picker before the older booking response arrives.
  const readsBeforeScan = app.detailReads.length;
  fireEvent.change(screen.getByLabelText("Product"), { target: { value: "COFFEE-3" } });
  fireEvent.keyDown(screen.getByLabelText("Product"), { key: "Enter" });
  await waitFor(() => expect(app.detailReads).toHaveLength(readsBeforeScan + 1));
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Price").value).toBe("9.000"));
  fireEvent.change(screen.getByLabelText("Price"), { target: { value: "12" } });
  await act(async () => {
    app.router.history.replace(
      "/purchase?embedded&flow=InplaceAddBarcodeToExistingProduct&flow=wrong&barcode=FIRST%2BRAW&barcode=second&listitemid",
    );
  });
  await releasePurchase(booking, Response.json({}));
  await waitFor(() =>
    expect(app.writes.some((row) => row.path.includes("/userfields/"))).toBe(true),
  );
  expect(app.writes.find((row) => row.path.endsWith("/product_barcodes/78"))?.body).toEqual({
    last_price: "12",
  });
  expect(app.writes.find((row) => row.path.endsWith("/objects/product_barcodes"))?.body).toEqual({
    barcode: "FIRST+RAW",
    product_id: "7",
    qu_id: "3",
    amount: "1.5",
    note: "Barcode note",
    shopping_location_id: "2",
  });
  expect(screen.queryByText("Barcode price rejected")).toBeNull();
  expect(
    screen.queryByRole("button", { name: /Error while saving, probably this item already exists/ }),
  ).toBeNull();
  expect(amount.matches(":disabled")).toBe(true);
  await releasePurchase(field, Response.json({}));
  await waitFor(() =>
    expect(parent.mock.calls.some(([bag]) => bag.Message === "AfterItemAdded")).toBe(true),
  );
  expect(parent.mock.calls.find(([bag]) => bag.Message === "AfterItemAdded")?.[0].Payload).toBe(
    true,
  );
  await releasePurchase(barcode, Response.json({}));
  await waitFor(() => expect(app.router.history.location.search).toBe(""));
  expect(app.router.history.location.pathname).toBe("/purchase");
});

test.each([true, false])(
  "Purchase chooses embedded completion at booking and reads current list item after the last field (embedded=%s)",
  async (embedded) => {
    const booking = heldPurchaseResponse();
    const field = heldPurchaseResponse();
    const parent = vi.fn();
    vi.stubGlobal("parent", { postMessage: parent });

    const app = mount("/purchase?embedded&product=7&listitemid=12", {
      custom: true,
      bookingGate: booking.promise,
      fieldResponse: () => field.promise,
    });

    const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
    await waitFor(() => expect(document.activeElement).toBe(amount));
    await userEvent.type(screen.getByLabelText("Batch"), "Live receipt");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(app.writes.some((row) => row.path.endsWith("/add"))).toBe(true));

    if (!embedded)
      await act(async () => {
        app.router.history.replace("/purchase?product=7&listitemid=12");
      });
    await releasePurchase(booking, Response.json({}));
    await waitFor(() =>
      expect(app.writes.some((row) => row.path.includes("/userfields/"))).toBe(true),
    );
    await act(async () => {
      app.router.history.replace(
        `/purchase?${embedded ? "" : "embedded&"}listitemid=01&listitemid=99&extra=kept`,
      );
    });
    await releasePurchase(field, Response.json({}));

    if (embedded) {
      await waitFor(() =>
        expect(parent.mock.calls.some(([bag]) => bag.Message === "AfterItemAdded")).toBe(true),
      );
      expect(parent.mock.calls.find(([bag]) => bag.Message === "AfterItemAdded")?.[0].Payload).toBe(
        "01",
      );
      expect(screen.queryByText("Added 16 Pieces of Coffee to stock")).toBeNull();
      expect(app.router.history.location.search).toBe("?listitemid=01&listitemid=99&extra=kept");
    } else {
      await screen.findByText("Added 16 Pieces of Coffee to stock");
      expect(parent.mock.calls.some(([bag]) => bag.Message === "AfterItemAdded")).toBe(false);
      expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("");
      expect(app.router.history.location.search).toBe(
        "?embedded=&listitemid=01&listitemid=99&extra=kept",
      );
    }
  },
);

test.each(["", "&flow=UnknownFlow"])(
  "direct Purchase always finishes query cleanup while preserving unrelated duplicate parameters: %s",
  async (flow) => {
    const app = mount(`/purchase?barcode=ORPHAN&product-name=Coffee&keep=one&keep=two&flag${flow}`);
    await selectPurchase();
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Added 16 Pieces of Coffee to stock");
    await waitFor(() =>
      expect(app.router.history.location.search).toBe("?keep=one&keep=two&flag="),
    );
  },
);

test("direct Purchase unlocks its next draft before a held product-card refresh completes", async () => {
  const refresh = heldPurchaseResponse();
  const app = mount("/purchase");
  await selectPurchase();
  app.holdRefresh(refresh.promise);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByText("Added 16 Pieces of Coffee to stock");
  await waitFor(() => expect(app.refreshReads()).toBeGreaterThan(0));
  const picker = screen.getByLabelText<HTMLInputElement>("Product");
  expect(picker.matches(":disabled")).toBe(false);
  await userEvent.type(picker, "Next draft");
  expect(picker.value).toBe("Next draft");
  await releasePurchase(refresh, app.detailsResponse());
  expect(picker.value).toBe("Next draft");
});

test.each([
  { initialDue: "2020-01-01", currentDue: "2040-01-01", warns: true },
  { initialDue: "2040-01-01", currentDue: "2020-01-01", warns: false },
])(
  "Purchase due-date warning uses the currently selected product on field completion (warn=$warns)",
  async ({ initialDue, currentDue, warns }) => {
    const field = heldPurchaseResponse();

    const app = mount(
      "/purchase?product=7&flow=InplaceAddBarcodeToExistingProduct&barcode=NEW-CODE",
      { custom: true, failBarcode: true, warnEarlier: true, fieldResponse: () => field.promise },
    );

    app.setNextDue(initialDue, currentDue);
    const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
    await waitFor(() => expect(document.activeElement).toBe(amount));
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2030-01-01" } });
    await userEvent.type(screen.getByLabelText("Batch"), "Waiting fields");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(amount.matches(":disabled")).toBe(false));
    await selectPurchase("Tare coffee");
    await releasePurchase(field, Response.json({}));
    await screen.findByText("Added 16 Pieces of Coffee to stock");
    const warning = screen.queryByText("This is due earlier than already in stock items");
    expect(!!warning).toBe(warns);

    if (warning) expect(warning.closest(".toast")?.getAttribute("data-tone")).toBe("warning");
  },
);

test.each(["create", "price"])(
  "departing Purchase aborts its independent barcode %s write",
  async (stage) => {
    const secondary = heldPurchaseResponse();
    const field = heldPurchaseResponse();

    const app = mount(
      stage === "create"
        ? "/purchase?product=7&flow=InplaceAddBarcodeToExistingProduct&barcode=NEW-CODE"
        : "/purchase?embedded",
      {
        custom: true,
        fieldResponse: () => field.promise,
        barcodeResponse: stage === "create" ? () => secondary.promise : undefined,
        usedBarcodeResponse: stage === "price" ? () => secondary.promise : undefined,
      },
    );

    if (stage === "price") await selectPurchase("COFFEE-2");
    else await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Amount")));
    await userEvent.type(screen.getByLabelText("Batch"), "Departed fields");
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(app.secondarySignals).toHaveLength(1));
    await act(async () => {
      await app.router.navigate({ to: "/about" });
    });
    await releasePurchase(
      secondary,
      stage === "create"
        ? Response.json({})
        : Response.json({ error_message: "Late barcode price error" }, { status: 503 }),
    );
    await releasePurchase(field, Response.json({}));
    expect(app.router.history.location.pathname).toBe("/about");
    expect(screen.queryByText("Late barcode price error")).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: /Error while saving, probably this item already exists/,
      }),
    ).toBeNull();
    expect(app.secondarySignals[0]?.aborted).toBe(true);
  },
);

test.each([true, false])(
  "Purchase date Clear only supplies a file binding when BBD is enabled (BBD=%s)",
  async (dates) => {
    const clear = heldPurchaseResponse();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const fields = [
      { ...stockFields[0]!, name: "before", caption: "Before file" },
      {
        ...stockFields[1]!,
        name: "attachment",
        caption: "Attachment",
        type: "file",
        input_required: 0,
      },
      { ...stockFields[2]!, name: "after", caption: "After file" },
    ];

    const app = mount("/purchase", {
      dates,
      customFields: fields,
      clearResponse: () => clear.promise,
    });

    await selectPurchase();
    await userEvent.type(screen.getByLabelText("Before file"), "Before");
    await userEvent.type(screen.getByLabelText("After file"), "After");
    const input = screen.getByLabelText<HTMLInputElement>("Attachment");
    const file = new File(["purchase attachment"], "Purchase.pdf", { type: "application/pdf" });
    await userEvent.upload(input, file);
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Added 16 Pieces of Coffee to stock");
    await waitFor(() => expect(app.clearReads()).toBe(1));
    expect(screen.getByLabelText<HTMLInputElement>("Product").value).toBe("");

    if (dates) expect(screen.getByLabelText<HTMLInputElement>("Due date").value).toBe("");
    else expect(screen.queryByLabelText("Due date")).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Before file").value).toBe("Before");
    expect(screen.getByLabelText<HTMLInputElement>("After file").value).toBe("After");
    await releasePurchase(clear, Response.json(fields));
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>("Before file").value).toBe(""),
    );
    expect(input.files?.[0]).toBe(file);
    expect(input.required).toBe(false);
    expect(within(input.parentElement!).queryByText("Purchase.pdf")).toBeNull();

    if (dates) {
      await waitFor(() =>
        expect(screen.getByLabelText<HTMLInputElement>("After file").value).toBe(""),
      );
      expect(
        within(input.parentElement!).getByRole("link", { name: "Show" }).getAttribute("href"),
      ).toBe("/files/userfiles/");
      expect(logged).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(logged).toHaveBeenCalledOnce());
      expect(String(logged.mock.calls[0]?.[0])).toContain("value is not defined");
      expect(screen.getByLabelText<HTMLInputElement>("After file").value).toBe("After");
      expect(within(input.parentElement!).queryByRole("link", { name: "Show" })).toBeNull();
    }
  },
);

test("Purchase normalizes its initial and selected default, converts after selection format, and retains the raw reset", async () => {
  const app = mount("/purchase", { purchaseDefault: "3.1415" });
  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  expect(amount.value).toBe("3.14");
  await selectPurchase("Coffee");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  expect(amount.value).toBe("3.14");
  expect(document.querySelector<HTMLInputElement>('input[name="amount"]')?.value).toBe("25.12");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.writes.some((write) => write.path.endsWith("/add"))).toBe(true));
  expect(app.writes.find((write) => write.path.endsWith("/add"))?.body.amount).toBe("25.12");
  await waitFor(() => expect(amount.value).toBe("3.1415"));
  expect(amount.validity.stepMismatch).toBe(true);
});

test.each([
  { barcodeUnit: 1, expectedAmount: "2.67", hint: null },
  { barcodeUnit: 3, expectedAmount: "21.4", hint: "This equals 21.4 Pieces" },
])(
  "Purchase details stay usable before a late barcode formats display after capturing QU $barcodeUnit",
  async ({ barcodeUnit, expectedAmount, hint }) => {
    let release!: (response: Response) => void;

    const barcode = new Promise<Response>((resolve) => {
      release = resolve;
    });

    const app = mount("/purchase?embedded", { barcodeLookup: barcode });
    const amount = await selectPurchase("COFFEE-2");
    await waitFor(() => expect(document.activeElement).toBe(amount));
    expect(amount.matches(":disabled")).toBe(false);
    expect(amount.value).toBe("2");
    expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("3");
    await act(async () =>
      release(
        Response.json([
          {
            id: 77,
            amount: 2.675,
            qu_id: barcodeUnit,
            shopping_location_id: 2,
            last_price: 9,
            note: "Late barcode",
          },
        ]),
      ),
    );
    await waitFor(() => expect(amount.value).toBe("2.68"));
    expect(document.querySelector<HTMLInputElement>('input[name="amount"]')?.value).toBe(
      expectedAmount,
    );

    if (hint) expect(screen.getByText(hint)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(app.writes.some((write) => write.path.endsWith("/add"))).toBe(true));
    expect(app.writes.find((write) => write.path.endsWith("/add"))?.body).toMatchObject({
      amount: expectedAmount,
      note: "Late barcode",
    });
  },
);

test("an optional Purchase barcode failure only logs after details and controls are ready", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  let release!: (response: Response) => void;

  const barcode = new Promise<Response>((resolve) => {
    release = resolve;
  });

  const app = mount("/purchase?embedded", { barcodeLookup: barcode });
  const amount = await selectPurchase("COFFEE-2");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  expect(amount.value).toBe("2");
  expect(amount.matches(":disabled")).toBe(false);
  await act(async () =>
    release(Response.json({ error_message: "Optional barcode unavailable" }, { status: 503 })),
  );
  await waitFor(() => expect(errors).toHaveBeenCalledOnce());
  expect(screen.queryByText("Optional barcode unavailable")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(amount.value).toBe("2");
  expect(app.writes).toEqual([]);
});

test("Purchase shopping auto-submit validates before later quantity normalization makes an overprecision prefill valid", async () => {
  const app = mount(
    "/purchase?embedded&product=7&flow=shoppinglistitemtostock&amount=2.675&quId=1",
    { shoppingAuto: true },
  );

  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  expect(amount.value).toBe("2.68");
  expect(document.querySelector<HTMLInputElement>('input[name="amount"]')?.value).toBe("2.68");
  expect(amount.validity.stepMismatch).toBe(false);
  expect(app.writes.filter((write) => write.path.endsWith("/add"))).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.writes.some((write) => write.path.endsWith("/add"))).toBe(true));
  expect(app.writes.find((write) => write.path.endsWith("/add"))?.body.amount).toBe("2.68");
});

test("Purchase scan submits the normalized barcode display with its earlier converted amount", async () => {
  const app = mount("/purchase", { scan: true, barcodeAmount: 2.675, barcodeUnit: 1 });
  const product = await screen.findByLabelText("Product");
  fireEvent.change(product, { target: { value: "COFFEE-2" } });
  await userEvent.type(product, "{Enter}");
  await waitFor(() => expect(app.writes.some((write) => write.path.endsWith("/add"))).toBe(true));
  expect(app.writes.find((write) => write.path.endsWith("/add"))?.body.amount).toBe("2.67");
});

test("older Purchase details still apply after a different product is selected", async () => {
  const app = mount("/purchase?embedded");
  const old = heldPurchaseResponse();
  app.holdDetails(old.promise);
  const product = await screen.findByLabelText<HTMLInputElement>("Product");
  fireEvent.change(product, { target: { value: "Coffee" } });
  await waitFor(() => expect(app.detailReads).toHaveLength(1));
  fireEvent.change(product, { target: { value: "Tare coffee" } });
  const amount = screen.getByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(amount.min).toBe("8"));
  await releasePurchase(old, app.detailsResponse(7));
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLSelectElement>("Quantity unit").value).toBe("3"),
  );
  expect(product.value).toBe("Tare coffee");
  expect(amount.min).toBe("0.01");
  expect(app.writes).toEqual([]);
});

test("price and price-type edits refresh a late barcode hint from the visible amount without regrouping its booking amount", async () => {
  const barcode = heldPurchaseResponse();
  const app = mount("/purchase?embedded", { barcodeLookup: barcode.promise });
  const amount = await selectPurchase("COFFEE-2");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  await releasePurchase(
    barcode,
    Response.json([
      {
        id: 77,
        amount: 2.675,
        qu_id: 1,
        shopping_location_id: 2,
        last_price: 26.75,
        note: "Late hint barcode",
      },
    ]),
  );
  await waitFor(() => expect(amount.value).toBe("2.68"));
  expect(screen.getByText("means 10.00 per Piece")).toBeTruthy();
  const price = screen.getByLabelText<HTMLInputElement>("Price");
  fireEvent.change(price, { target: { value: "53.6" } });
  expect(screen.getByText("means 20.00 per Piece")).toBeTruthy();
  expect(document.querySelector<HTMLInputElement>('input[name="amount"]')?.value).toBe("2.67");
  // A new actual barcode response restores its pre-format hint basis.
  await selectPurchase("COFFEE-2");
  await waitFor(() => expect(price.value).toBe("26.750"));
  expect(screen.getByText("means 10.00 per Piece")).toBeTruthy();
  await userEvent.click(screen.getByRole("radio", { name: "Piece price" }));
  expect(screen.queryByText(/^means /)).toBeNull();
  await userEvent.click(screen.getByRole("radio", { name: "Total price" }));
  expect(screen.getByText("means 9.98 per Piece")).toBeTruthy();
  fireEvent.change(price, { target: { value: "53.6" } });
  expect(screen.getByText("means 20.00 per Piece")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.writes.some((row) => row.path.endsWith("/add"))).toBe(true));
  expect(app.writes.find((row) => row.path.endsWith("/add"))?.body).toMatchObject({
    amount: "2.67",
    price: "20.000",
  });
});

test("Purchase currency leaves PRICE-disabled barcode metadata raw while its booking price stays zero", async () => {
  const app = mount("/purchase?embedded", {
    tracking: false,
    barcodePrice: 1.23456,
    barcodeUnit: 1,
  });

  const amount = await selectPurchase("COFFEE-2");
  await waitFor(() => expect(amount.value).toBe("1.5"));
  expect(screen.queryByLabelText("Price")).toBeNull();
  expect(screen.queryByRole("radio", { name: "Total price" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() =>
    expect(app.writes.some((row) => row.path.endsWith("/product_barcodes/77"))).toBe(true),
  );
  expect(app.writes.find((row) => row.path.endsWith("/add"))?.body.price).toBe(0);
  expect(app.writes.find((row) => row.path.endsWith("/product_barcodes/77"))?.body).toEqual({
    last_price: "1.23456",
  });
});

test("Purchase currency formats a late barcode price without refreshing its earlier hint until a real price or radio edit", async () => {
  const barcode = heldPurchaseResponse();

  const app = mount("/purchase?embedded", {
    barcodeLookup: barcode.promise,
    priceInputPrecision: 2,
    priceDisplayPrecision: 4,
  });

  const amount = await selectPurchase("COFFEE-2");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  await releasePurchase(
    barcode,
    Response.json([
      {
        id: 77,
        amount: 2.675,
        qu_id: 1,
        shopping_location_id: 2,
        last_price: 2.6751,
        note: "Currency barcode",
      },
    ]),
  );
  await waitFor(() => expect(amount.value).toBe("2.68"));
  const price = screen.getByLabelText<HTMLInputElement>("Price");
  expect(price.value).toBe("2.68");
  expect(price.validity.stepMismatch).toBe(false);
  expect(screen.getByText("means 1.0000 per Piece")).toBeTruthy();
  expect(document.querySelector<HTMLInputElement>('input[name="amount"]')?.value).toBe("2.67");
  fireEvent.change(price, { target: { value: "5.36" } });
  expect(screen.getByText("means 2.0000 per Piece")).toBeTruthy();
  await userEvent.click(screen.getByRole("radio", { name: "Piece price" }));
  expect(screen.queryByText(/^means /)).toBeNull();
  await userEvent.click(screen.getByRole("radio", { name: "Total price" }));
  expect(screen.getByText("means 2.0000 per Piece")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.writes.some((row) => row.path.endsWith("/add"))).toBe(true));
  expect(app.writes.find((row) => row.path.endsWith("/add"))?.body).toMatchObject({
    amount: "2.67",
    price: "2.00",
  });
});

test("Purchase currency refresh makes an overprecision barcode valid before scan submits its earlier hidden amount", async () => {
  const app = mount("/purchase", {
    scan: true,
    barcodeAmount: 2.675,
    barcodeUnit: 1,
    barcodePrice: 2.6751,
    priceInputPrecision: 2,
    priceDisplayPrecision: 4,
  });

  const product = await screen.findByLabelText("Product");
  fireEvent.change(product, { target: { value: "COFFEE-2" } });
  fireEvent.keyDown(product, { key: "Enter" });
  await waitFor(() => expect(app.writes.some((row) => row.path.endsWith("/add"))).toBe(true));
  expect(app.writes.filter((row) => row.path.endsWith("/add"))).toHaveLength(1);
  expect(app.writes.find((row) => row.path.endsWith("/add"))?.body).toMatchObject({
    amount: "2.67",
    price: "1.00",
  });
});

test("Purchase currency normalizes selected price only after the shopping auto-submit validity checkpoint", async () => {
  const app = mount("/purchase?embedded&product=7&flow=shoppinglistitemtostock&amount=2&quId=1", {
    shoppingAuto: true,
    lastPrice: 2.6751,
    priceInputPrecision: 2,
    priceDisplayPrecision: 4,
  });

  const amount = await screen.findByLabelText<HTMLInputElement>("Amount");
  await waitFor(() => expect(document.activeElement).toBe(amount));
  const price = screen.getByLabelText<HTMLInputElement>("Price");
  expect(price.value).toBe("2.68");
  expect(price.validity.stepMismatch).toBe(false);
  expect(app.writes.filter((row) => row.path.endsWith("/add"))).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.writes.some((row) => row.path.endsWith("/add"))).toBe(true));
  expect(app.writes.find((row) => row.path.endsWith("/add"))?.body).toMatchObject({
    amount: "2.",
    price: "1.34",
  });
});

test.each([true, false])(
  "Purchase global currency refresh saves rounded userfield edits independently of main PRICE tracking (%s)",
  async (tracking) => {
    const barcode = heldPurchaseResponse();

    const fields: UserfieldDefinition[] = [
      {
        id: 1,
        name: "fee",
        caption: "Fee",
        type: "number-currency",
        input_required: 0,
        default_value: null,
        config: null,
      },
      {
        id: 2,
        name: "ratio",
        caption: "Ratio",
        type: "number-decimal",
        input_required: 0,
        default_value: null,
        config: null,
      },
      {
        id: 3,
        name: "count",
        caption: "Count",
        type: "number-integral",
        input_required: 0,
        default_value: null,
        config: null,
      },
    ];

    const app = mount("/purchase?embedded", {
      tracking,
      customFields: fields,
      barcodeLookup: barcode.promise,
      priceInputPrecision: 2,
    });

    await selectPurchase("COFFEE-2");
    const fee = screen.getByLabelText<HTMLInputElement>("Fee");
    fireEvent.change(fee, { target: { value: "9.1234" } });
    fireEvent.change(screen.getByLabelText("Ratio"), { target: { value: "9.1234" } });
    fireEvent.change(screen.getByLabelText("Count"), { target: { value: "3" } });
    expect(fee.value).toBe("9.1234");
    expect(fee.validity.stepMismatch).toBe(false);
    await releasePurchase(
      barcode,
      Response.json([
        {
          id: 77,
          amount: 1,
          qu_id: 1,
          shopping_location_id: 2,
          last_price: 1.23456,
          note: "Fee refresh",
        },
      ]),
    );
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>("Note").value).toBe("Fee refresh"),
    );
    const displayedFee = fee.value;
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() =>
      expect(
        app.writes.some(
          (row) => row.path.includes("/userfields/") && Object.hasOwn(row.body, "fee"),
        ),
      ).toBe(true),
    );
    const savedFields = app.writes.filter((row) => row.path.includes("/userfields/"));
    expect(savedFields.find((row) => Object.hasOwn(row.body, "fee"))?.body).toEqual({
      fee: "9.12",
    });
    expect(displayedFee).toBe("9.12");
    expect(savedFields.find((row) => Object.hasOwn(row.body, "ratio"))?.body).toEqual({
      ratio: "9.1234",
    });
    expect(savedFields.find((row) => Object.hasOwn(row.body, "count"))?.body).toEqual({
      count: "3",
    });

    if (!tracking) {
      expect(screen.queryByLabelText("Price")).toBeNull();
      expect(app.writes.find((row) => row.path.endsWith("/add"))?.body.price).toBe(0);
      expect(app.writes.find((row) => row.path.endsWith("/product_barcodes/77"))?.body).toEqual({
        last_price: "1.23456",
      });
    }
  },
);
