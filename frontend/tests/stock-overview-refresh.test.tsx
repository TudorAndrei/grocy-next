import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { StockOverviewPage } from "@/components/StockOverviewPage";
import { Toaster } from "@/components/Toaster";
import { overviewFixture } from "./fixtures/stock-overview";
import type { OverviewProductRefresh } from "@/lib/stock-overview";
import { supportDialogs } from "./fixtures/dialogs";
import { EmbeddedHostMessages } from "@/components/EmbeddedHostMessages";

function mount({
  quick = 4,
  grouped = false,
  deferRefresh = false,
  unit = { name: "Piece", name_plural: "Pieces", plural_forms: null, active: 1 },
}: {
  quick?: number;
  grouped?: boolean;
  deferRefresh?: boolean;
  unit?: OverviewProductRefresh["quantity_unit_stock"];
} = {}) {
  let amount = 6;
  const pending: Array<() => void> = [];
  const signals: AbortSignal[] = [];
  vi.spyOn(window, "postMessage").mockImplementation((data) => {
    fireEvent(
      window,
      new MessageEvent("message", { origin: window.location.origin, source: window, data }),
    );
  });

  const initialView = overviewFixture([
    { product_id: 1, product: { name: "Tea" }, amount: 6, best_before_date: "2099-01-01" },
    {
      product_id: 2,
      product: { name: "Family" },
      amount: 0,
      amount_aggregated: 6,
      is_aggregated_amount: true,
      best_before_date: "2099-02-01",
    },
  ]);

  const view = {
    ...initialView,
    rows: initialView.rows.map((row) => ({ ...row, product_group_name: "Tea group" })),
  };

  Object.assign(view.rows[0]!, {
    quick_consume_amount: quick,
    quick_consume_amount_qu_consume: quick,
    parent_product_id: 2,
  });

  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/system/config") return Response.json({});

      if (path === "/api/user/settings")
        return Response.json(
          grouped
            ? {
                "datatables_rowGroup_stock-overview-table": JSON.stringify({
                  enable: true,
                  dataSrc: "2",
                }),
              }
            : {},
        );

      if (path === "/api/v2/user/permissions")
        return Response.json({ STOCK_CONSUME: true, STOCK_OPEN: true });

      if (path === "/api/v2/stock/overview") {
        if (amount === 6) return Response.json(view);

        const fresh = overviewFixture([
          {
            product_id: 1,
            product: { name: "Changed Tea" },
            amount,
            best_before_date: "2100-01-01",
          },
          {
            product_id: 2,
            product: { name: "Family" },
            amount: 0,
            amount_aggregated: amount,
            is_aggregated_amount: true,
            best_before_date: "2099-02-01",
          },
          { product_id: 3, product: { name: "New product" }, amount: 1 },
        ]);

        return Response.json(fresh);
      }

      const match = path.match(/^\/api\/stock\/products\/(1|2)$/);

      if (match) {
        if (init?.signal) signals.push(init.signal);
        const child = match[1] === "1";

        const response = Response.json({
          product: {
            id: Number(match[1]),
            parent_product_id: child ? 2 : null,
            min_stock_amount: 0,
            due_type: 1,
            disable_open: 0,
          },
          stock_amount: child ? amount : 0,
          stock_amount_aggregated: amount,
          stock_amount_opened: 0,
          stock_amount_opened_aggregated: 0,
          stock_value: amount * 2,
          next_due_date: child ? "2100-01-01" : "2099-02-01",
          is_aggregated_amount: child ? 0 : 1,
          quantity_unit_stock: unit,
        });

        if (child && deferRefresh)
          return new Promise<Response>((resolve) => pending.push(() => resolve(response)));

        return response;
      }

      if (path === "/api/stock/products/1/consume") {
        amount -= JSON.parse(String(init?.body)).amount;

        return Response.json([{ id: 7, transaction_id: "refresh-move" }]);
      }

      if (path === "/api/stock/transactions/refresh-move/undo") {
        amount = 6;

        return new Response(null, { status: 204 });
      }

      if (path === "/api/stock")
        return Response.json([{ value: amount * 2, product: { hide_on_stock_overview: 0 } }]);

      if (path.startsWith("/api/stock/volatile?"))
        return Response.json({
          due_products: [],
          overdue_products: [],
          expired_products: [],
          missing_products: [],
        });

      return Response.json([]);
    }),
  );

  const root = createRootRoute({
    component: () => (
      <Toaster>
        <EmbeddedHostMessages />
        <StockOverviewPage />
      </Toaster>
    ),
  });

  const mounted = render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider
        router={createRouter({
          routeTree: root,
          history: createMemoryHistory({ initialEntries: ["/"] }),
        })}
      />
    </QueryClientProvider>,
  );

  return {
    change: (next: number) => {
      amount = next;
    },
    pending,
    signals,
    unmount: mounted.unmount,
  };
}

test.each([false, true])(
  "same-origin product messages refresh stock, parent, and summary (broadcast=%s)",
  async (broadcast) => {
    const { change: externalChange } = mount();
    await screen.findByRole("link", { name: "Tea" });
    externalChange(2);
    const changed = { Message: "ProductChanged", Payload: "1" };
    fireEvent(
      window,
      new MessageEvent("message", {
        origin: window.location.origin,
        data: broadcast ? { Message: "BroadcastMessage", Payload: changed } : changed,
      }),
    );
    await waitFor(() => expect(document.getElementById("product-1-amount")?.textContent).toBe("2"));
    await waitFor(() =>
      expect(document.getElementById("product-2-amount-aggregated")?.textContent).toBe("2"),
    );
    await screen.findByText(
      `1 Product, ${(4).toLocaleString(undefined, { style: "currency", currency: "USD" })} total value`,
    );
    expect(screen.queryByRole("link", { name: "New product" })).toBeNull();
  },
);

test("foreign-origin and malformed product messages cannot issue authenticated product reads", async () => {
  mount();
  await screen.findByRole("link", { name: "Tea" });

  for (const [origin, data] of [
    ["https://foreign.example", { Message: "ProductChanged", Payload: 1 }],
    [window.location.origin, { Message: "ProductChanged", Payload: "not-an-id" }],
    [window.location.origin, { Message: "ProductChanged", Payload: true }],
    [window.location.origin, { Message: "BroadcastMessage", Payload: null }],
  ] as const)
    fireEvent(window, new MessageEvent("message", { origin, data }));
  expect(
    vi.mocked(fetch).mock.calls.filter(([path]) => String(path).startsWith("/api/stock/products/")),
  ).toHaveLength(0);
});

test("a native product refresh reveals a collapsed row until the next table draw", async () => {
  const { change: externalChange } = mount({ grouped: true });
  const user = userEvent.setup();
  const group = await screen.findByRole("button", { name: "Tea group" });
  await user.click(group);
  expect(document.getElementById("product-1-row")?.style.display).toBe("none");
  externalChange(2);
  fireEvent(
    window,
    new MessageEvent("message", {
      origin: window.location.origin,
      data: { Message: "ProductChanged", Payload: 1 },
    }),
  );
  await waitFor(() => expect(document.getElementById("product-1-amount")?.textContent).toBe("2"));
  expect(document.getElementById("product-1-row")?.style.display).toBe("");
  expect(group.getAttribute("aria-expanded")).toBe("false");
  await user.type(screen.getByRole("searchbox", { name: "Search stock" }), "Tea");
  expect(document.getElementById("product-1-row")?.style.display).toBe("none");
});

test("overlapping product reads apply in completion order as in the native callbacks", async () => {
  const { change, pending } = mount({ deferRefresh: true });
  await screen.findByRole("link", { name: "Tea" });

  for (const amount of [2, 4]) {
    change(amount);
    fireEvent(
      window,
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { Message: "ProductChanged", Payload: 1 },
      }),
    );
  }

  await waitFor(() => expect(pending).toHaveLength(2));
  await act(async () => pending[1]!());
  await waitFor(() => expect(document.getElementById("product-1-amount")?.textContent).toBe("4"));
  await act(async () => pending[0]!());
  await waitFor(() => expect(document.getElementById("product-1-amount")?.textContent).toBe("2"));
});

test("a reply after a table draw reveals the refreshed collapsed row until another draw", async () => {
  const { change, pending } = mount({ grouped: true, deferRefresh: true });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Tea group" }));
  change(2);
  fireEvent(
    window,
    new MessageEvent("message", {
      origin: window.location.origin,
      data: { Message: "ProductChanged", Payload: 1 },
    }),
  );
  await waitFor(() => expect(pending).toHaveLength(1));
  const search = screen.getByRole("searchbox", { name: "Search stock" });
  await user.type(search, "Tea");
  await act(async () => pending[0]!());
  await waitFor(() => expect(document.getElementById("product-1-amount")?.textContent).toBe("2"));
  expect(document.getElementById("product-1-row")?.style.display).toBe("");
  await user.clear(search);
  expect(document.getElementById("product-1-row")?.style.display).toBe("none");
});

test("leaving the overview removes its product-message listener", async () => {
  const { unmount } = mount();
  await screen.findByRole("link", { name: "Tea" });
  unmount();
  fireEvent(
    window,
    new MessageEvent("message", {
      origin: window.location.origin,
      data: { Message: "ProductChanged", Payload: 1 },
    }),
  );
  expect(
    vi.mocked(fetch).mock.calls.filter(([path]) => String(path).startsWith("/api/stock/products/")),
  ).toHaveLength(0);
});

test("table reset cancels old reads and a late response cannot replace the new snapshot", async () => {
  supportDialogs();
  const { change, pending, signals } = mount({ deferRefresh: true });
  const user = userEvent.setup();
  await screen.findByRole("link", { name: "Tea" });
  change(2);
  fireEvent(
    window,
    new MessageEvent("message", {
      origin: window.location.origin,
      data: { Message: "ProductChanged", Payload: 1 },
    }),
  );
  await waitFor(() => expect(pending).toHaveLength(1));
  change(4);
  await user.click(screen.getByRole("button", { name: "Table options" }));
  await user.click(screen.getByRole("button", { name: "Reset" }));
  await user.click(screen.getByRole("button", { name: "Yes" }));
  await screen.findByRole("link", { name: "Changed Tea" });
  await act(async () => pending[0]!());
  expect(document.getElementById("product-1-amount")?.textContent).toBe("4");
  expect(signals[0]?.aborted).toBe(true);
  expect(
    vi.mocked(fetch).mock.calls.filter(([path]) => String(path) === "/api/stock/products/2"),
  ).toHaveLength(0);
});

test("page departure aborts pending reads and prevents their follow-up parent requests", async () => {
  const { pending, signals, unmount } = mount({ deferRefresh: true });
  await screen.findByRole("link", { name: "Tea" });
  fireEvent(
    window,
    new MessageEvent("message", {
      origin: window.location.origin,
      data: { Message: "ProductChanged", Payload: 1 },
    }),
  );
  await waitFor(() => expect(pending).toHaveLength(1));
  unmount();
  await act(async () => pending[0]!());
  expect(signals[0]?.aborted).toBe(true);
  expect(
    vi.mocked(fetch).mock.calls.filter(([path]) => String(path) === "/api/stock/products/2"),
  ).toHaveLength(0);
});

test("booking refresh retains rows, cached search and sort values, and initial action amounts while refreshing a parent", async () => {
  mount();
  const user = userEvent.setup();
  const consume = await screen.findByRole("button", { name: "Consume 4 Piece of Tea" });
  await user.click(consume);
  await waitFor(() => expect(document.getElementById("product-1-amount")?.textContent).toBe("2"));
  await waitFor(() =>
    expect(document.getElementById("product-2-amount-aggregated")?.textContent).toBe("2"),
  );
  expect(
    Array.from(document.querySelectorAll("td.stock-name a")).map((node) => node.textContent),
  ).toEqual(["Tea", "Family"]);
  expect(consume.hasAttribute("disabled")).toBe(false);
  await user.type(screen.getByRole("searchbox", { name: "Search stock" }), "6");
  expect(screen.getByRole("link", { name: "Tea" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Family" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Next due date" }));
  expect(
    Array.from(document.querySelectorAll("td.stock-name a")).map((node) => node.textContent),
  ).toEqual(["Family", "Tea"]);
});

test.each([0, 1])(
  "refreshed unit text uses browser number formatting and active unit forms (active=%s)",
  async (active) => {
    mount({
      quick: 4.76544,
      unit: {
        name: "%s stock unit",
        name_plural: "%s stock units",
        plural_forms: "%s custom units",
        active,
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Consume 4.7654 Piece of Tea" }));
    await waitFor(() =>
      expect(document.getElementById("product-1-qu-name")?.textContent).toBe(
        `${(1.23456).toLocaleString()} ${active ? "custom units" : "stock units"}`,
      ),
    );
  },
);

test("consume all hides the native row in place and undo restores it", async () => {
  mount();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Consume all Tea which are currently in stock" }),
  );
  await waitFor(() => expect(document.getElementById("product-1-row")?.hidden).toBe(true));
  expect(document.getElementById("product-1-amount")?.textContent).toBe("6");
  await user.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() => expect(document.getElementById("product-1-row")?.hidden).toBe(false));
  expect(screen.getByRole("link", { name: "Tea" })).toBeTruthy();
});
