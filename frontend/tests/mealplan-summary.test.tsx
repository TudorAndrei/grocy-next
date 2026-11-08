import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, onTestFinished, test } from "vitest";
import { MealPlanDaySummary, MealPlanWeekSummary } from "@/components/MealPlanSummary";
import { queryKeys } from "@/lib/api";
import { mealPlanCalendarFixture } from "./fixtures/mealplan-calendar";

function mount(children: ReactNode, stock = false, prices = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  client.setQueryData(queryKeys.systemConfig, {
    CURRENCY: "USD",
    ENERGY_UNIT: "kJ",
    FEATURE_FLAG_STOCK: stock,
    FEATURE_FLAG_SHOPPINGLIST: true,
    FEATURE_FLAG_STOCK_PRICE_TRACKING: prices,
  });
  client.setQueryData(queryKeys.userSettings, {
    stock_decimal_places_prices_display: 3,
    stock_decimal_places_amounts: 1,
  });
  const app = render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
  onTestFinished(() => {
    app.unmount();
    client.clear();
  });

  return app;
}

const callbacks = { onReload: async () => {}, getSignal: () => undefined };

test("calendar summaries display persisted aggregates with currency precision and generic energy rounding", () => {
  const context = mealPlanCalendarFixture();
  context.recipes_resolved[0]!.costs = "1234.56789";
  context.recipes_resolved[1]!.costs = "12.3456";
  context.recipes_resolved[1]!.calories = "1234.6";
  // Event edits must not replace the separately persisted internal recipe summaries.
  context.events[0]!.entry.recipe_servings = 99;
  context.events[1]!.entry.product_amount = 999;
  mount(
    <>
      <MealPlanWeekSummary context={context} {...callbacks} />
      <MealPlanDaySummary context={context} day="2026-11-02" />
    </>,
  );
  expect(screen.getByText("Week costs: $1,234.568")).toBeTruthy();
  expect(screen.getByText("$12.346 / 1,235 kJ per day")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

test("price tracking disabled keeps daily energy while hiding week and daily costs", () => {
  const context = mealPlanCalendarFixture();
  mount(
    <>
      <MealPlanWeekSummary context={context} {...callbacks} />
      <MealPlanDaySummary context={context} day="2026-11-02" />
    </>,
    false,
    false,
  );
  expect(screen.getByText("488 kJ per day")).toBeTruthy();
  expect(screen.queryByText(/Week costs/)).toBeNull();
  expect(screen.queryByText(/\$/)).toBeNull();
});

test("week summary composes native recipe actions when Stock is enabled", () => {
  const context = mealPlanCalendarFixture();
  mount(<MealPlanWeekSummary context={context} {...callbacks} />, true, false);
  expect(
    screen.getByRole("button", {
      name: "Consume all ingredients needed by this weeks recipes or products",
    }),
  ).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Put missing products on shopping list",
    }).disabled,
  ).toBe(true);
});

test("entries alone do not invent missing persisted day or week summaries", () => {
  const context = mealPlanCalendarFixture();
  context.internal_recipes = [];
  context.week_recipe = null;

  const app = mount(
    <>
      <MealPlanWeekSummary context={context} {...callbacks} />
      <MealPlanDaySummary context={context} day="2026-11-02" />
    </>,
    true,
  );

  expect(app.container.textContent).toBe("");
  expect(screen.queryByRole("button")).toBeNull();
});
