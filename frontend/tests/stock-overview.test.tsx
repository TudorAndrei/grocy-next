import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import { isoDay } from "@/lib/format";
import { supportDialogs } from "./fixtures/dialogs";
import { overviewFixture } from "./fixtures/stock-overview";

test("legacy overview links filter actual locations, groups, and separate due statuses", async () => {
  const names = ["Tea", "Hard cheese", "Missing", "Parent", "Fresh", "Tea red"];

  const view = overviewFixture(
    names.map((name, index) => ({
      product_id: index + 1,
      product: { name },
      amount: [2, 1, 0, 0, 3, 1][index]!,
      amount_aggregated: index === 3 ? 2 : [2, 1, 0, 0, 3, 1][index]!,
      is_aggregated_amount: index === 3,
      best_before_date: isoDay(index < 2 || index === 3 ? -1 : 3),
    })),
  );

  view.locations = [
    { id: 1, name: "Shelf" },
    { id: 2, name: "Cold" },
    { id: 3, name: "Cold room" },
  ];

  const rows = view.rows.map((row, index) => ({
    ...row,
    product_default_location_name: "Shelf",
    location_names: index === 3 ? [] : [index === 5 ? "Cold room" : "Cold"],
    product_group_name: index === 5 ? "Tea red" : "Tea",
    due_type: index === 1 ? 2 : 1,
    product_missing: index === 2 ? 1 : 0,
  }));

  const response = {
    ...view,
    rows,
    product_groups: [
      { id: 1, name: "Tea" },
      { id: 2, name: "Tea red" },
    ],
  };

  let failed = true;

  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const path = String(input);

      if (path === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (path === "/api/user") return Response.json([{ id: 1, username: "test" }]);

      if (path === "/api/system/config" || path === "/api/user/settings") return Response.json({});

      if (path === "/api/v2/stock/overview")
        return failed
          ? Response.json({ error_message: "Overview read failed" }, { status: 503 })
          : Response.json(response);

      if (path.startsWith("/api/v2/shopping-lists/")) return Response.json({ items: [] });

      if (path.startsWith("/api/stock/volatile"))
        return Response.json({
          due_products: [],
          overdue_products: [],
          expired_products: [],
          missing_products: [],
        });

      return Response.json([]);
    }),
  );

  const router = createAppRouter({
    history: createMemoryHistory({
      initialEntries: ["/stockoverview?location=Shelf&status=expired"],
    }),
  });

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByText("Overview read failed");
  const user = userEvent.setup();
  failed = false;
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("link", { name: "Hard cheese" });

  const shown = () =>
    within(screen.getByRole("table"))
      .getAllByRole("link")
      .map((link) => link.textContent)
      .sort();

  // The native overview does not use these URL fields as table filters.
  expect(shown()).toHaveLength(6);
  await user.selectOptions(screen.getByRole("combobox", { name: "Location" }), "Cold");
  await user.selectOptions(screen.getByRole("combobox", { name: "Product group" }), "Tea");
  expect(shown()).toEqual(["Fresh", "Hard cheese", "Missing", "Tea"]);
  await user.click(screen.getByRole("button", { name: /^Overdue/ }));
  expect(shown()).toEqual(["Tea"]);
  await user.click(screen.getByRole("button", { name: /^Expired/ }));
  expect(shown()).toEqual(["Hard cheese"]);
  await user.click(screen.getByRole("button", { name: /^Below min/ }));
  expect(shown()).toEqual(["Missing"]);
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await waitFor(() => expect(shown()).toHaveLength(6));
  await user.click(screen.getByRole("button", { name: /^In stock/ }));
  expect(shown()).toEqual(["Fresh", "Hard cheese", "Parent", "Tea", "Tea red"]);
  await user.click(screen.getByRole("button", { name: /^Due soon/ }));
  expect(shown()).toEqual(["Fresh", "Tea red"]);
});

test("overview table retains native column positions, grouping, search, and saved state", async () => {
  supportDialogs();
  const settings: Record<string, string> = {};

  const view = overviewFixture([
    { product_id: 1, product: { name: "Zulu" }, amount: 2, best_before_date: "2026-11-01" },
    { product_id: 2, product: { name: "Alpha" }, amount: 10, best_before_date: "2026-11-01" },
    {
      product_id: 3,
      product: { name: "Bravo" },
      amount: 0,
      amount_aggregated: 3,
      is_aggregated_amount: true,
    },
  ]);

  const data = {
    ...view,
    rows: view.rows.map((row, index) => ({
      ...row,
      product_group_name: index < 2 ? "Drinks" : "Food",
      product_calories: index === 0 ? "not numeric" : null,
      calories: index === 0 ? 0 : null,
      product_barcodes: index === 0 ? "LOT-Z" : null,
      product_description: index === 0 ? "<p>Rare cocoa</p>" : "",
      product_values: { origin: index === 0 ? "Ceylon" : "Colombia" },
      last_price: index === 0 ? 1.25 : null,
      qu_price_name: "Box",
      product_qu_factor_price_to_stock: 6,
      number_text: {
        ...row.number_text,
        last_price: index === 0 ? "1.25" : "",
        last_price_display: "7.5",
        product_calories: index === 0 ? "not numeric" : "",
        calories: index === 0 ? "0" : "",
      },
    })),
  };

  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);
      const prefix = "/api/user/settings/";

      if (path.startsWith(prefix)) {
        const key = decodeURIComponent(path.slice(prefix.length));

        if (init?.method === "DELETE") delete settings[key];
        else settings[key] = JSON.parse(String(init?.body)).value;

        return new Response(null, { status: 204 });
      }

      if (path === "/api/user/settings") return Response.json(settings);

      if (path === "/api/system/config") return Response.json({});

      if (path === "/api/v2/stock/overview") return Response.json(data);

      if (path === "/api/objects/userfields")
        return Response.json([
          {
            id: 1,
            entity: "products",
            name: "origin",
            caption: "Origin",
            type: "text-single-line",
            input_required: 0,
            default_value: null,
            config: null,
            show_as_column_in_tables: 1,
          },
        ]);

      return Response.json([]);
    }),
  );
  const { StockOverviewPage } = await import("@/components/StockOverviewPage");
  const { createRootRoute, createRouter } = await import("@tanstack/react-router");
  const root = createRootRoute({ component: StockOverviewPage });

  const mount = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={client}>
        <RouterProvider
          router={createRouter({
            routeTree: root,
            history: createMemoryHistory({ initialEntries: ["/"] }),
          })}
        />
      </QueryClientProvider>,
    );
  };

  let mounted = mount();

  const names = () =>
    Array.from(document.querySelectorAll("td.stock-name a")).map((e) => e.textContent);

  await waitFor(() => expect(names()).toEqual(["Zulu", "Alpha", "Bravo"]));
  const user = userEvent.setup();
  const search = screen.getByRole("searchbox", { name: "Search stock" });
  await user.type(search, 'Ceylon "Rare cocoa"');
  expect(names()).toEqual(["Zulu"]);
  await user.clear(search);
  await user.type(search, "view Food");
  expect(names()).toEqual([]);
  await user.clear(search);
  await user.type(search, "LOT-Z");
  expect(names()).toEqual(["Zulu"]);
  await user.clear(search);
  await user.click(screen.getByRole("button", { name: "Table options" }));
  await user.click(screen.getByRole("checkbox", { name: "Last price" }));
  await user.click(screen.getByRole("checkbox", { name: "Calories (Per stock quantity unit)" }));
  await user.click(screen.getByRole("checkbox", { name: "Product group" }));
  await user.click(screen.getByRole("checkbox", { name: "Calories" }));
  await user.click(screen.getByRole("radio", { name: "Next due date" }));
  await user.click(screen.getByRole("button", { name: "OK" }));
  expect(document.querySelectorAll(".stock-table-group")).toHaveLength(3);
  await user.click(screen.getByRole("button", { name: "Table options" }));
  await user.click(screen.getByRole("radio", { name: "Product group" }));
  await user.click(screen.getByRole("button", { name: "OK" }));
  await screen.findByRole("button", { name: "Drinks" });
  expect(screen.getByText("NaN")).toBeTruthy();
  expect(screen.getByText("$7.50 per Box")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Drinks" }));
  expect(screen.getByRole("button", { name: "Drinks" }).getAttribute("aria-expanded")).toBe(
    "false",
  );
  await waitFor(() => {
    const state = JSON.parse(settings["datatables_state_stock-overview-table"]!);

    expect(state.columns).toHaveLength(21);
    expect(state.columns[2].visible).toBe(true);
    expect(state.columns[12].visible).toBe(true);
    expect(state.order).toEqual([[5, "asc"]]);
    expect(JSON.parse(settings["datatables_rowGroup_stock-overview-table"]!)).toEqual({
      enable: true,
      dataSrc: "2",
    });
  });
  mounted.unmount();
  mounted = mount();
  await screen.findByRole("columnheader", { name: "Last price" });
  await screen.findByRole("button", { name: "Drinks" });
  expect(screen.getByRole("button", { name: "Drinks" }).getAttribute("aria-expanded")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Amount" }));
  expect(names()).toEqual(["Zulu", "Alpha", "Bravo"]);
  await user.click(screen.getByRole("button", { name: "Amount" }));
  expect(names()).toEqual(["Alpha", "Zulu", "Bravo"]);
  await user.click(screen.getByRole("button", { name: "Calories" }));
  expect(names()).toEqual(["Alpha", "Zulu", "Bravo"]);
  await user.click(screen.getByRole("button", { name: "Calories" }));
  expect(names()).toEqual(["Alpha", "Zulu", "Bravo"]);
  mounted.unmount();
});
