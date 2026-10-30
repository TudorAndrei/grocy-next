import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { createAppRouter } from "@/router";

function mount(path: string, { fail = false, empty = false, stock = true, price = true } = {}) {
  const reads: URL[] = [];
  const writes: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");

      if (init?.method && init.method !== "GET") writes.push(url.pathname);

      if (url.pathname === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (url.pathname === "/api/user") return Response.json([{ id: 1, username: "Tester" }]);

      if (url.pathname === "/api/system/config")
        return Response.json({
          FEATURE_FLAG_STOCK: stock,
          FEATURE_FLAG_STOCK_PRICE_TRACKING: price,
          CURRENCY: "EUR",
        });

      if (url.pathname === "/api/user/settings")
        return Response.json({ stock_decimal_places_prices_display: 3 });

      if (url.pathname.startsWith("/api/user/settings/"))
        return new Response(null, { status: 204 });

      if (url.pathname === "/api/v2/stock/reports/spendings") {
        reads.push(url);

        if (fail && reads.length === 1)
          return Response.json({ error_message: "Report unavailable" }, { status: 503 });
        const grouping = url.searchParams.get("group_by") ?? "product";

        return Response.json({
          group_by: grouping,
          product_groups: [{ id: 9, name: "Fruit" }],
          rows: empty
            ? []
            : grouping === "product"
              ? [
                  { id: 7, name: "Alpha apple", total: 15, group_id: 9, group_name: "Fruit" },
                  { id: 8, name: "Beta pear", total: 5.005, group_id: 10, group_name: "0" },
                ]
              : [
                  {
                    id: 9,
                    name: grouping === "store" ? "Market" : "Fruit",
                    total: 20.005,
                    group_id: null,
                    group_name: null,
                  },
                ],
        });
      }

      if (url.pathname.includes("/shopping-lists/")) return Response.json({ items: [] });

      return Response.json([]);
    }),
  );

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient: client },
  });

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { router, reads, writes };
}

test("the spending route applies and cancels ranges, retains URL limits, and retries reads", async () => {
  const { router, reads, writes } = mount(
    "/stockreports/spendings?start_date=2035-03-01&end_date=2035-03-31&product-group=9&embedded=false",
    { fail: true },
  );

  const user = userEvent.setup();
  await screen.findByText("Report unavailable");
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("table", { name: "Spendings" });
  await user.click(screen.getByRole("button", { name: "2035-03-01 – 2035-03-31" }));
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2035-04-01" } });
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(reads).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "2035-03-01 – 2035-03-31" }));
  expect(screen.getByLabelText<HTMLInputElement>("Start date").value).toBe("2035-03-01");
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2035-04-01" } });
  fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2035-04-30" } });
  await user.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(reads.at(-1)?.searchParams.get("start_date")).toBe("2035-04-01"));
  await user.click(screen.getByRole("button", { name: "Store" }));
  await screen.findByRole("rowheader", { name: "Market" });
  expect(router.state.location.search).toEqual({
    start_date: "2035-04-01",
    end_date: "2035-04-30",
    "product-group": "9",
    "group-by": "store",
    embedded: "false",
  });
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await waitFor(() =>
    expect(router.state.location.search).toEqual({ "group-by": "store", embedded: "false" }),
  );
  await user.selectOptions(screen.getByRole("combobox", { name: "Date range" }), "year");
  const year = new Date().getFullYear();
  await waitFor(() => expect(reads.at(-1)?.searchParams.get("start_date")).toBe(`${year}-01-01`));
  expect(reads.at(-1)?.searchParams.get("end_date")).toBe(`${year}-12-31`);
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Date range" }).value).toBe(
    "year",
  );
  expect(writes.every((path) => path.startsWith("/api/user/settings/"))).toBe(true);
});

test("spending search and numeric sorting leave the complete chart and its currency total unchanged", async () => {
  mount("/stockreports/spendings?embedded");
  const user = userEvent.setup();
  const table = await screen.findByRole("table", { name: "Spendings" });
  expect(within(table).getByText("€5.005")).toBeTruthy();
  expect(
    within(within(table).getByRole("rowheader", { name: "Beta pear" }).closest("tr")!).getByText(
      "Ungrouped",
    ),
  ).toBeTruthy();
  expect(screen.getByRole("img", { name: "Total: €20.01" })).toBeTruthy();
  await user.click(within(table).getByRole("button", { name: "Total" }));
  expect(
    within(table)
      .getAllByRole("rowheader")
      .map((cell) => cell.textContent),
  ).toEqual(["Beta pear", "Alpha apple"]);
  await user.type(screen.getByRole("searchbox", { name: "Search" }), '"Alpha apple"');
  expect(
    within(table)
      .getAllByRole("rowheader")
      .map((cell) => cell.textContent),
  ).toEqual(["Alpha apple"]);
  expect(screen.getByRole("img", { name: "Total: €20.01" })).toBeTruthy();
  await user.clear(screen.getByRole("searchbox", { name: "Search" }));
  await user.type(screen.getByRole("searchbox", { name: "Search" }), "No match");
  expect(within(table).getByText("No entries found")).toBeTruthy();
  expect(screen.getByRole("img", { name: "Total: €20.01" })).toBeTruthy();
});

test("an empty spending report retains its table and zero total", async () => {
  mount("/stockreports/spendings?embedded", { empty: true });
  const table = await screen.findByRole("table", { name: "Spendings" });
  expect(within(table).getByText("No entries found")).toBeTruthy();
  expect(screen.getByRole("img", { name: "Total: €0.00" })).toBeTruthy();
});

test.each([{ stock: false }, { price: false }])(
  "the spending route follows feature settings: %j",
  async (settings) => {
    const { reads } = mount("/stockreports/spendings", settings);
    await screen.findByRole("heading", { name: "Feature disabled" });
    expect(reads).toHaveLength(0);
  },
);
