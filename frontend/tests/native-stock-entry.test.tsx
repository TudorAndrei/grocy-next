import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { getNativeEntryEditor, type EntryEditor } from "@/lib/stock-entry-editor";
import type { UserfieldDefinition } from "@/lib/userfields";
import type { JsonObject } from "@/lib/json";
import { mountNativeEditor } from "./fixtures/native-editor";

function deferred() {
  let release = (_response: Response) => {};

  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });

  return { release, promise };
}

const first: UserfieldDefinition = {
  id: 1,
  name: "first",
  caption: "First field",
  type: "text-single-line",
  input_required: 0,
  default_value: null,
  config: null,
};

const last: UserfieldDefinition = { ...first, id: 2, name: "last", caption: "Last field" };

const certificate: UserfieldDefinition = {
  ...last,
  name: "certificate",
  caption: "Certificate",
  type: "file",
};

function mount(
  path = "/stockentry/0051?embedded",
  options: {
    fields?: UserfieldDefinition[];
    holdPrimary?: boolean;
    denyPrimary?: boolean;
    holdField?: string;
    failField?: string;
    holdUpload?: boolean;
    holdLabel?: boolean;
    labelFailure?: boolean;
    webhookFailure?: boolean;
    printer?: boolean;
    priceTracking?: boolean;
    price?: number | null;
    basepath?: string;
    holdUnit?: boolean;
    entry?: Partial<EntryEditor["entry"]>;
    values?: EntryEditor["values"];
    locationTracking?: boolean;
    openedTracking?: boolean;
    dates?: boolean;
  } = {},
) {
  const data: EntryEditor = {
    entry: {
      id: 51,
      product_id: 7,
      stock_id: "stock-old",
      product_name: "Coffee",
      qu_name: "Piece",
      amount: 2.5,
      best_before_date: "2027-01-01",
      purchased_date: "2026-11-01",
      price: options.price === undefined ? 1.23456 : options.price,
      location_id: 2,
      shopping_location_id: 3,
      note: "Saved note",
      open: 0,
      ...options.entry,
    },
    locations: [{ id: 2, name: "Shelf" }],
    stores: [{ id: 3, name: "Corner shop" }],
    fields: options.fields ?? [],
    values: options.values ?? {},
  };

  const primary = deferred();
  const field = deferred();
  const upload = deferred();
  const label = deferred();
  const unit = deferred();
  const unitSignals: Array<AbortSignal | null | undefined> = [];
  const reads: string[] = [];
  const writes: { path: string; body: JsonObject; signal?: AbortSignal | null }[] = [];

  const files: { path: string; body: BodyInit | null | undefined; signal?: AbortSignal | null }[] =
    [];

  const hooks: RequestInit[] = [];
  let denied = options.denyPrimary;
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => logger.mockRestore());
  const messages = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  onTestFinished(() => messages.mockRestore());

  const app = mountNativeEditor(
    path,
    async (url, init) => {
      if (url === `/api/userfields/stock/${data.entry.stock_id}` && !init?.method)
        return Response.json(data.values);

      if (url === "/api/system/info")
        return Response.json({
          grocy_version: { Version: "4.5.0", ReleaseDate: "" },
          php_version: "",
          python_version: "3",
          sqlite_version: "3",
          db_version: 1,
          os: "test",
          client: "test",
        });

      if (url === "/api/user/settings")
        return Response.json({
          stock_decimal_places_amounts: 2,
          stock_decimal_places_prices_input: 3,
        });

      if (url === "/api/stock/products/7") {
        unitSignals.push(init?.signal);

        return options.holdUnit
          ? unit.promise
          : Response.json({ quantity_unit_stock: { name: "Piece" } });
      }

      if (url.startsWith("/api/v2/shopping-lists/")) return Response.json({ items: [] });

      if (
        url.startsWith("/api/v2/stock/entries/native-editor?") ||
        url === "/api/v2/stock/entries/51/editor"
      ) {
        reads.push(url);
        const row = new URL(url, "http://grocy.test").searchParams.get("row");

        return row !== null && !["51", "0051", "+51", "51e0", "51\0tail%ZZ"].includes(row)
          ? Response.json({ error_message: "Stock entry not found" }, { status: 404 })
          : Response.json(data);
      }

      if (url === "/api/stock/entry/51" && init?.method === "PUT") {
        writes.push({ path: url, body: JSON.parse(String(init.body)), signal: init.signal });

        if (options.holdPrimary) return primary.promise;

        if (denied) return Response.json({ error_message: "Edit denied" }, { status: 403 });

        return Response.json([
          { id: 901, product_id: 7, stock_id: "stock-new", transaction_id: "transaction-new" },
        ]);
      }

      if (url === "/api/userfields/stock/transaction-new" && init?.method === "PUT") {
        const body: JsonObject = JSON.parse(String(init.body));
        writes.push({ path: url, body, signal: init.signal });

        if (Object.hasOwn(body, options.holdField ?? "")) return field.promise;

        if (Object.hasOwn(body, options.failField ?? ""))
          return Response.json({ error_message: "Metadata failed" }, { status: 503 });

        return new Response(null, { status: 204 });
      }

      if (url.startsWith("/api/files/userfiles/") && init?.method === "PUT") {
        files.push({ path: url, body: init.body, signal: init.signal });

        return options.holdUpload ? upload.promise : new Response(null, { status: 204 });
      }

      if (url === "/api/stock/entry/stock-new/printlabel") {
        reads.push(url);

        if (options.holdLabel) return label.promise;

        return options.labelFailure
          ? Response.json({ error_message: "Label read failed" }, { status: 503 })
          : Response.json({ stock_id: "stock-new" });
      }

      if (url === "https://printer.test/label") {
        hooks.push(init ?? {});

        return new Response(null, { status: options.webhookFailure ? 503 : 204 });
      }

      return undefined;
    },
    {
      FEATURE_FLAG_STOCK: true,
      FEATURE_FLAG_STOCK_LOCATION_TRACKING: options.locationTracking ?? true,
      FEATURE_FLAG_STOCK_PRICE_TRACKING: options.priceTracking ?? true,
      FEATURE_FLAG_STOCK_PRODUCT_OPENED_TRACKING: options.openedTracking ?? true,
      FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: options.dates ?? true,
      FEATURE_FLAG_LABEL_PRINTER: options.printer ?? false,
      LABEL_PRINTER_RUN_SERVER: false,
      LABEL_PRINTER_WEBHOOK: "https://printer.test/label",
      LABEL_PRINTER_HOOK_JSON: true,
    },
    { basepath: options.basepath },
  );

  return {
    ...app,
    data,
    primary,
    field,
    upload,
    label,
    unit,
    unitSignals,
    reads,
    writes,
    files,
    hooks,
    logger,
    allowPrimary: () => {
      denied = false;
    },
    messages: () =>
      messages.mock.calls.filter(([bag]) =>
        ["BroadcastMessage", "ShowSuccessMessage", "Ready", "CloseLastModal"].includes(bag.Message),
      ),
  };
}

const booking = () =>
  Response.json([
    { id: 901, product_id: 7, stock_id: "stock-new", transaction_id: "transaction-new" },
  ]);

test("native stock entry dispatches dirty fields in parallel and completes on the last callback with the exact parent protocol", async () => {
  const app = mount("/stockentry/0051", { fields: [first, last], holdField: "first" });
  const user = userEvent.setup();
  await screen.findByRole("spinbutton", { name: /^Amount/ });
  await user.type(screen.getByLabelText("First field"), "Early");
  await user.type(screen.getByLabelText("Last field"), "Final");
  await user.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.writes).toHaveLength(3));
  await waitFor(() => expect(app.messages()).toHaveLength(4));
  expect(app.writes.map((write) => [write.path, write.body])).toEqual([
    [
      "/api/stock/entry/51",
      {
        amount: "2.5",
        best_before_date: "2027-01-01",
        purchased_date: "2026-11-01",
        note: "Saved note",
        price: "1.235",
        open: false,
        location_id: "2",
        shopping_location_id: "3",
      },
    ],
    ["/api/userfields/stock/transaction-new", { first: "Early" }],
    ["/api/userfields/stock/transaction-new", { last: "Final" }],
  ]);
  expect(app.messages()).toEqual([
    [
      { Message: "BroadcastMessage", Payload: { Message: "ProductChanged", Payload: 7 } },
      window.location.origin,
    ],
    [
      {
        Message: "ShowSuccessMessage",
        Payload:
          'Stock entry successfully updated<br><a class="btn btn-secondary btn-sm mt-2" href="#" onclick="UndoStockBookingEntry(\'undefined\',\'51\')"><i class="fa-solid fa-undo"></i> Undo</a>',
      },
      window.location.origin,
    ],
    [{ Message: "Ready", Payload: null }, window.location.origin],
    [{ Message: "CloseLastModal", Payload: null }, window.location.origin],
  ]);
  expect(app.reads[0]).toBe("/api/v2/stock/entries/native-editor?row=0051");
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(true);
  await act(async () => {
    app.field.release(Response.json({ error_message: "Earlier field failed" }, { status: 503 }));
  });
  expect(screen.getByLabelText<HTMLInputElement>("First field").value).toBe("Early");
  expect(screen.queryByText("Earlier field failed")).toBeNull();
  expect(app.messages()).toHaveLength(4);
  expect(app.router.state.location.pathname).toBe("/stockentry/0051");
});

test("native stock-entry fields mark unchanged Arrow values and read live custom textarea LF only after PUT", async () => {
  const notes: UserfieldDefinition = {
    ...last,
    name: "notes",
    caption: "Custom notes",
    type: "text-multi-line",
  };

  const clean: UserfieldDefinition = { ...first, id: 3, name: "clean", caption: "Clean field" };

  const app = mount(undefined, {
    fields: [first, notes, clean],
    values: { first: "Retained", notes: "Initial notes", clean: "Untouched" },
    holdPrimary: true,
  });

  const user = userEvent.setup();
  const unchanged = await screen.findByLabelText<HTMLInputElement>("First field");
  await user.click(unchanged);
  await user.keyboard("{ArrowLeft}");
  expect(unchanged.value).toBe("Retained");
  const textarea = screen.getByLabelText<HTMLTextAreaElement>("Custom notes");
  await user.clear(textarea);
  await user.type(textarea, "Before primary");
  await user.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(textarea.matches(":disabled")).toBe(true);
  // Controlled disabled-DOM assignment isolates the source .val() read after PUT.
  // This is not presented as natural user editing while the form is busy.
  textarea.value = "Live\r\nCustom line";
  await act(async () => app.primary.release(booking()));
  await waitFor(() => expect(app.messages()).toHaveLength(4));
  expect(app.writes.filter((write) => write.path.includes("/userfields/"))).toEqual([
    expect.objectContaining({
      path: "/api/userfields/stock/transaction-new",
      body: { first: "Retained" },
    }),
    expect.objectContaining({
      path: "/api/userfields/stock/transaction-new",
      body: { notes: "Live\nCustom line" },
    }),
  ]);
  expect(screen.getByLabelText<HTMLInputElement>("Clean field").value).toBe("Untouched");
});

test("native stock-entry Note saves its imported single-line DOM text while preserving explicit body types", async () => {
  const app = mount(undefined, { entry: { note: "Imported\r\nNote\rText", open: 1 } });
  const note = await screen.findByLabelText<HTMLInputElement>("Note");
  expect(note.value).toBe("ImportedNoteText");
  expect(screen.getByLabelText<HTMLInputElement>("Opened").checked).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.messages()).toHaveLength(4));
  expect(app.writes[0]!.body).toEqual({
    amount: "2.5",
    best_before_date: "2027-01-01",
    purchased_date: "2026-11-01",
    note: "ImportedNoteText",
    price: "1.235",
    open: true,
    location_id: "2",
    shopping_location_id: "3",
  });
});

test.each([
  [999, -1, null],
  [null, 0, ""],
] as const)(
  "native saved Store %s preserves initial selection %s and submits its exact null-or-empty getter",
  async (savedStore, index, expected) => {
    const app = mount(undefined, { entry: { shopping_location_id: savedStore } });
    const user = userEvent.setup();
    const store = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Store" });
    expect(store.selectedIndex).toBe(index);
    await user.type(screen.getByLabelText("Note"), " draft");
    expect(store.selectedIndex).toBe(index);
    await user.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(app.messages()).toHaveLength(4));
    expect(app.writes[0]!.body.shopping_location_id).toBe(expected);
  },
);

test("native inactive Store recovery preserves a real selection through rerender and permits explicit empty selection", async () => {
  const app = mount(undefined, { entry: { shopping_location_id: 999 }, denyPrimary: true });
  const user = userEvent.setup();
  const store = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Store" });
  expect(store.selectedIndex).toBe(-1);
  await user.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.logger).toHaveBeenCalled());
  expect(app.writes[0]!.body.shopping_location_id).toBeNull();
  await user.selectOptions(store, "3");
  await user.type(screen.getByLabelText("Note"), " changed");
  expect(store.value).toBe("3");
  expect(store.selectedIndex).toBe(1);
  await user.selectOptions(store, "");
  app.allowPrimary();
  await user.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.messages()).toHaveLength(4));
  expect(app.writes).toHaveLength(2);
  expect(app.writes[1]!.body.shopping_location_id).toBe("");
});

test("an earlier failed stock-entry field settles after native completion and retirement without retaining a fresh cached reader", async () => {
  const app = mount(undefined, { fields: [first, last], holdField: "first" });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("First field"), "Earlier");
  await user.type(screen.getByLabelText("Last field"), "Last");
  await user.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.messages()).toHaveLength(4));
  await act(async () => app.router.navigate({ href: "/settings?tab=connection" }));
  await screen.findByRole("heading", { level: 1, name: "Settings" });

  const reader = {
    queryKey: ["native-stock-entry-editor", "0051"],
    queryFn: ({ signal }: { signal: AbortSignal }) => getNativeEntryEditor("0051", signal),
    staleTime: Infinity,
  };

  const before = await app.client.fetchQuery(reader);
  expect(before.entry.id).toBe(51);
  expect(app.client.getQueryState(reader.queryKey)?.isInvalidated).toBe(false);
  const reads = app.reads.length;
  await act(async () =>
    app.field.release(Response.json({ error_message: "Earlier field failed" }, { status: 503 })),
  );
  await waitFor(() => expect(app.client.getQueryState(reader.queryKey)?.isInvalidated).toBe(true));
  expect(app.reads).toHaveLength(reads);
  expect(app.router.state.location.pathname).toBe("/settings");
  expect(screen.queryByText("Earlier field failed")).toBeNull();
  expect(app.messages()).toHaveLength(4);
  expect(app.logger).not.toHaveBeenCalled();
  expect(app.writes.find((write) => Object.hasOwn(write.body, "first"))?.signal?.aborted).toBe(
    true,
  );
});

test.each(["success", "failure", "departure"])(
  "the native initial unit read is independent and handles %s without a stale context label",
  async (outcome) => {
    const app = mount(undefined, { holdUnit: true });
    app.data.entry.qu_name = "Old context unit";
    const amount = await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Amount" });
    await waitFor(() => expect(app.unitSignals).toHaveLength(1));
    expect(screen.queryByText("Old context unit")).toBeNull();
    expect(amount.matches(":disabled")).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(false);
    await userEvent.type(screen.getByLabelText("Note"), " available before unit");
    expect(screen.getByLabelText<HTMLInputElement>("Note").value).toBe(
      "Saved note available before unit",
    );

    if (outcome === "departure") {
      await act(async () =>
        app.router.navigate({ to: "/settings", search: { tab: "connection" } }),
      );
      await screen.findByRole("heading", { level: 1, name: "Settings" });
    }

    await act(async () => {
      app.unit.release(
        outcome === "failure"
          ? Response.json({ error_message: "Unit unavailable" }, { status: 503 })
          : Response.json({ quantity_unit_stock: { name: "Fresh units" } }),
      );
    });

    if (outcome === "success") {
      await screen.findByRole("spinbutton", { name: "Amount Fresh units" });
      expect(app.logger).not.toHaveBeenCalled();
    } else if (outcome === "failure") {
      await waitFor(() => expect(app.logger).toHaveBeenCalled());
      expect(screen.getByRole("spinbutton", { name: "Amount" })).toBe(amount);
      expect(screen.queryByText("Unit unavailable")).toBeNull();
      expect(screen.queryByRole("button", { name: "Retry stock entry" })).toBeNull();
    } else {
      expect(app.unitSignals[0]?.aborted).toBe(true);
      expect(screen.queryByText("Fresh units")).toBeNull();
      expect(app.logger).not.toHaveBeenCalled();
      expect(app.router.state.location.pathname).toBe("/settings");
    }

    expect(app.writes).toEqual([]);
    expect(app.messages()).toEqual([]);
  },
);

test.each([false, true])(
  "the last native file upload gates completion and upload failure=%s retains busy state",
  async (failure) => {
    const app = mount(undefined, { fields: [first, certificate], holdUpload: true });
    const user = userEvent.setup();
    await screen.findByRole("spinbutton", { name: /^Amount/ });
    await user.type(screen.getByLabelText("First field"), "Saved first");
    const file = new File(["pdf"], "Certificate.PDF", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("Certificate"), file);
    await user.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(app.files).toHaveLength(1));
    expect(app.messages()).toEqual([]);
    const metadata = String(app.writes[2]!.body.certificate);
    expect(app.files[0]!.path).toBe(
      `/api/files/userfiles/${encodeURIComponent(metadata.split("_")[0]!)}`,
    );
    expect(app.files[0]!.body).toBe(file);
    await act(async () => {
      app.upload.release(new Response(null, { status: failure ? 503 : 204 }));
    });

    if (failure) {
      await screen.findByText("Error while saving, probably this item already exists");
      expect(app.messages()).toEqual([]);
    } else await waitFor(() => expect(app.messages()).toHaveLength(4));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(true);
    expect(app.writes.filter((write) => write.path === "/api/stock/entry/51")).toHaveLength(1);
  },
);

test("a failed last metadata callback silently retains the committed entry and offers no native retry", async () => {
  const app = mount(undefined, { fields: [last], failField: "last" });
  await screen.findByRole("spinbutton", { name: /^Amount/ });
  await userEvent.type(screen.getByLabelText("Last field"), "Metadata");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.writes).toHaveLength(2));
  await act(async () => {});
  expect(app.messages()).toEqual([]);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(true);
  expect(screen.queryByText("Metadata failed")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(document.body.classList.contains("cursor-busy")).toBe(true);
});

test("a denied primary save unlocks the native draft and a cleared-price retry preserves the source global value", async () => {
  const app = mount(undefined, { denyPrimary: true });
  const user = userEvent.setup();
  await screen.findByRole("spinbutton", { name: /^Amount/ });
  await user.type(screen.getByLabelText("Note"), " draft");
  await user.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.logger).toHaveBeenCalled());
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(false);
  expect(screen.getByLabelText<HTMLInputElement>("Note").value).toBe("Saved note draft");
  expect(screen.queryByText("Edit denied")).toBeNull();
  expect(app.messages()).toEqual([]);
  await user.clear(screen.getByLabelText("Price"));
  app.allowPrimary();
  await user.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.messages()).toHaveLength(4));
  expect(app.writes.map((write) => write.body.price)).toEqual(["1.235", "1.235"]);
});

test.each([true, false])(
  "first empty price with price-tracking=%s preserves the source numeric business value",
  async (priceTracking) => {
    const app = mount(undefined, {
      priceTracking,
      price: null,
      locationTracking: priceTracking,
      openedTracking: priceTracking,
      dates: priceTracking,
    });

    await screen.findByRole("spinbutton", { name: /^Amount/ });
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(app.messages()).toHaveLength(4));
    expect(app.writes[0]!.body.price).toEqual(priceTracking ? {} : "0.000");

    if (!priceTracking) {
      expect(app.writes[0]!.body).toMatchObject({
        location_id: 1,
        open: false,
        best_before_date: "2027-01-01",
        purchased_date: "2026-11-01",
      });
      expect(Object.hasOwn(app.writes[0]!.body, "shopping_location_id")).toBe(false);
      expect(screen.getByLabelText("Due date").closest("[hidden]")).not.toBeNull();
      expect(screen.queryByLabelText("Opened")).toBeNull();
    }
  },
);

test("a held independent label read cannot delay fields or start a webhook after departure", async () => {
  const app = mount(undefined, { printer: true, holdLabel: true, fields: [last] });
  await screen.findByRole("spinbutton", { name: /^Amount/ });
  await userEvent.type(screen.getByLabelText("Last field"), "Label independent");
  await userEvent.click(screen.getByLabelText("Reprint stock entry label"));
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.messages()).toHaveLength(4));
  expect(app.reads).toContain("/api/stock/entry/stock-new/printlabel");
  expect(app.writes[1]!.body).toEqual({ last: "Label independent" });
  expect(app.hooks).toHaveLength(0);
  await act(async () => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
  await act(async () => {
    app.label.release(Response.json({ stock_id: "stock-new" }));
  });
  expect(app.hooks).toHaveLength(0);
  expect(app.messages()).toHaveLength(4);
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
});

test.each(["read", "webhook"])(
  "native label %s failure keeps completion independent and uses its source error handling",
  async (stage) => {
    const app = mount(undefined, {
      printer: true,
      labelFailure: stage === "read",
      webhookFailure: stage === "webhook",
    });

    await screen.findByRole("spinbutton", { name: /^Amount/ });
    await userEvent.click(screen.getByLabelText("Reprint stock entry label"));
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(app.messages()).toHaveLength(4));

    if (stage === "webhook") await screen.findByText("Error while executing WebHook");
    else {
      await act(async () => {});
      expect(screen.queryByText("Label read failed")).toBeNull();
      expect(screen.queryByText("Error while executing WebHook")).toBeNull();
    }

    expect(app.hooks).toHaveLength(stage === "webhook" ? 1 : 0);
  },
);

test.each(["primary", "field"])(
  "departing during a held %s prevents subsequent stages but marks settled stock data stale",
  async (stage) => {
    const app = mount(undefined, {
      holdPrimary: stage === "primary",
      holdField: stage === "field" ? "certificate" : undefined,
      fields: [certificate],
    });

    await screen.findByRole("spinbutton", { name: /^Amount/ });
    await userEvent.upload(
      screen.getByLabelText("Certificate"),
      new File(["pdf"], "late.pdf", { type: "application/pdf" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(app.writes).toHaveLength(stage === "primary" ? 1 : 2));
    await act(async () => app.router.navigate({ to: "/settings", search: { tab: "connection" } }));
    const key = ["stock", "replacement-proof"];
    app.client.setQueryData(key, ["new owner"]);
    await act(async () => {
      (stage === "primary" ? app.primary : app.field).release(
        stage === "primary" ? booking() : new Response(null, { status: 204 }),
      );
    });
    expect(app.client.getQueryData(key)).toEqual(["new owner"]);
    expect(app.client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(app.writes).toHaveLength(stage === "primary" ? 1 : 2);
    expect(app.files).toHaveLength(0);
    expect(app.messages()).toEqual([]);
    expect(app.writes.at(-1)!.signal?.aborted).toBe(true);
    expect(app.router.state.location.pathname).toBe("/settings");
  },
);

test("missing raw stock-entry identities show a controlled read error without a fallback create form", async () => {
  const app = mount("/stockentry/missing?embedded");
  await screen.findByText("Stock entry not found");
  expect(app.reads[0]).toBe("/api/v2/stock/entries/native-editor?row=missing");
  expect(screen.queryByRole("button", { name: "OK" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  expect(app.writes).toEqual([]);
});

test.each([
  ["%2535%2531", "51", true],
  ["%252B51", "+51", true],
  ["51%2500tail%ZZ", "51\0tail%ZZ", true],
  ["%252535%252531", "%35%31", false],
  ["%252F", "/", false],
  ["0x33", "0x33", false],
  ["51&bad", "51&bad", false],
  ["51%26bad%2500tail", "51&bad\0tail", false],
] as const)(
  "native selected path %s preserves exactly the two source argument decodes",
  async (raw, expected, found) => {
    const app = mount(`/stockentry/${raw}?embedded`);

    if (found) await screen.findByRole("spinbutton", { name: /^Amount/ });
    else await screen.findByText("Stock entry not found");
    expect(app.reads).toEqual([
      `/api/v2/stock/entries/native-editor?row=${encodeURIComponent(expected)}`,
    ]);
    expect(app.router.history.location.href).toBe(`/stockentry/${raw}?embedded`);
    expect(app.writes).toEqual([]);
  },
);

test("a slash decoded before source route matching cannot select an entry", async () => {
  const app = mount("/stockentry/%2F?embedded");
  await screen.findByText("Object not found");
  expect(app.reads).toEqual([]);
  expect(app.writes).toEqual([]);
});

test("a malformed native identity retains its configured prefix, script alias, and physical manifest URL", async () => {
  const path = "/house.hold/index.php/stockentry/51%2500tail%ZZ?embedded&marker=%26value";
  const app = mount(path, { basepath: "/house.hold" });
  await screen.findByRole("spinbutton", { name: /^Amount/ });
  expect(app.reads).toEqual(["/api/v2/stock/entries/native-editor?row=51%00tail%25ZZ"]);
  expect(app.router.history.location.href).toBe(path);
  await waitFor(() => {
    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    expect(manifest).not.toBeNull();
    const encoded = new URL(manifest!.href).searchParams.get("data")!;

    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0)),
    );

    expect(decoded).toBe(`Edit stock entry#${window.location.origin}${path}`);
  });
});
