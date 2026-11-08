import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { createAppRouter } from "@/router";

function mount(path: string, firstDay = "1") {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T12:00:00"));
  onTestFinished(() => {
    vi.useRealTimers();
  });
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = String(input);

      if (url === "/api/v2/setup") return Response.json({ needs_setup: false });

      if (url === "/api/user") return Response.json([{ id: 1, username: "test" }]);

      if (url === "/api/system/config")
        return Response.json({
          CALENDAR_FIRST_DAY_OF_WEEK: "1",
          MEAL_PLAN_FIRST_DAY_OF_WEEK: firstDay,
        });

      if (url === "/api/user/settings") return Response.json({});

      if (url === "/api/v2/shopping-lists/1")
        return Response.json({ id: 1, name: "Shopping list", items: [] });

      if (url.startsWith("/api/v2/localization"))
        return Response.json({
          locale: "en",
          direction: "ltr",
          languages: ["en"],
          catalog: { domain: "grocy/strings", "plural-forms": null, messages: { "": {} } },
        });

      if (url === "/api/objects/meal_plan")
        return Response.json([
          {
            id: 1,
            day: "2019-01-02",
            type: "note",
            note: "Bookmarked meal",
            section_id: null,
            done: 0,
          },
          {
            id: 2,
            day: "2026-11-06",
            type: "note",
            note: "Current meal",
            section_id: null,
            done: 0,
          },
        ]);

      return Response.json([]);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });

  const app = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  onTestFinished(() => {
    app.unmount();
    client.clear();
  });

  return router;
}

test("the additional modern planner preserves its bookmarked query while navigating weeks", async () => {
  const router = mount("/meal-plan?start=2019-01-02&week=2001-02-03&embedded=");
  await screen.findByText("2018-12-31 – 2019-01-06");

  const week = await waitFor(() => {
    const grid = document.querySelector(".meal-week");

    if (!(grid instanceof HTMLElement)) throw new Error("The meal week is unavailable.");

    return grid;
  });

  await within(week).findByText("Bookmarked meal");
  expect(within(week).queryByText("Current meal")).toBeNull();
  expect(router.state.location.pathname).toBe("/meal-plan");
  const query = { start: "2019-01-02", week: "2001-02-03", embedded: "" };
  expect(router.state.location.search).toEqual(query);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Previous week" }));
  await screen.findByText("2018-12-24 – 2018-12-30");
  expect(router.state.location.search).toEqual(query);
  await user.click(screen.getByRole("button", { name: "Next week" }));
  await screen.findByText("2018-12-31 – 2019-01-06");
  await user.click(screen.getByRole("button", { name: "This week" }));
  await screen.findByText("2026-11-02 – 2026-11-08");
  expect(router.state.location.search).toEqual(query);
});

test.each(["?start=2019-02-31&week=2019-01-02", "?week=2019-01-02"])(
  "meal-plan ignores invalid start values and the upstream week-link defect (%s)",
  async (query) => {
    mount(`/meal-plan${query}`);
    await screen.findByText("2026-11-02 – 2026-11-08");
  },
);

test.each([
  ["0", "2018-12-30 – 2019-01-05"],
  ["-1", "2018-12-28 – 2019-01-03"],
])("meal-plan uses configured first day %s for bookmarked dates", async (firstDay, expected) => {
  mount("/meal-plan?start=2019-01-02", firstDay);
  await screen.findByText(expected);
});

test("changing a start bookmark through router history selects its new containing week", async () => {
  const router = mount("/meal-plan?start=2019-01-02");
  await screen.findByText("2018-12-31 – 2019-01-06");
  await act(async () => {
    await router.navigate({ to: "/meal-plan", search: { start: "2020-02-29" } });
  });
  await waitFor(() => expect(screen.getByText("2020-02-24 – 2020-03-01")).toBeTruthy());
});
