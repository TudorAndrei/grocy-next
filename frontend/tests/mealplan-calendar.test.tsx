import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";
import { mealPlanCalendarFixture } from "./fixtures/mealplan-calendar";

function mountCalendar(path: string, { width = 1024, firstDay = "1", populated = false } = {}) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T12:00:00"));
  vi.stubGlobal("innerWidth", width);
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const data = mealPlanCalendarFixture();

  if (!populated) {
    data.events = [];
    data.used_sections = [];
    data.week_recipe = null;
  }

  const reads: string[] = [];

  const app = mountNativeEditor(
    path,
    (url) => {
      if (url.startsWith("/api/v2/meal-plan/calendar")) {
        reads.push(url);

        return Response.json(data);
      }

      return undefined;
    },
    {
      FEATURE_FLAG_RECIPES: true,
      FEATURE_FLAG_RECIPES_MEALPLAN: true,
      FEATURE_FLAG_STOCK: false,
      FEATURE_FLAG_SHOPPINGLIST: false,
      MEAL_PLAN_FIRST_DAY_OF_WEEK: firstDay,
    },
  );

  return { ...app, reads, data };
}

test("native mealplan keeps its path, normalizes the first visible week and preserves the first controller read", async () => {
  const app = mountCalendar("/mealplan?start=2019-01-02&week=2001-02-03&embedded=");
  await screen.findByRole("button", { name: "Week" });
  const table = await screen.findByRole("table", { name: "Meal plan" });
  expect(
    within(table).getByRole("columnheader", { name: "Monday, December 31, 2018" }),
  ).toBeTruthy();
  expect(within(table).getByRole("columnheader", { name: "Sunday, January 6, 2019" })).toBeTruthy();
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/mealplan"));
  await waitFor(() =>
    expect(app.router.state.location.search).toEqual({
      start: "2018-12-31",
      week: "2001-02-03",
      embedded: "",
    }),
  );
  expect(app.reads).toEqual([
    "/api/v2/meal-plan/calendar?start=2019-01-02&week=2001-02-03&embedded=",
  ]);
});

test("native week/day switches keep the initial anchor, then navigation reloads the canonical range", async () => {
  const app = mountCalendar("/mealplan?start=2019-01-02");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Day" }));
  await screen.findByRole("columnheader", { name: "Wednesday, January 2, 2019" });
  await waitFor(() =>
    expect(app.router.state.location.search).toEqual({ start: "2019-01-02", days: "0" }),
  );
  await user.click(screen.getByRole("button", { name: "Next day" }));
  await screen.findByRole("columnheader", { name: "Thursday, January 3, 2019" });
  await user.click(screen.getByRole("button", { name: "Week" }));
  await screen.findByRole("columnheader", { name: "Monday, December 31, 2018" });
  expect(app.reads).toContain("/api/v2/meal-plan/calendar?start=2019-01-03&days=0");
});

test("active view buttons do not reload or replace the initial anchor", async () => {
  const app = mountCalendar("/mealplan?start=2019-01-02");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Week" }));
  expect(app.reads).toEqual(["/api/v2/meal-plan/calendar?start=2019-01-02"]);
  await user.click(screen.getByRole("button", { name: "Day" }));
  await screen.findByRole("columnheader", { name: "Wednesday, January 2, 2019" });
  const before = app.reads.length;
  await user.click(screen.getByRole("button", { name: "Day" }));
  expect(app.reads).toHaveLength(before);
});

test("nullable event kinds retain their native default title and persisted day summary without invented actions", async () => {
  const app = mountCalendar("/mealplan?start=2026-11-02", { populated: true });
  const original = app.data.events[0]!;
  app.data.events = [
    {
      ...original,
      type: null,
      title: "Untyped meal",
      recipe: { ...original.recipe!, name: "Untyped meal" },
      entry: { ...original.entry, type: null },
    },
  ];
  app.data.recipes.find((recipe) => recipe.id === original.recipe!.id)!.name = "Untyped meal";
  app.data.used_sections = [app.data.sections.find((section) => section.id === 1)!];
  await screen.findByText("Untyped meal");
  expect(screen.getByText(/per day/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Edit this item" })).toBeNull();
});

test("mobile starts in a single day and the first resize switches all section calendars together", async () => {
  const app = mountCalendar("/mealplan?start=2026-11-02", { width: 600, populated: true });
  await screen.findByRole("table", { name: "Breakfast" });
  expect(screen.queryByRole("button", { name: "Week" })).toBeNull();
  expect(screen.getAllByRole("columnheader", { name: "Monday, November 2, 2026" })).toHaveLength(3);
  vi.stubGlobal("innerWidth", 1000);
  await act(async () => window.dispatchEvent(new Event("resize")));
  await screen.findByRole("button", { name: "Week" });
  expect(screen.getAllByRole("columnheader", { name: "Sunday, November 8, 2026" })).toHaveLength(3);
  expect(app.reads.length).toBeGreaterThan(1);
});

test.each([
  ["0", "Sunday, December 30, 2018"],
  ["-1", "Friday, December 28, 2018"],
])("native first-day setting %s determines the displayed start", async (firstDay, first) => {
  mountCalendar("/mealplan?start=2019-01-02", { firstDay });
  await screen.findByRole("columnheader", { name: first });
});

test("Today is disabled within the visible range and becomes available after navigation", async () => {
  mountCalendar("/mealplan?start=2026-11-02");
  const today = await screen.findByRole<HTMLButtonElement>("button", { name: "Today" });
  expect(today.disabled).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Next week" }));
  await screen.findByRole("columnheader", { name: "Monday, November 9, 2026" });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Today" }).disabled).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Today" }));
  await screen.findByRole("columnheader", { name: "Monday, November 2, 2026" });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Today" }).disabled).toBe(true);
});

test("a first resize within the current mode consumes the one-time handler", async () => {
  const app = mountCalendar("/mealplan?start=2026-11-02");
  await screen.findByRole("button", { name: "Week" });
  vi.stubGlobal("innerWidth", 1000);
  await act(async () => window.dispatchEvent(new Event("resize")));
  vi.stubGlobal("innerWidth", 600);
  await act(async () => window.dispatchEvent(new Event("resize")));
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Week" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(app.reads).toHaveLength(1);
});

test("native responsive mode uses the document viewport width when a scrollbar crosses the breakpoint", async () => {
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(765);
  mountCalendar("/mealplan?start=2026-11-02", { width: 780 });
  await screen.findByRole("columnheader", { name: "Monday, November 2, 2026" });
  expect(screen.queryByRole("button", { name: "Week" })).toBeNull();
  expect(screen.queryByRole("columnheader", { name: "Tuesday, November 3, 2026" })).toBeNull();
});

test("an offset bookmark preserves the native calendar wall date", async () => {
  mountCalendar("/mealplan?start=2019-01-02T00:30:00+14:00&days=0");
  await screen.findByRole("columnheader", { name: "Wednesday, January 2, 2019" });
});

test("a recipe omitted for missing persisted shadow data does not add a day summary", async () => {
  const app = mountCalendar("/mealplan?start=2026-11-02", { populated: true });
  app.data.events = [app.data.events[0]!];
  app.data.internal_recipes = app.data.internal_recipes.filter(
    (recipe) => recipe.name !== "2026-11-02#101",
  );
  app.data.used_sections = [app.data.sections.find((section) => section.id === 1)!];
  await screen.findByRole("table", { name: "Breakfast" });
  expect(screen.queryByText(/per day/)).toBeNull();
});
