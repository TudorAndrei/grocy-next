import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { nativeEntryPage } from "@/lib/features";
import type { JsonObject } from "@/lib/json";
import { mountNativeEditor } from "./fixtures/native-editor";
import { mealPlanCalendarFixture } from "./fixtures/mealplan-calendar";

const about = {
  system_info: {
    grocy_version: { Version: "4.5.0", ReleaseDate: "2025-03-28" },
    php_version: "",
    python_version: "3.13",
    sqlite_version: "3.49",
    db_version: 254,
    os: "Linux",
    client: "Test client",
  },
  changelog: { newest_release_number: 80, changelog_items: [] },
};

test.each([
  ["stock", "STOCK", "/stockoverview"],
  ["shoppinglist", "SHOPPINGLIST", "/shoppinglist"],
  ["recipes", "RECIPES", "/recipes"],
  ["chores", "CHORES", "/choresoverview"],
  ["tasks", "TASKS", "/tasks"],
  ["batteries", "BATTERIES", "/batteriesoverview"],
  ["equipment", "EQUIPMENT", "/equipment"],
  ["calendar", "CALENDAR", "/calendar"],
  ["mealplan", "RECIPES_MEALPLAN", "/mealplan"],
])("native entry %s checks %s and resolves to %s", (entry, flag, destination) => {
  expect(nativeEntryPage({ ENTRY_PAGE: entry, [`FEATURE_FLAG_${flag}`]: true })).toBe(destination);
  expect(nativeEntryPage({ ENTRY_PAGE: entry, [`FEATURE_FLAG_${flag}`]: false })).toBe("/about");
});

test("missing entry defaults to stock, while explicit unknown or empty choices fall back to About", () => {
  expect(nativeEntryPage({})).toBe("/stockoverview");
  expect(nativeEntryPage({ FEATURE_FLAG_STOCK: false })).toBe("/about");

  for (const value of ["purchase", "consume", "unknown", "", null])
    expect(nativeEntryPage({ ENTRY_PAGE: value })).toBe("/about");
});

test.each([
  [{ ENTRY_PAGE: "purchase" }, "/house.hold"],
  [{ ENTRY_PAGE: "tasks", FEATURE_FLAG_TASKS: "0" }, ""],
] satisfies Array<[JsonObject, string]>)(
  "real root navigation sends unknown/disabled choice %j to the native About page",
  async (config, prefix) => {
    const app = mountNativeEditor(
      `${prefix}/`,
      (url) => (url === "/api/v2/system/about" ? Response.json(about) : undefined),
      config,
      { basepath: prefix || undefined },
    );

    await screen.findByRole("heading", { name: "About Grocy" });
    await screen.findByRole("table", { name: "System info" });
    expect(app.router.history.location.pathname).toBe(`${prefix}/about`);
  },
);

test("real root mealplan selection uses only the mealplan flag and opens the native planner", async () => {
  const context = mealPlanCalendarFixture();

  const app = mountNativeEditor(
    "/",
    (url) => (url.startsWith("/api/v2/meal-plan/calendar") ? Response.json(context) : undefined),
    { ENTRY_PAGE: "mealplan", FEATURE_FLAG_RECIPES: false, FEATURE_FLAG_RECIPES_MEALPLAN: true },
  );

  await screen.findByRole("heading", { name: "Meal plan" });
  expect(app.router.history.location.pathname).toBe("/mealplan");
  expect(screen.queryByRole("heading", { name: "Feature disabled" })).toBeNull();
  expect(
    within(screen.getByRole("navigation", { name: "Primary" })).queryByRole("link", {
      name: "Meal plan",
    }),
  ).toBeNull();
});
