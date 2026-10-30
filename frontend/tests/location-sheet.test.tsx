import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 30, 12, 34, 56));
  onTestFinished(() => {
    vi.useRealTimers();
  });
});

function mount(path: string, { fail = false, stock = true, locations = true, precision = 3 } = {}) {
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
          FEATURE_FLAG_STOCK_LOCATION_TRACKING: locations,
        });

      if (url.pathname === "/api/user/settings")
        return Response.json({ stock_decimal_places_amounts: precision });

      if (url.pathname.includes("/shopping-lists/")) return Response.json({ items: [] });

      if (url.pathname === "/api/v2/stock/location-content-sheet") {
        reads.push(url);

        if (fail && reads.length === 1)
          return Response.json({ error_message: "Sheet unavailable" }, { status: 503 });

        const product = {
          id: 1,
          name: "Apple",
          amount: 1234.5678901234567,
          amount_opened: 0.12345678901234566,
          amount_text: "1234.5678901235",
          amount_opened_text: "0.12345678901235",
          unit_label: "Sheet pieces",
          unit_name: "Sheet piece",
          unit_name_plural: "Sheet pieces",
          unit_plural_forms: null,
          unit_active: 1,
        };

        return Response.json({
          locations: [
            {
              id: 1,
              name: "Shelf",
              products: [
                product,
                ...(url.searchParams.has("include_out_of_stock")
                  ? [
                      {
                        ...product,
                        id: 3,
                        name: "Empty jar",
                        amount: 0,
                        amount_opened: 0,
                        amount_text: "0",
                        amount_opened_text: "0",
                      },
                    ]
                  : []),
              ],
            },
            {
              id: 2,
              name: "Old shelf",
              products: [
                {
                  ...product,
                  id: 2,
                  name: "Coffee",
                  amount: 2,
                  amount_opened: 0,
                  amount_text: "2",
                  amount_opened_text: "0",
                  unit_label: "%q\0 bags",
                  unit_name: "%s bag",
                  unit_name_plural: "%%q bags",
                  unit_plural_forms: "old",
                  unit_active: 0,
                },
              ],
            },
          ],
        });
      }

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

test("the location sheet retries reads, formats stock, and prepares timestamps before printing", async () => {
  const { router, reads, writes } = mount("/locationcontentsheet?embedded=false&keep=bookmark", {
    fail: true,
  });

  const user = userEvent.setup();
  const printed: string[][] = [];
  vi.spyOn(window, "print").mockImplementation(() => {
    printed.push(
      screen
        .getAllByText("Time of printing: 10/30/2026 12:34 PM")
        .map((node) => node.textContent ?? ""),
    );
  });
  await screen.findByText("Sheet unavailable");
  await user.click(screen.getByRole("button", { name: "Retry" }));
  const shelf = await screen.findByRole("table", { name: "Shelf" });
  expect(within(shelf).getByText(/1,234.568 Sheet pieces/)).toBeTruthy();
  expect(within(shelf).getByText("0.12345678901235 opened")).toBeTruthy();
  await user.click(
    within(screen.getByRole("region", { name: "Old shelf" })).getByRole("button", {
      name: "Print (this location)",
    }),
  );
  expect(printed).toHaveLength(1);
  expect(printed[0]).toHaveLength(2);
  expect(screen.getByRole("table", { name: "Shelf" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Print (all locations)" }));
  expect(printed).toHaveLength(2);
  await user.click(screen.getByRole("checkbox", { name: "Show only in stock products" }));
  await screen.findByRole("rowheader", { name: "Empty jar" });
  expect(router.state.location.search).toEqual({
    embedded: "false",
    keep: "bookmark",
    include_out_of_stock: "true",
  });
  expect(reads.at(-1)?.searchParams.get("include_out_of_stock")).toBe("true");
  expect(screen.getAllByText("Time of printing:")).toHaveLength(2);
  await user.click(screen.getByRole("checkbox", { name: "Show only in stock products" }));
  await waitFor(() =>
    expect(router.state.location.search).toEqual({ embedded: "false", keep: "bookmark" }),
  );
  expect(reads.at(-1)?.searchParams.has("include_out_of_stock")).toBe(false);
  expect(writes.every((path) => path.startsWith("/api/user/settings/"))).toBe(true);
});

test("the sheet uses native amount text and retains literal percent text in resolved unit labels", async () => {
  mount("/locationcontentsheet?embedded", { precision: 20 });
  const shelf = await screen.findByRole("table", { name: "Shelf" });
  expect(within(shelf).getByText(/1,234.5678901235 Sheet pieces/)).toBeTruthy();
  expect(
    within(screen.getByRole("table", { name: "Old shelf" })).getByText("2 %q bags"),
  ).toBeTruthy();
});

test.each(["", "0", "false"])(
  "the location sheet retains native query presence and checkbox text: %j",
  async (value) => {
    const { reads } = mount(`/locationcontentsheet?embedded&include_out_of_stock=${value}`);
    await screen.findByRole("rowheader", { name: "Empty jar" });
    expect(reads.at(-1)?.searchParams.get("include_out_of_stock")).toBe(value);
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", { name: "Show only in stock products" })
        .checked,
    ).toBe(value === "");
  },
);

test.each([{ stock: false }, { locations: false }])(
  "location sheet access follows feature settings: %j",
  async (settings) => {
    const { reads } = mount("/locationcontentsheet", settings);
    await screen.findByRole("heading", { name: "Feature disabled" });
    expect(reads).toHaveLength(0);
  },
);
