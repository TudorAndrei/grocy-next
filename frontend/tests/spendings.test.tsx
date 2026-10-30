import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import observed from "./fixtures/legacy-report-calendar.json";

let failCalendar = false;

beforeEach(() => {
  failCalendar = false;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 30, 12, 34, 56));
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const append = document.head.append.bind(document.head);

  // Replace HTTP transport only. Run the unchanged release scripts in JSDOM.
  vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
    for (const node of nodes) {
      if (node instanceof HTMLScriptElement && node.src.includes("/vendor/daterangepicker/")) {
        if (failCalendar) {
          failCalendar = false;
          queueMicrotask(() => node.dispatchEvent(new Event("error")));

          continue;
        }

        const filename = new URL(node.src).pathname.split("/").at(-1);
        node.removeAttribute("src");
        node.textContent = readFileSync(
          resolve(`public/vendor/daterangepicker/${filename}`),
          "utf8",
        );
        window.eval(node.textContent);
        queueMicrotask(() => node.dispatchEvent(new Event("load")));
      } else append(node);
    }
  });
});

function mount(
  path: string,
  {
    fail = false,
    empty = false,
    stock = true,
    price = true,
    locale = "en",
    firstDay = "",
    weekNumbers = true,
  } = {},
) {
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
          CALENDAR_FIRST_DAY_OF_WEEK: firstDay,
          CALENDAR_SHOW_WEEK_OF_YEAR: weekNumbers,
        });

      if (url.pathname === "/api/v2/localization")
        return Response.json({
          locale,
          direction: "ltr",
          languages: [locale],
          catalog: {
            domain: "grocy/strings",
            "plural-forms": null,
            messages: { "": { moment_locale: [locale] } },
          },
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
  failCalendar = true;

  const { router, reads, writes } = mount(
    "/stockreports/spendings?start_date=2032-02-29&end_date=2032-03-03&product-group=9&embedded=false",
    { fail: true },
  );

  const user = userEvent.setup();
  await screen.findByText("Could not load date range calendar.");
  await user.click(screen.getByRole("button", { name: "Retry calendar" }));
  await screen.findByText("Report unavailable");
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("table", { name: "Spendings" });
  let input = screen.getByRole<HTMLInputElement>("textbox", { name: "Date range" });
  await waitFor(() => expect(input.disabled).toBe(false));
  await user.click(input);
  fireEvent.input(input, { target: { value: "2035-04-01 - 2035-04-30" } });
  fireEvent.keyUp(input, { key: "End" });
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  // Observed native Cancel coercion for explicit query dates, in browser time.
  expect(input.value).toBe(
    `${new Date(2032, 1, 29).valueOf()} - ${new Date(2032, 2, 3).valueOf()}`,
  );
  expect(reads).toHaveLength(2);
  await user.click(input);
  fireEvent.input(input, { target: { value: "2035-04-01 - 2035-04-30" } });
  fireEvent.keyUp(input, { key: "End" });
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
  input = await screen.findByRole<HTMLInputElement>("textbox", { name: "Date range" });
  await waitFor(() => expect(input.disabled).toBe(false));
  await user.click(input);
  await user.click(screen.getByText("This year"));
  const year = new Date().getFullYear();
  await waitFor(() => expect(reads.at(-1)?.searchParams.get("start_date")).toBe(`${year}-01-01`));
  expect(reads.at(-1)?.searchParams.get("end_date")).toBe(`${year}-12-31`);
  await waitFor(() =>
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Date range" }).value).toBe(
      `${year}-01-01 - ${year}-12-31`,
    ),
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

test.each(observed.cases)(
  "the report calendar retains native week rules: $name",
  async (settings) => {
    mount("/stockreports/spendings?start_date=2027-01-01&end_date=2027-01-31&embedded", settings);
    const input = await screen.findByRole<HTMLInputElement>("textbox", { name: "Date range" });
    await waitFor(() => expect(input.disabled).toBe(false));
    await userEvent.click(input);
    const calendar = screen.getByRole("dialog", { name: "Date range" });
    const left = calendar.querySelector(".left")!;
    expect(
      Array.from(left.querySelectorAll("thead tr:last-child th"), (cell) => cell.textContent),
    ).toEqual(settings.weekdays);
    expect(Array.from(left.querySelectorAll("tbody td.week"), (cell) => cell.textContent)).toEqual(
      settings.weeks,
    );
    const days = left.querySelectorAll("tbody td:not(.week)");
    expect([days[0]?.textContent, days[41]?.textContent]).toEqual([settings.first, settings.last]);
  },
);

test("linked calendar navigation and keyboard dismissal keep the native range rules", async () => {
  const { router, reads } = mount(
    "/stockreports/spendings?start_date=2032-02-29&end_date=2032-03-03&embedded",
  );

  const user = userEvent.setup();
  let input = await screen.findByRole<HTMLInputElement>("textbox", { name: "Date range" });
  await waitFor(() => expect(input.disabled).toBe(false));
  await user.click(input);
  const calendar = screen.getByRole("dialog", { name: "Date range" });

  const month = (side: string) =>
    within(calendar).getByRole<HTMLSelectElement>("combobox", { name: `${side} date: Month` });

  const year = (side: string) =>
    within(calendar).getByRole<HTMLSelectElement>("combobox", { name: `${side} date: Year` });

  const day = (value: string) =>
    Array.from(
      calendar.querySelectorAll<HTMLTableCellElement>(".left td.available:not(.off)"),
    ).find((cell) => cell.textContent === value)!;

  await user.click(calendar.querySelector(".right th.next")!);
  expect([month("Start").value, month("End").value]).toEqual(["2", "3"]);
  await user.click(calendar.querySelector(".left th.prev")!);
  await user.selectOptions(month("Start"), "0");
  await user.selectOptions(year("Start"), "2033");
  expect([month("End").value, year("End").value]).toEqual(["1", "2033"]);
  await user.click(within(calendar).getByRole("button", { name: "Cancel" }));
  await user.click(input);
  await user.click(day("15"));
  await user.hover(day("18"));
  expect(day("18").classList.contains("in-range")).toBe(true);
  await user.click(day("10"));
  expect(within(calendar).getByRole<HTMLButtonElement>("button", { name: "Apply" }).disabled).toBe(
    true,
  );
  await user.click(day("20"));
  await user.click(screen.getByRole("heading", { name: "Stock report / Spendings" }));
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({
      start_date: "2032-02-10",
      end_date: "2032-02-20",
    }),
  );

  for (const [start, end, key, keyCode] of [
    ["05", "07", "Escape", 27],
    ["08", "09", "Tab", 9],
  ] as const) {
    input = await screen.findByRole<HTMLInputElement>("textbox", { name: "Date range" });
    await waitFor(() => expect(input.disabled).toBe(false));
    await user.click(input);
    fireEvent.input(input, { target: { value: `2032-02-${start} - 2032-02-${end}` } });
    fireEvent.keyUp(input, { key: "End" });
    expect(fireEvent.keyDown(input, { key, keyCode, which: keyCode })).toBe(false);
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        start_date: `2032-02-${start}`,
        end_date: `2032-02-${end}`,
      }),
    );
  }

  input = await screen.findByRole<HTMLInputElement>("textbox", { name: "Date range" });
  await waitFor(() => expect(input.disabled).toBe(false));
  await user.click(input);
  const count = reads.length;
  const current = screen.getByRole("dialog", { name: "Date range" });
  await user.click(
    Array.from(current.querySelectorAll(".left td.available:not(.off)")).find(
      (cell) => cell.textContent === "1",
    )!,
  );
  input.focus();
  fireEvent.keyDown(input, { key: "Escape", keyCode: 27 });
  expect(input.value).toBe("2032-02-08 - 2032-02-09");
  expect(input.getAttribute("aria-expanded")).toBe("false");
  expect(reads).toHaveLength(count);
  await user.click(input);
  expect(fireEvent.keyDown(input, { key: "Tab", keyCode: 9 })).toBe(true);
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
