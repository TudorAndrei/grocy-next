import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { StockOverviewPage } from "@/components/StockOverviewPage";
import { Toaster } from "@/components/Toaster";
import { overviewFixture } from "./fixtures/stock-overview";
import { supportDialogs } from "./fixtures/dialogs";

function mount(
  view: ReturnType<typeof overviewFixture>,
  options: {
    allowed?: boolean;
    allowOpen?: boolean;
    opening?: boolean;
    fail?: boolean;
    failDetails?: boolean;
    moveOnOpen?: boolean;
    moveLocation?: string | null;
  } = {},
) {
  const writes: {
    path: string;
    body: { amount: number; spoiled?: boolean; allow_subproduct_substitution: boolean };
  }[] = [];

  let saved = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);

      if (path === "/api/system/config")
        return Response.json({
          FEATURE_FLAG_STOCK_PRODUCT_OPENED_TRACKING: options.opening ?? true,
        });

      if (path === "/api/user/settings") return Response.json({});

      if (path === "/api/stock")
        return Response.json(
          view.rows
            .filter((row) => row.amount_aggregated > 0)
            .map((row) => ({ value: row.amount * 2, product: { hide_on_stock_overview: 0 } })),
        );

      if (path.startsWith("/api/stock/volatile?"))
        return Response.json({
          due_products: [],
          overdue_products: [],
          expired_products: [],
          missing_products: [],
        });

      if (path === "/api/stock/products/1") {
        if (options.failDetails)
          return Response.json({ error_message: "Product read failed" }, { status: 503 });
        const row = view.rows[0]!;

        return Response.json({
          product: {
            id: 1,
            move_on_open: options.moveOnOpen ? 1 : 0,
            parent_product_id: null,
            min_stock_amount: row.min_stock_amount,
            due_type: row.due_type,
            disable_open: row.disable_open,
          },
          stock_amount: row.amount,
          stock_amount_aggregated: row.amount_aggregated,
          stock_amount_opened: row.amount_opened,
          stock_amount_opened_aggregated: row.amount_opened_aggregated,
          stock_value: row.amount * 2,
          next_due_date: row.best_before_date,
          is_aggregated_amount: row.is_aggregated_amount,
          quantity_unit_stock: {
            name: "Piece",
            name_plural: "Pieces",
            plural_forms: null,
            active: 1,
          },
          default_consume_location:
            options.moveLocation == null ? null : { name: options.moveLocation },
        });
      }

      if (path === "/api/v2/user/permissions")
        return Response.json({
          STOCK_CONSUME: options.allowed ?? true,
          STOCK_OPEN: options.allowOpen ?? true,
          MASTER_DATA_EDIT: true,
        });

      if (path === "/api/v2/stock/overview") {
        for (const row of view.rows) {
          row.number_text.amount = String(row.amount);
          row.number_text.amount_aggregated = String(row.amount_aggregated);
          row.number_text.amount_opened = String(row.amount_opened);
          row.number_text.amount_opened_aggregated = String(row.amount_opened_aggregated);
        }

        return Response.json(view);
      }

      if (path === "/api/v2/stock/journal/summary?product_id=1")
        return Response.json({
          products: [{ id: 1, name: "Oats summary" }],
          users: [{ id: 1, name: "Household" }],
          transaction_types: ["consume"],
          rows: [
            {
              product_id: 1,
              product_name: "Oats summary",
              user_id: 1,
              user_display_name: "Household",
              transaction_type: "consume",
              amount: 5,
              qu_name: "Piece",
              qu_name_plural: "Pieces",
            },
          ],
        });

      if (path.endsWith("/consume") || path.endsWith("/open")) {
        const body = JSON.parse(String(init?.body));
        writes.push({ path, body });

        if (options.fail)
          return Response.json({ error_message: "Booking rejected" }, { status: 400 });
        const row = view.rows[0]!;
        saved = row.amount;

        if (path.endsWith("/consume")) {
          const removed = row.enable_tare_weight_handling === 1 ? row.amount : body.amount;
          row.amount -= removed;
          row.amount_aggregated -= removed;
        } else {
          row.amount_opened += body.amount;
          row.amount_opened_aggregated += body.amount;
        }

        return Response.json([{ id: 7, transaction_id: "overview-move" }]);
      }

      if (path === "/api/stock/transactions/overview-move/undo") {
        view.rows[0]!.amount = view.rows[0]!.amount_aggregated = saved;
        view.rows[0]!.amount_opened = view.rows[0]!.amount_opened_aggregated = 0;

        return new Response(null, { status: 204 });
      }

      return Response.json([]);
    }),
  );

  const root = createRootRoute({
    component: () => (
      <Toaster>
        <StockOverviewPage />
      </Toaster>
    ),
  });

  render(
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

  return writes;
}

function fixture() {
  const view = overviewFixture([
    { product_id: 1, product: { name: "Oats", min_stock_amount: 1 }, amount: 6 },
  ]);

  Object.assign(view.rows[0]!, {
    quick_consume_amount: 6,
    quick_consume_amount_qu_consume: 2,
    quick_open_amount: 3,
    quick_open_amount_qu_consume: 1,
    qu_consume_name: "Bowl",
  });

  return view;
}

test("overview quick amounts use consume units for labels, stock units for booking, and support refresh and undo", async () => {
  const writes = mount(fixture());
  const user = userEvent.setup();
  const consume = await screen.findByRole("button", { name: "Consume 2 Bowl of Oats" });

  const summary = (products: number, value: number) =>
    `${products} ${products === 1 ? "Product" : "Products"}, ${value.toLocaleString(undefined, { style: "currency", currency: "USD" })} total value`;

  await screen.findByText(summary(1, 12));
  await user.click(consume);
  await waitFor(() =>
    expect(writes).toEqual([
      {
        path: "/api/stock/products/1/consume",
        body: { amount: 6, spoiled: false, allow_subproduct_substitution: true },
      },
    ]),
  );
  await waitFor(() => expect(consume.hasAttribute("disabled")).toBe(true));
  await screen.findByText(summary(0, 0));
  await user.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() => expect(consume.hasAttribute("disabled")).toBe(false));
  await screen.findByText(summary(1, 12));
  const open = screen.getByRole("button", { name: "Mark 1 Bowl of Oats as open" });
  await user.click(open);
  await waitFor(() =>
    expect(writes[1]).toEqual({
      path: "/api/stock/products/1/open",
      body: { amount: 3, allow_subproduct_substitution: true },
    }),
  );
  await screen.findByText("3 opened");
  await waitFor(() => expect(open.hasAttribute("disabled")).toBe(false));
  await user.click(open);
  await screen.findByText("6 opened");
  await waitFor(() => expect(open.hasAttribute("disabled")).toBe(false));
});

test.each([false, true])(
  "consume all retains the native own-stock and tare payload (tare=%s)",
  async (tare) => {
    const view = fixture();
    Object.assign(view.rows[0]!, {
      amount: 4,
      amount_aggregated: 9,
      is_aggregated_amount: 1,
      enable_tare_weight_handling: tare ? 1 : 0,
      tare_weight: 0.25,
    });
    const writes = mount(view);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Consume all Oats which are currently in stock" }),
    );
    await waitFor(() =>
      expect(writes[0]?.body).toEqual({
        amount: tare ? 0.25 : 4,
        spoiled: false,
        allow_subproduct_substitution: true,
      }),
    );

    if (tare) await screen.findByText("Removed 4 Pieces of Oats from stock");
  },
);

test.each([
  {
    allowed: true,
    allowOpen: false,
    opening: true,
    amount: 9,
    opened: 0,
    tare: 0,
    disable: 0,
    consumeDisabled: false,
    openDisabled: true,
  },
  {
    allowed: true,
    opening: true,
    amount: 0,
    opened: 0,
    tare: 0,
    disable: 0,
    consumeDisabled: true,
    openDisabled: true,
  },
  {
    allowed: false,
    opening: true,
    amount: 9,
    opened: 0,
    tare: 0,
    disable: 0,
    consumeDisabled: true,
    openDisabled: false,
  },
  {
    allowed: true,
    opening: true,
    amount: 2,
    opened: 0,
    tare: 0,
    disable: 0,
    consumeDisabled: true,
    openDisabled: true,
  },
  {
    allowed: true,
    opening: true,
    amount: 9,
    opened: 9,
    tare: 0,
    disable: 0,
    consumeDisabled: false,
    openDisabled: true,
  },
  {
    allowed: true,
    opening: true,
    amount: 9,
    opened: 0,
    tare: 1,
    disable: 0,
    consumeDisabled: true,
    openDisabled: true,
  },
  {
    allowed: true,
    opening: true,
    amount: 9,
    opened: 0,
    tare: 0,
    disable: 1,
    consumeDisabled: false,
    openDisabled: true,
  },
  {
    allowed: true,
    opening: false,
    amount: 9,
    opened: 0,
    tare: 0,
    disable: 0,
    consumeDisabled: false,
    openDisabled: false,
  },
])("overview quick-action availability follows pinned rules: %j", async (scenario) => {
  const view = fixture();
  Object.assign(view.rows[0]!, {
    amount_aggregated: scenario.amount,
    amount_opened_aggregated: scenario.opened,
    enable_tare_weight_handling: scenario.tare,
    disable_open: scenario.disable,
  });
  mount(view, scenario);
  const consume = await screen.findByRole("button", { name: "Consume 2 Bowl of Oats" });
  await waitFor(() => expect(consume.hasAttribute("disabled")).toBe(scenario.consumeDisabled));
  const row = within(screen.getByRole("table")).getByRole("row", { name: /Oats/ });
  expect(
    within(row)
      .getByRole("button", { name: "Consume all Oats which are currently in stock" })
      .hasAttribute("disabled"),
  ).toBe(!scenario.allowed || scenario.amount === 0);

  if (scenario.opening) {
    const open = within(row).getByRole("button", { name: "Mark 1 Bowl of Oats as open" });
    expect(open.hasAttribute("disabled")).toBe(scenario.openDisabled);
  } else expect(within(row).queryByRole("button", { name: /as open/ })).toBeNull();
});

test("a rejected quick booking reports the error and permits retry without changing the row", async () => {
  const writes = mount(fixture(), { fail: true });
  const user = userEvent.setup();
  const consume = await screen.findByRole("button", { name: "Consume 2 Bowl of Oats" });
  await user.click(consume);
  await screen.findByText("Booking rejected");
  expect(consume.hasAttribute("disabled")).toBe(false);
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  await user.click(consume);
  await waitFor(() => expect(writes).toHaveLength(2));
});

test("quick bookings preserve the pinned data-attribute precision instead of sending the raw database float", async () => {
  const view = fixture();
  view.rows[0]!.quick_consume_amount = 1.2345678901234567;
  Object.assign(view.rows[0]!.number_text, { quick_consume_amount: "1.2345678901235" });
  const writes = mount(view);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Consume 2 Bowl of Oats" }));
  await waitFor(() => expect(writes[0]?.body.amount).toBe(1.2345678901235));
});

test.each([
  { moveOnOpen: true, moveLocation: "Pantry", expected: true },
  { moveOnOpen: false, moveLocation: "Pantry", expected: false },
  { moveOnOpen: true, moveLocation: null, expected: false },
])("quick open reports the configured move only when a destination exists: %j", async (options) => {
  mount(fixture(), options);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Mark 1 Bowl of Oats as open" }));
  await screen.findByText("Marked 3 Piece of Oats as opened");

  if (options.expected) await screen.findByText("Moved to Pantry");
  else {
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Mark 1 Bowl of Oats as open" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(screen.queryByText("Moved to Pantry")).toBeNull();
  }
});

test("quick open retains the native post-booking read failure without replaying the booking", async () => {
  const writes = mount(fixture(), { failDetails: true });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Mark 1 Bowl of Oats as open" }));
  await screen.findByText("Product read failed");
  expect(writes).toHaveLength(1);
  expect(screen.queryByText("Marked 3 Piece of Oats as opened")).toBeNull();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
});

test("stock row actions open the selected product summary, restore focus, and retain recipe and edit destinations", async () => {
  supportDialogs();
  mount(fixture());
  const user = userEvent.setup();
  const trigger = await screen.findByRole("button", { name: "More actions for Oats" });
  await user.click(trigger);
  // jsdom has the popover stylesheet but does not implement its activation.
  const menu = screen.getByLabelText<HTMLDivElement>("More actions for Oats", { selector: "div" });
  menu.style.display = "block";
  menu.hidePopover = () => {
    menu.style.display = "none";
  };

  const recipe = within(menu).getByRole<HTMLAnchorElement>("link", {
    name: "Search for recipes containing this product",
  });

  expect(new URL(recipe.href).searchParams.get("search")).toBe("Oats");
  const edit = await within(menu).findByRole<HTMLAnchorElement>("link", { name: "Edit product" });
  expect(new URL(edit.href).pathname).toBe("/product/1");
  expect(new URL(edit.href).searchParams.get("returnto")).toBe("/");
  await user.click(within(menu).getByRole("button", { name: "Stock journal summary" }));
  const dialog = await screen.findByRole("dialog", { name: "Stock journal summary" });
  await within(dialog).findByRole("rowheader", { name: "Oats summary" });
  expect(within(dialog).getByRole("cell", { name: "5 Pieces" })).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
