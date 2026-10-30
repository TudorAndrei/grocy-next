import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { createAppRouter } from "@/router";
import { isoDay } from "@/lib/format";
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
