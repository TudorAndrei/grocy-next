import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import { overviewFixture } from "./fixtures/stock-overview";
import { supportDialogs } from "./fixtures/dialogs";
import type { JsonValue } from "@/lib/json";

function send(data: { Message: string; Payload: JsonValue }, origin = window.location.origin) {
  fireEvent(window, new MessageEvent("message", { origin, data }));
}

function mount(initialPath = "/stock", undoError?: string) {
  let amount = 2;
  const undone = new Set<string>();
  const writes: string[] = [];
  vi.stubGlobal("scrollTo", vi.fn());
  // jsdom omits the origin for own-window delivery; browsers supply it.
  vi.spyOn(window, "postMessage").mockImplementation((data) => {
    fireEvent(
      window,
      new MessageEvent("message", { origin: window.location.origin, source: window, data }),
    );
  });
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (path === "/api/user") return Response.json([{ id: 1, username: "test" }]);

      if (path === "/api/v2/user/permissions")
        return Response.json({ SHOPPINGLIST_ITEMS_ADD: true });

      if (path.startsWith("/api/v2/localization"))
        return Response.json({
          locale: "en",
          direction: "ltr",
          languages: ["en"],
          catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
        });

      if (path === "/api/system/config" || path === "/api/user/settings") return Response.json({});

      if (path === "/api/objects/chores")
        return Response.json([{ id: 1, name: "Water plants", period_type: "manually", active: 1 }]);

      if (path === "/api/objects/batteries")
        return Response.json([{ id: 1, name: "Camera battery", active: 1 }]);

      if (path === "/api/objects/chores_log" || path === "/api/objects/battery_charge_cycles") {
        const chore = path.endsWith("chores_log");

        const undoPath = chore
          ? "/api/chores/executions/17/undo"
          : "/api/batteries/charge-cycles/19/undo";

        return Response.json([
          {
            id: chore ? 17 : 19,
            chore_id: chore ? 1 : null,
            battery_id: chore ? null : 1,
            tracked_time: "2026-01-02 03:04:00",
            undone: undone.has(undoPath) ? 1 : 0,
          },
        ]);
      }

      if (
        init?.method === "POST" &&
        (path === "/api/chores/executions/17/undo" ||
          path === "/api/batteries/charge-cycles/19/undo")
      ) {
        writes.push(path);

        if (undoError) return Response.json({ error_message: undoError }, { status: 400 });

        undone.add(path);

        return new Response(null, { status: 204 });
      }

      if (path === "/api/v2/stock/overview")
        return Response.json(
          overviewFixture([{ product_id: 1, product: { name: "Tea" }, amount }]),
        );

      if (path === "/api/v2/stock/entries")
        return Response.json({
          products: [{ id: 1, name: "Tea" }],
          locations: [],
          stores: [],
          rows: [],
        });

      if (path === "/api/stock/bookings/undefined/undo") {
        writes.push(path);

        return Response.json({ error_message: "Invalid native booking ID" }, { status: 500 });
      }

      if (path === "/api/stock")
        return Response.json([{ value: amount, product: { hide_on_stock_overview: 0 } }]);

      if (path.startsWith("/api/stock/volatile?"))
        return Response.json({
          due_products: [],
          overdue_products: [],
          expired_products: [],
          missing_products: [],
        });

      if (path.startsWith("/api/v2/shopping-lists/")) return Response.json({ items: [] });

      if (path === "/api/stock/transactions/tx-1/undo" || path === "/api/stock/bookings/23/undo") {
        writes.push(path);
        amount = 6;

        return new Response(null, { status: 204 });
      }

      if (path === "/api/stock/transactions/tx-1") return Response.json([{ product_id: 1 }]);

      if (path === "/api/stock/products/1")
        return Response.json({
          product: {
            id: 1,
            parent_product_id: null,
            min_stock_amount: 0,
            due_type: 1,
            disable_open: 0,
          },
          stock_amount: amount,
          stock_amount_aggregated: amount,
          stock_amount_opened: 0,
          stock_amount_opened_aggregated: 0,
          stock_value: amount,
          next_due_date: null,
          is_aggregated_amount: 0,
          quantity_unit_stock: {
            name: "Piece",
            name_plural: "Pieces",
            plural_forms: null,
            active: 1,
          },
        });

      if (init?.method === "POST") writes.push(path);

      return Response.json([]);
    }),
  );

  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { writes, router };
}

test.each(["'tx-1'", "&quot;tx-1&quot;"])(
  "embedded success receipts retain formatting and undo refreshes stock (%s)",
  async (argument) => {
    const { writes } = mount();
    await screen.findByRole("link", { name: "Tea" });
    send({
      Message: "ShowSuccessMessage",
      Payload: `Booked <strong>pantry tea</strong><br><a href="#" onclick="UndoStockTransaction(${argument})">Undo</a><img src="/unexpected" onerror="alert(1)"><script>alert(2)</script>`,
    });
    const notice = await screen.findByRole("status", { name: "Notifications" });
    await within(notice).findByText("pantry tea");
    expect(notice.querySelector("strong")?.textContent).toBe("pantry tea");
    expect(notice.querySelector("img,script,[onclick]")).toBeNull();
    await userEvent.setup().click(within(notice).getByRole("button", { name: "Undo" }));
    await screen.findByText("Transaction successfully undone");
    await waitFor(() => expect(document.getElementById("product-1-amount")?.textContent).toBe("6"));
    expect(writes).toEqual(["/api/stock/transactions/tx-1/undo"]);
  },
);

test("product relation messages leave unrelated stock workflows open", async () => {
  supportDialogs();
  mount();
  await screen.findByRole("link", { name: "Tea" });
  await userEvent.setup().click(screen.getByRole("button", { name: "Table options" }));
  send({ Message: "ProductBarcodesChanged", Payload: null });
  send({ Message: "ProductQUConversionChanged", Payload: null });
  expect(screen.getByRole("dialog", { name: "Table options" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Tea" })).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "Error details" })).toBeNull();
});

test.each([
  { command: "UndoStockBookingEntry(23,12, 1)", amount: "6" },
  { command: "UndoStockBookingEntry('23','12')", amount: "2" },
])(
  "a booking receipt undoes one booking and broadcasts only its supplied product ($command)",
  async ({ command, amount }) => {
    const { writes } = mount();
    await screen.findByRole("link", { name: "Tea" });
    send({
      Message: "ShowSuccessMessage",
      Payload: `Removed tea<br><a href="#" onclick="${command}">Undo</a>`,
    });
    const notice = screen.getByRole("status", { name: "Notifications" });
    await userEvent.setup().click(within(notice).getByRole("button", { name: "Undo" }));
    await within(notice).findByText("Booking successfully undone");
    await waitFor(() =>
      expect(document.getElementById("product-1-amount")?.textContent).toBe(amount),
    );
    expect(writes).toEqual(["/api/stock/bookings/23/undo"]);
  },
);

test.each([
  { path: "/stockentries", title: "Stock entries", requests: 2 },
  { path: "/barcodescannertesting", title: "Barcode scanner testing", requests: 0 },
])(
  "native entry receipt retains its broken Undo behavior in $path",
  async ({ path, title, requests }) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { writes } = mount(path);
    await screen.findByRole("heading", { name: title });
    send({
      Message: "ShowSuccessMessage",
      Payload:
        "Stock entry successfully updated<br><a href=\"#\" onclick=\"UndoStockBookingEntry('undefined','12')\">Undo</a>",
    });
    const notice = screen.getByRole("status", { name: "Notifications" });
    const undo = within(notice).getByRole("button", { name: "Undo" });
    const user = userEvent.setup();
    await user.click(undo);
    await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(undo.matches(":disabled")).toBe(false));
    await user.click(undo);
    await waitFor(() => expect(error).toHaveBeenCalledTimes(2));
    expect(writes).toEqual(
      Array.from({ length: requests }, () => "/api/stock/bookings/undefined/undo"),
    );
    expect(notice.textContent).toContain("Stock entry successfully updated");
    expect(notice.textContent).not.toContain("Invalid native booking ID");
    expect(notice.textContent).not.toContain("Booking successfully undone");
    expect(notice.querySelector("[onclick]")).toBeNull();
  },
);

test("receipts ignore foreign senders and never turn arbitrary inline code into an undo action", async () => {
  const { writes } = mount();
  await screen.findByRole("link", { name: "Tea" });
  send({ Message: "ShowSuccessMessage", Payload: "Forged receipt" }, "https://foreign.example");
  expect(screen.queryByText("Forged receipt")).toBeNull();
  send({
    Message: "ShowSuccessMessage",
    Payload:
      '<a href="javascript:alert(1)" onclick="UndoStockTransaction(\'tx-1\');alert(2)">Receipt text</a>',
  });
  const notice = screen.getByRole("status", { name: "Notifications" });
  await within(notice).findByText("Receipt text");
  expect(within(notice).queryByRole("button", { name: "Undo" })).toBeNull();
  expect(notice.querySelector("a,[onclick]")).toBeNull();
  expect(writes).toHaveLength(0);
});

test.each([
  {
    tab: "Chores",
    name: "Water plants",
    command: "UndoChoreExecution(17)",
    path: "/api/chores/executions/17/undo",
    success: "Chore execution successfully undone",
  },
  {
    tab: "Batteries",
    name: "Camera battery",
    command: "UndoChargeCycle(19)",
    path: "/api/batteries/charge-cycles/19/undo",
    success: "Charge cycle successfully undone",
  },
])("embedded $tab undo updates the visible household history", async (receipt) => {
  const { writes } = mount("/household");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: receipt.tab }));
  await screen.findByRole("heading", { name: receipt.name });
  const history = (await screen.findByText(new RegExp(`${receipt.name} recorded`))).closest("li");

  if (!history) throw new Error("The household history entry is missing.");

  expect(within(history).getByRole<HTMLButtonElement>("button", { name: "Undo" }).disabled).toBe(
    false,
  );
  send({
    Message: "ShowSuccessMessage",
    Payload: `Recorded <strong>${receipt.name}</strong> <a href="#" onclick="${receipt.command}">Undo</a>`,
  });
  const notice = screen.getByRole("status", { name: "Notifications" });
  await user.click(await within(notice).findByRole("button", { name: "Undo" }));
  await within(notice).findByText(receipt.success);
  await waitFor(() => expect(history.textContent).toContain("(undone)"));
  expect(within(history).queryByRole("button", { name: "Undo" })).toBeNull();
  expect(writes).toEqual([receipt.path]);
});

test("household receipt actions reject invalid IDs and appended commands", async () => {
  const { writes } = mount();
  await screen.findByRole("link", { name: "Tea" });

  for (const command of [
    "UndoChoreExecution(-1)",
    "UndoChoreExecution(0)",
    "UndoChargeCycle(1.5)",
    "UndoChargeCycle(9007199254740992)",
    "UndoChoreExecution(17);alert(1)",
    "UndoStockBookingEntry('undefined','12');alert(1)",
    "UndoStockBookingEntry('undefined','12',1)",
    "UndoStockBookingEntry(23,12,0)",
    "UndoStockBookingEntry(23,12,1);alert(1)",
  ]) {
    send({
      Message: "ShowSuccessMessage",
      Payload: `<a href="#" onclick="${command}">Unrecognized receipt</a>`,
    });
    const notice = screen.getByRole("status", { name: "Notifications" });
    expect(within(notice).queryByRole("button", { name: "Undo" })).toBeNull();
    expect(notice.querySelector("[onclick]")).toBeNull();
  }

  expect(writes).toEqual([]);
});

test.each([
  { close: "host", hold: "write" },
  { close: "Escape", hold: "write" },
  { close: "host", hold: "refresh" },
  { close: "Escape", hold: "refresh" },
])(
  "$close closes a busy shopping dialog without its late $hold closing a new draft",
  async ({ close, hold }) => {
    supportDialogs();
    const { writes } = mount();
    const transport = fetch;
    let release: (() => void) | undefined;
    let started = false;
    let finished = false;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const path = String(input);

        if (path === "/api/v2/shopping-lists/items/editor")
          return Response.json({
            item: null,
            lists: [{ id: 1, name: "Shopping list" }],
            products: [{ id: 1, name: "Tea", qu_id_stock: 1, qu_id_purchase: 1 }],
            units: [{ id: 1, name: "Piece", name_plural: "Pieces" }],
            conversions: [],
            fields: [],
            values: {},
          });

        if (path === "/api/stock/shoppinglist/add-product" && init?.method === "POST") {
          writes.push(path);

          if (hold === "write") {
            started = true;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            finished = true;
          }

          return new Response(null, { status: 204 });
        }

        if (path === "/api/stock" && writes.length > 0 && hold === "refresh") {
          started = true;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          finished = true;
        }

        if (path.startsWith("/api/objects/shopping_list?")) return Response.json([{ id: 51 }]);

        return transport(input, init);
      }),
    );
    onTestFinished(() => release?.());
    await screen.findByRole("link", { name: "Tea" });
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "More actions for Tea" });
    await user.click(trigger);
    // jsdom does not implement popover activation.
    const menu = screen.getByLabelText<HTMLDivElement>("More actions for Tea", { selector: "div" });
    menu.style.display = "block";
    menu.hidePopover = () => {
      menu.style.display = "none";
    };

    await user.click(within(menu).getByRole("button", { name: "Add to shopping list" }));

    const dialog = await screen.findByRole<HTMLDialogElement>("dialog", {
      name: "Create shopping list item",
    });

    await within(dialog).findByRole("spinbutton", { name: "Amount" });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(started).toBe(true));
    send({ Message: "CloseLastModal", Payload: null }, "https://foreign.example");
    expect(dialog.open).toBe(true);

    if (close === "host") send({ Message: "CloseLastModal", Payload: null });
    else fireEvent(dialog, new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.style.overflow).not.toBe("hidden");
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    menu.style.display = "block";
    await user.click(within(menu).getByRole("button", { name: "Add to shopping list" }));
    const next = await screen.findByRole("dialog", { name: "Create shopping list item" });
    const note = await within(next).findByRole<HTMLTextAreaElement>("textbox", { name: "Note" });
    await user.type(note, "Second draft");
    await act(async () => release?.());
    await waitFor(() => expect(finished).toBe(true));
    expect(writes).toEqual(["/api/stock/shoppinglist/add-product"]);
    expect(screen.getByRole("dialog", { name: "Create shopping list item" })).toBe(next);
    expect(note.value).toBe("Second draft");
  },
);

test("a rejected household undo reports the API error without claiming success or retrying", async () => {
  const { writes } = mount("/household", "Execution cannot be undone");
  await screen.findByText(/Water plants recorded/);
  send({
    Message: "ShowSuccessMessage",
    Payload: '<a href="#" onclick="UndoChoreExecution(17)">Undo</a>',
  });
  const notice = screen.getByRole("status", { name: "Notifications" });
  await userEvent.setup().click(within(notice).getByRole("button", { name: "Undo" }));
  await within(notice).findByText("Execution cannot be undone");
  expect(within(notice).queryByRole("button", { name: "Undo" })).toBeNull();
  expect(screen.queryByText("Chore execution successfully undone")).toBeNull();
  expect(screen.getByText(/Water plants recorded/).textContent).not.toContain("(undone)");
  expect(writes).toEqual(["/api/chores/executions/17/undo"]);
});

test("native Reset confirmation respects foreign senders, custom Escape workflows, and trigger focus", async () => {
  supportDialogs();
  mount();
  await screen.findByRole("link", { name: "Tea" });
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "Table options" });
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "Reset" }));
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  send({ Message: "CloseLastModal", Payload: null }, "https://foreign.example");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  const custom = document.createElement("dialog");
  custom.className = "custom-escape-key-handling";
  custom.setAttribute("aria-label", "Custom escape workflow");
  document.body.appendChild(custom);
  custom.showModal();
  onTestFinished(() => custom.remove());
  send({ Message: "CloseLastModal", Payload: null });
  expect(custom.open).toBe(true);
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", {
        name: "Are you sure you want to reset the table options?",
      }),
    ).toBeNull(),
  );
  custom.remove();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test("iframe modal messages preserve the URL, dialog type, stack, and restored focus", async () => {
  supportDialogs();
  mount();
  await screen.findByRole("link", { name: "Tea" });
  const trigger = screen.getByRole("button", { name: "Table options" });
  trigger.focus();
  send({
    Message: "IframeModal",
    Payload: { Link: "/purchase?embedded&product=1", DialogType: "form" },
  });
  const purchase = await screen.findByRole("dialog", { name: "Purchase" });
  const first = within(purchase).getByTitle<HTMLIFrameElement>("Purchase");
  expect(new URL(first.src).pathname + new URL(first.src).search).toBe(
    "/purchase?embedded&product=1",
  );
  expect(purchase.classList.contains("form")).toBe(true);
  first.focus();
  send({
    Message: "IframeModal",
    Payload: { Link: "/stockentries?embedded&product=1", DialogType: "table" },
  });
  const entries = await screen.findByRole("dialog", { name: "Stock entries" });
  expect(entries.classList.contains("table")).toBe(true);
  send({ Message: "CloseLastModal", Payload: null });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Stock entries" })).toBeNull());
  expect(document.activeElement).toBe(first);
  send({ Message: "CloseLastModal", Payload: null });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

test("a newly hosted stock frame closes before the already open parent dialog", async () => {
  supportDialogs();
  mount();
  await screen.findByRole("link", { name: "Tea" });
  const trigger = screen.getByRole("button", { name: "Table options" });
  const user = userEvent.setup();
  await user.click(trigger);
  const parent = screen.getByRole("dialog");
  const reset = within(parent).getByRole("button", { name: "Reset" });
  reset.focus();
  send({
    Message: "IframeModal",
    Payload: { Link: "/stockentries?embedded&product=1", DialogType: "table" },
  });
  await screen.findByTitle("Stock entries");
  send({ Message: "CloseLastModal", Payload: null });
  await waitFor(() => expect(screen.queryByTitle("Stock entries")).toBeNull());
  expect(screen.getByRole("dialog")).toBe(parent);
  expect(document.activeElement).toBe(reset);
  send({ Message: "CloseLastModal", Payload: null });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

test("closing a peer frame restores the focused control inside the earlier frame", async () => {
  supportDialogs();
  mount();
  await screen.findByRole("link", { name: "Tea" });
  send({ Message: "IframeModal", Payload: { Link: "/purchase?embedded" } });

  const first = within(
    await screen.findByRole("dialog", { name: "Purchase" }),
  ).getByTitle<HTMLIFrameElement>("Purchase");

  const doc = first.contentDocument!;

  if (!doc.body)
    (doc.documentElement ?? doc.appendChild(doc.createElement("html"))).appendChild(
      doc.createElement("body"),
    );
  const control = doc.createElement("button");
  control.textContent = "Open stock journal";
  doc.body.appendChild(control);
  control.focus();
  expect(document.activeElement).toBe(first);
  send({
    Message: "IframeModal",
    Payload: { Link: "/stockjournal?embedded", DialogType: "table" },
  });
  const peer = await screen.findByRole("dialog", { name: "Stock journal" });
  await userEvent.setup().click(within(peer).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByTitle("Stock journal")).toBeNull());
  expect(document.activeElement).toBe(first);
  expect(doc.activeElement).toBe(control);
});

test.each([
  ["?embedded", true],
  ["?embedded=0", true],
  ["?embedded=&embedded", false],
  ["?embedded=%", false],
] as const)("embedded document dismissal follows the first raw flag %s", async (query, close) => {
  const parent = vi.fn();
  vi.stubGlobal("parent", { postMessage: parent });
  mount("/barcodescannertesting" + query);
  await screen.findByRole("heading", { name: "Barcode scanner testing" });
  const button = screen.queryByRole("button", { name: "Close" });
  expect(Boolean(button)).toBe(close);

  if (button) {
    await userEvent.setup().click(button);
    expect(parent).toHaveBeenCalledWith(
      { Message: "CloseLastModal", Payload: null },
      window.location.origin,
    );
  }

  parent.mockClear();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(parent).toHaveBeenCalledTimes(query === "?embedded=%" ? 0 : 1);
});

test.each(["Purchase", "Consume", "Inventory", "Transfer"])(
  "the embedded %s route has one Close control and emits one dismissal per Escape",
  async (title) => {
    const parent = vi.fn();
    vi.stubGlobal("parent", { postMessage: parent });
    mount(`/${title.toLowerCase()}?embedded`);
    await screen.findByRole("heading", { name: title });
    parent.mockClear();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(parent.mock.calls).toEqual([
      [{ Message: "CloseLastModal", Payload: null }, window.location.origin],
    ]);
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
  },
);

test("responsive frames resize on load, resize messages, window resize, and fullscreen", async () => {
  supportDialogs();
  mount();
  await screen.findByRole("link", { name: "Tea" });
  send({ Message: "IframeModal", Payload: { Link: "/purchase?embedded" } });

  const frame = within(
    await screen.findByRole("dialog", { name: "Purchase" }),
  ).getByTitle<HTMLIFrameElement>("Purchase");

  const doc = frame.contentDocument;

  if (!doc) throw new Error("The iframe document is unavailable.");

  if (!doc.body)
    (doc.documentElement ?? doc.appendChild(doc.createElement("html"))).appendChild(
      doc.createElement("body"),
    );
  let height = 420;
  Object.defineProperty(doc.body, "scrollHeight", { configurable: true, get: () => height });
  fireEvent.load(frame);
  expect(frame.getAttribute("height")).toBe("420px");
  height = 610;
  send({ Message: "ResizeResponsiveEmbeds", Payload: null }, "https://foreign.example");
  expect(frame.getAttribute("height")).toBe("420px");
  send({ Message: "ResizeResponsiveEmbeds", Payload: null });
  expect(frame.getAttribute("height")).toBe("610px");
  height = 710;
  fireEvent(window, new Event("resize"));
  expect(frame.getAttribute("height")).toBe("710px");
  vi.spyOn(document.body, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 900));
  document.body.classList.add("fullscreen-card");
  onTestFinished(() => document.body.classList.remove("fullscreen-card"));
  send({ Message: "ResizeResponsiveEmbeds", Payload: null });
  expect(frame.getAttribute("height")).toBe("900px");
});

test("broadcasts reach every live responsive child and are handled once in this page", async () => {
  supportDialogs();
  mount();
  await screen.findByRole("link", { name: "Tea" });
  send({ Message: "IframeModal", Payload: { Link: "/purchase?embedded" } });

  const first = within(
    await screen.findByRole("dialog", { name: "Purchase" }),
  ).getByTitle<HTMLIFrameElement>("Purchase");

  send({ Message: "IframeModal", Payload: { Link: "/consume?embedded" } });

  const second = within(
    await screen.findByRole("dialog", { name: "Consume" }),
  ).getByTitle<HTMLIFrameElement>("Consume");

  if (!first.contentWindow || !second.contentWindow) throw new Error("Missing iframe windows.");
  const firstSend = vi.spyOn(first.contentWindow, "postMessage").mockImplementation(() => {});
  const secondSend = vi.spyOn(second.contentWindow, "postMessage").mockImplementation(() => {});

  const bag = {
    Message: "BroadcastMessage",
    Payload: { Message: "ShowSuccessMessage", Payload: "Broadcast receipt" },
  };

  send(bag, "https://foreign.example");
  expect(firstSend).not.toHaveBeenCalled();
  expect(secondSend).not.toHaveBeenCalled();
  send(bag);
  expect(firstSend).toHaveBeenCalledWith(bag, window.location.origin);
  expect(secondSend).toHaveBeenCalledWith(bag, window.location.origin);
  expect(await screen.findAllByText("Broadcast receipt")).toHaveLength(1);
  send({ Message: "CloseLastModal", Payload: null });
  await waitFor(() => expect(document.querySelector('iframe[title="Consume"]')).toBeNull());
  send(bag);
  expect(firstSend).toHaveBeenCalledTimes(2);
  expect(secondSend).toHaveBeenCalledTimes(1);
});

test("iframe modal commands reject active URL schemes and foreign senders", async () => {
  supportDialogs();
  mount();
  await screen.findByRole("link", { name: "Tea" });
  send(
    { Message: "IframeModal", Payload: { Link: "/purchase?embedded" } },
    "https://foreign.example",
  );
  send({ Message: "IframeModal", Payload: { Link: "javascript:alert(1)" } });
  send({ Message: "IframeModal", Payload: { Link: "data:text/html,unsafe" } });
  expect(document.querySelector("iframe.embed-responsive")).toBeNull();
});

test("leaving a page with nested iframe dialogs removes both frames and restores page scrolling", async () => {
  supportDialogs();
  const originalOverflow = document.body.style.overflow;
  onTestFinished(() => {
    document.body.style.overflow = originalOverflow;
  });
  const { router } = mount();
  await screen.findByRole("link", { name: "Tea" });
  send({ Message: "IframeModal", Payload: { Link: "/purchase?embedded" } });
  within(await screen.findByRole("dialog", { name: "Purchase" })).getByTitle<HTMLIFrameElement>(
    "Purchase",
  );
  send({ Message: "IframeModal", Payload: { Link: "/consume?embedded" } });
  within(await screen.findByRole("dialog", { name: "Consume" })).getByTitle<HTMLIFrameElement>(
    "Consume",
  );
  expect(document.body.style.overflow).toBe("hidden");
  await act(async () => {
    await router.navigate({ to: "/stockentries" });
  });
  await waitFor(() => expect(document.querySelector("iframe.embed-responsive")).toBeNull());
  expect(document.body.style.overflow).toBe(originalOverflow);
});

test("responsive PDF embeds use the native available height and resize-done marker", async () => {
  mount();
  await screen.findByRole("link", { name: "Tea" });
  const embed = document.createElement("embed");
  embed.className = "embed-responsive";
  const navigation = document.createElement("nav");
  navigation.id = "mainNav";
  document.body.append(embed, navigation);
  onTestFinished(() => {
    embed.remove();
    navigation.remove();
    document.body.classList.remove("fullscreen-card");
  });

  const bodyHeight = vi
    .spyOn(document.body, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(0, 0, 1000, 900));

  vi.spyOn(navigation, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 100));
  send({ Message: "ResizeResponsiveEmbeds", Payload: null });
  expect(embed.getAttribute("height")).toBe("738px");
  expect(embed.classList.contains("resize-done")).toBe(true);
  bodyHeight.mockReturnValue(new DOMRect(0, 0, 1000, 1000));
  send({ Message: "ResizeResponsiveEmbeds", Payload: null });
  expect(embed.getAttribute("height")).toBe("738px");
  embed.classList.remove("resize-done");
  document.body.classList.add("fullscreen-card");
  send({ Message: "ResizeResponsiveEmbeds", Payload: null });
  expect(embed.getAttribute("height")).toBe("1000px");
});
