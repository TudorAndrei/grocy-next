import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";
import { mealPlanCalendarFixture } from "./fixtures/mealplan-calendar";
import type { JsonObject } from "@/lib/json";
import { pictureBytes } from "./fixtures/picture";
import { writeApiConfig } from "@/lib/config";

function deferred() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { release, promise };
}

function mountActions(
  options: {
    hold?: string;
    fail?: string;
    done?: boolean;
    shoppingFulfilled?: boolean;
    stock?: boolean;
    shopping?: boolean;
    prices?: boolean;
    stockAmount?: number;
    pictures?: boolean;
  } = {},
) {
  const context = mealPlanCalendarFixture();

  if (options.stockAmount !== undefined) {
    context.events[1]!.product_details!.stock_amount_aggregated = options.stockAmount;
    context.events[1]!.product_details!.stock_amount = options.stockAmount;
  }

  if (options.pictures) {
    context.events[0]!.recipe!.picture_file_name = "rice.jpg";
    context.events[1]!.product_details!.product.picture_file_name = "rice-product.jpg";
    writeApiConfig({ baseUrl: "", apiKey: "meal-card-key" });
    const BrowserURL = URL;
    let image = 0;
    vi.stubGlobal(
      "URL",
      class extends BrowserURL {
        static createObjectURL() {
          return `blob:meal-card-${++image}`;
        }
        static revokeObjectURL() {}
      },
    );
  }

  for (const row of context.recipes_resolved)
    row.need_fulfilled_with_shopping_list = options.shoppingFulfilled ? 1 : 0;

  if (options.done) for (const event of context.events) event.entry.done = 1;
  const gate = deferred();
  const writes: Array<{ path: string; method: string; body: JsonObject }> = [];
  const requests: string[] = [];
  let reads = 0;
  let consumed = 0;
  let failure = options.fail;
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => logger.mockRestore());

  const app = mountNativeEditor(
    "/mealplan?start=2026-11-02",
    async (path, init) => {
      requests.push(path);

      if (path.startsWith("/api/v2/meal-plan/calendar")) {
        reads += 1;

        return Response.json(context);
      }

      if (path === "/api/user/settings") return Response.json({ stock_decimal_places_amounts: 2 });

      if (path.startsWith("/api/v2/shopping-lists/")) return Response.json({ items: [] });

      if (path.startsWith("/api/files/"))
        return new Response(pictureBytes, { headers: { "Content-Type": "image/jpeg" } });

      if (init?.method && init.method !== "GET") {
        const body: JsonObject = init.body ? JSON.parse(String(init.body)) : {};
        writes.push({ path, method: init.method, body });

        if (options.hold === path) await gate.promise;

        if (failure === path)
          return Response.json({ error_message: "Stage failed" }, { status: 503 });

        if (path === "/api/stock/products/11/consume") {
          consumed += Number(body.amount);

          return Response.json([{ transaction_id: "tx-1" }]);
        }

        if (path === "/api/stock/transactions/tx-1/undo") consumed = 0;
        const entry = /^\/api\/objects\/meal_plan\/(\d+)$/.exec(path);

        if (entry && init.method === "PUT")
          Object.assign(
            context.events.find((event) => event.entry.id === Number(entry[1]))!.entry,
            body,
          );

        if (entry && init.method === "DELETE")
          context.events = context.events.filter((event) => event.entry.id !== Number(entry[1]));

        return new Response(null, { status: 204 });
      }

      if (path === "/api/stock/products/11") {
        if (options.hold === path) await gate.promise;

        if (failure === path)
          return Response.json({ error_message: "Stage failed" }, { status: 503 });
        const details = context.events.find((event) => event.id === 102)!.product_details!;

        return Response.json({
          ...details,
          product: { ...details.product, name: "Rice current" },
          quantity_unit_stock: {
            ...details.quantity_unit_stock,
            name: "fresh-g",
            name_plural: "fresh-g",
          },
        });
      }

      if (path === "/api/v2/recipes/overview") return Response.json([]);

      return undefined;
    },
    {
      FEATURE_FLAG_RECIPES: true,
      FEATURE_FLAG_RECIPES_MEALPLAN: true,
      FEATURE_FLAG_STOCK: options.stock ?? true,
      FEATURE_FLAG_SHOPPINGLIST: options.shopping ?? true,
      FEATURE_FLAG_STOCK_PRICE_TRACKING: options.prices ?? true,
      ENERGY_UNIT: "kcal",
      CURRENCY: "USD",
    },
  );

  return {
    ...app,
    context,
    writes,
    requests,
    gate,
    logger,
    reads: () => reads,
    consumed: () => consumed,
    allowWrite: () => {
      failure = undefined;
    },
  };
}

async function cards() {
  await screen.findByRole("article", { name: "Rice dinner" });
}

function card(id: number) {
  const value = document.querySelector<HTMLElement>(`[data-entry-id="${id}"]`);

  if (!value) throw new Error("Missing meal plan event");

  return within(value);
}

async function confirmRecipe(kind: "shopping" | "consume", week = false) {
  const summary = document.querySelector<HTMLElement>(".mealplan-week-summary");

  if (week && !summary) throw new Error("Missing week summary");
  const owner = week ? within(summary!) : card(101);
  await userEvent.click(
    owner.getByRole("button", {
      name:
        kind === "shopping"
          ? "Put missing products on shopping list"
          : week
            ? "Consume all ingredients needed by this weeks recipes or products"
            : "Consume all ingredients needed by this recipe",
    }),
  );
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Yes" }));
}

test("native cards render safe notes, servings and source per-serving and product calorie values", async () => {
  const app = mountActions({ pictures: true });
  await cards();
  expect(card(101).getByText("3 servings")).toBeTruthy();
  expect(card(101).getByText("$0.75 / 163 kcal per serving")).toBeTruthy();
  expect(card(102).getByText("250 g")).toBeTruthy();
  expect(card(102).getByText("$0.50 / 1 kcal")).toBeTruthy();
  expect(card(103).getByText("Leftovers").tagName).toBe("STRONG");
  await card(101).findByRole("img", { name: "Rice dinner" });
  await card(102).findByRole("img", { name: "Rice" });

  const recipePicture = app.fetchMock.mock.calls.find(([url]) =>
    String(url).startsWith(`/api/files/recipepictures/${encodeURIComponent(btoa("rice.jpg"))}?`),
  );

  expect(recipePicture?.[1]?.headers).toEqual({ "GROCY-API-KEY": "meal-card-key" });
});

test("STOCK-off hides only recipe stock actions while product consumption remains native", async () => {
  mountActions({ stock: false });
  await cards();
  expect(
    card(101).queryByRole("button", { name: "Consume all ingredients needed by this recipe" }),
  ).toBeNull();
  expect(
    card(101).queryByRole("button", { name: "Put missing products on shopping list" }),
  ).toBeNull();
  expect(card(102).getByRole("button", { name: "Consume 250 g of Rice" })).toBeTruthy();
  expect(card(101).queryByText("Enough in stock")).toBeNull();
});

test("product shortage disables consumption and shopping opens a native full-amount embedded item", async () => {
  mountActions({ stockAmount: 100 });
  await cards();
  expect(
    card(102).getByRole<HTMLButtonElement>("button", { name: "Consume 250 g of Rice" }).disabled,
  ).toBe(true);
  await userEvent.click(card(102).getByRole("button", { name: "Add to shopping list" }));
  await waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
  const frame = new URL(document.querySelector<HTMLIFrameElement>("iframe")!.src);
  expect(frame.pathname + frame.search).toBe(
    "/shoppinglistitem/new?embedded&updateexistingproduct&list=1&product=11&amount=250",
  );
});

test("done and immediate delete write only selected entries and never consume stock", async () => {
  const app = mountActions();
  await cards();
  await userEvent.click(card(103).getByRole("button", { name: "Mark this item as done" }));
  await waitFor(() => expect(app.reads()).toBe(2));
  await cards();
  expect(
    document
      .querySelector('[data-entry-id="103"] .mealplan-event-title')
      ?.getAttribute("data-done"),
  ).toBe("true");
  await userEvent.click(card(102).getByRole("button", { name: "Delete this item" }));
  await waitFor(() => expect(app.reads()).toBe(3));
  await cards();
  expect(document.querySelector('[data-entry-id="102"]')).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(app.writes).toEqual([
    { path: "/api/objects/meal_plan/103", method: "PUT", body: { done: 1 } },
    { path: "/api/objects/meal_plan/102", method: "DELETE", body: {} },
  ]);
  expect(app.consumed()).toBe(0);
});

test("done event keeps source strike flag and exposes undone PUT without a stock action", async () => {
  const app = mountActions({ done: true });
  await cards();
  expect(
    document
      .querySelector('[data-entry-id="101"] .mealplan-event-title')
      ?.getAttribute("data-done"),
  ).toBe("true");
  await userEvent.click(card(101).getByRole("button", { name: "Mark this item as undone" }));
  await waitFor(() => expect(app.reads()).toBe(2));
  expect(app.writes[0]).toEqual({
    path: "/api/objects/meal_plan/101",
    method: "PUT",
    body: { done: 0 },
  });
});

test("display recipe writes normal desired servings before opening its exact embedded reader", async () => {
  const app = mountActions({ hold: "/api/objects/recipes/7" });
  await cards();
  await userEvent.click(card(101).getByRole("button", { name: "Display recipe" }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => app.gate.release());
  await waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
  const frame = new URL(document.querySelector<HTMLIFrameElement>("iframe")!.src);
  expect(frame.pathname + frame.search + frame.hash).toBe("/recipes?embedded&recipe=7#fullscreen");
  expect(document.body.classList.contains("fullscreen-card")).toBe(true);
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
  expect(document.body.classList.contains("fullscreen-card")).toBe(false);
  expect(app.writes[0]).toEqual({
    path: "/api/objects/recipes/7",
    method: "PUT",
    body: { desired_servings: "3" },
  });
});

test("normal shopping sets servings then adds missing products and disables only itself without reloading", async () => {
  const app = mountActions({ hold: "/api/objects/recipes/7" });
  await cards();
  await confirmRecipe("shopping");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(app.writes.map((row) => row.path)).toEqual(["/api/objects/recipes/7"]);
  expect(
    card(103).getByRole<HTMLButtonElement>("button", { name: "Mark this item as done" }).disabled,
  ).toBe(false);
  await act(async () => app.gate.release());
  await waitFor(() =>
    expect(
      card(101).getByRole<HTMLButtonElement>("button", {
        name: "Put missing products on shopping list",
      }).disabled,
    ).toBe(true),
  );
  expect(app.writes[1]).toEqual({
    path: "/api/recipes/7/add-not-fulfilled-products-to-shoppinglist",
    method: "POST",
    body: {},
  });
  expect(app.reads()).toBe(1);
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
});

test("recipe consume uses the internal shadow before a separate done PUT and native document replacement", async () => {
  const app = mountActions({ hold: "/api/objects/meal_plan/101" });
  await cards();
  await confirmRecipe("consume");
  await waitFor(() => expect(app.writes).toHaveLength(2));
  expect(app.writes).toEqual([
    { path: "/api/recipes/-201/consume", method: "POST", body: {} },
    { path: "/api/objects/meal_plan/101", method: "PUT", body: { done: 1 } },
  ]);
  expect(app.reads()).toBe(1);
  await act(async () => app.gate.release());
  await waitFor(() => expect(app.reads()).toBe(2));
  await cards();
  expect(
    document
      .querySelector('[data-entry-id="101"] .mealplan-event-title')
      ?.getAttribute("data-done"),
  ).toBe("true");
  expect(
    screen.queryByText(
      'Removed all in stock ingredients needed by recipe "Rice dinner" from stock',
    ),
  ).toBeNull();
});

test("product POST, detail GET and done PUT precede a fresh calendar without the replaced document's receipt or Undo", async () => {
  const app = mountActions({ hold: "/api/objects/meal_plan/102" });
  await cards();
  await userEvent.click(card(102).getByRole("button", { name: "Consume 250 g of Rice" }));
  await waitFor(() => expect(app.writes).toHaveLength(2));
  expect(app.requests.slice(-3)).toEqual([
    "/api/stock/products/11/consume",
    "/api/stock/products/11",
    "/api/objects/meal_plan/102",
  ]);
  expect(app.writes[0]?.body).toEqual({ amount: 250, spoiled: false });
  expect(app.context.events[1]!.entry.done).toBe(0);
  await act(async () => app.gate.release());
  await waitFor(() => expect(app.reads()).toBe(2));
  await cards();
  expect(screen.queryByText("Removed 250 fresh-g of Rice current from stock")).toBeNull();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  expect(app.writes).toHaveLength(2);
  expect(app.context.events[1]!.entry.done).toBe(1);
  expect(
    document
      .querySelector('[data-entry-id="102"] .mealplan-event-title')
      ?.getAttribute("data-done"),
  ).toBe("true");
  expect(app.consumed()).toBe(250);
});

test("week shopping omits undefined servings while week consume preserves undefined-entry source defect", async () => {
  const app = mountActions({ fail: "/api/objects/meal_plan/undefined" });
  await cards();
  await confirmRecipe("shopping", true);
  await waitFor(() => expect(app.reads()).toBe(2));
  await cards();
  expect(app.writes[0]).toEqual({ path: "/api/objects/recipes/-144", method: "PUT", body: {} });
  await confirmRecipe("consume", true);
  await screen.findByText("Error while saving, probably this item already exists");
  expect(app.writes.slice(-2)).toEqual([
    { path: "/api/recipes/-144/consume", method: "POST", body: {} },
    { path: "/api/objects/meal_plan/undefined", method: "PUT", body: { done: 1 } },
  ]);
  expect(app.reads()).toBe(2);
  expect(document.body.classList.contains("cursor-busy")).toBe(true);
});

test("failed meal-plan completion retains committed product stock and a manual retry repeats the native booking", async () => {
  const app = mountActions({ fail: "/api/objects/meal_plan/102" });
  await cards();
  await userEvent.click(card(102).getByRole("button", { name: "Consume 250 g of Rice" }));
  await screen.findByText("Error while saving, probably this item already exists");
  expect(app.writes).toEqual([
    {
      path: "/api/stock/products/11/consume",
      method: "POST",
      body: { amount: 250, spoiled: false },
    },
    { path: "/api/objects/meal_plan/102", method: "PUT", body: { done: 1 } },
  ]);
  expect(app.consumed()).toBe(250);
  expect(app.context.events[1]!.entry.done).toBe(0);
  expect(app.reads()).toBe(1);
  expect(document.body.classList.contains("cursor-busy")).toBe(true);
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  app.allowWrite();
  await userEvent.click(card(102).getByRole("button", { name: "Consume 250 g of Rice" }));
  await waitFor(() => expect(app.reads()).toBe(2));
  await cards();
  expect(app.writes.map((row) => row.path)).toEqual([
    "/api/stock/products/11/consume",
    "/api/objects/meal_plan/102",
    "/api/stock/products/11/consume",
    "/api/objects/meal_plan/102",
  ]);
  expect(app.consumed()).toBe(500);
  expect(app.context.events[1]!.entry.done).toBe(1);
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  expect(screen.queryByText("Error while saving, probably this item already exists")).toBeNull();
});

test("a later confirmation Cancel cannot discard an earlier confirmed recipe callback", async () => {
  const app = mountActions({ hold: "/api/recipes/-201/consume" });
  await cards();
  await confirmRecipe("consume");
  await userEvent.click(
    card(101).getByRole("button", { name: "Consume all ingredients needed by this recipe" }),
  );
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "No" }));
  await act(async () => app.gate.release());
  await waitFor(() => expect(app.reads()).toBe(2));
  expect(app.writes).toHaveLength(2);
});

test.each([
  {
    workflow: "shopping",
    hold: "/api/objects/recipes/7",
    next: "/api/recipes/7/add-not-fulfilled-products-to-shoppinglist",
  },
  { workflow: "consume", hold: "/api/recipes/-201/consume", next: "/api/objects/meal_plan/101" },
  { workflow: "product", hold: "/api/stock/products/11", next: "/api/objects/meal_plan/102" },
  { workflow: "display", hold: "/api/objects/recipes/7", next: undefined },
])(
  "$workflow callback cannot start its next stage after actual owner departure",
  async ({ workflow, hold, next }) => {
    const app = mountActions({ hold });
    await cards();
    app.client.setQueryData(["stock", 11], app.context.events[1]!.product_details);

    if (workflow === "product")
      await userEvent.click(card(102).getByRole("button", { name: "Consume 250 g of Rice" }));
    else if (workflow === "display")
      await userEvent.click(card(101).getByRole("button", { name: "Display recipe" }));
    else await confirmRecipe(workflow === "shopping" ? "shopping" : "consume");
    await waitFor(() => expect(app.requests).toContain(hold));
    await act(async () => app.router.navigate({ to: "/recipes", search: {} }));
    const readsAtDeparture = app.reads();
    await act(async () => app.gate.release());

    if (next) expect(app.requests).not.toContain(next);
    expect(document.querySelector("iframe")).toBeNull();
    expect(app.reads()).toBe(readsAtDeparture);
    const previousStock = app.client.getQueryState(["stock", 11]);
    expect(previousStock === undefined || previousStock.isInvalidated).toBe(true);
    expect(app.router.state.location.pathname).toBe("/recipes");
  },
);

test.each([
  { path: "/api/objects/recipes/7", workflow: "shopping", cursor: true, generic: false },
  {
    path: "/api/recipes/7/add-not-fulfilled-products-to-shoppinglist",
    workflow: "shopping",
    cursor: false,
    generic: false,
  },
  { path: "/api/recipes/-201/consume", workflow: "consume", cursor: false, generic: true },
  { path: "/api/objects/meal_plan/101", workflow: "consume", cursor: true, generic: true },
  { path: "/api/stock/products/11/consume", workflow: "product", cursor: false, generic: false },
  { path: "/api/stock/products/11", workflow: "product", cursor: false, generic: false },
])(
  "native $workflow failure at $path preserves its cursor and error stage",
  async ({ path, workflow, cursor, generic }) => {
    const app = mountActions({ fail: path });
    await cards();

    if (workflow === "product")
      await userEvent.click(card(102).getByRole("button", { name: "Consume 250 g of Rice" }));
    else await confirmRecipe(workflow === "shopping" ? "shopping" : "consume");

    if (generic)
      await screen.findByText(
        path === "/api/recipes/-201/consume"
          ? "A server error occured while processing your request"
          : "Error while saving, probably this item already exists",
      );
    else await waitFor(() => expect(app.logger).toHaveBeenCalled());
    expect(document.body.classList.contains("cursor-busy")).toBe(cursor);
    expect(app.reads()).toBe(1);

    if (workflow === "product") {
      expect(app.consumed()).toBe(path === "/api/stock/products/11/consume" ? 0 : 250);
      expect(app.context.events[1]!.entry.done).toBe(0);
    }
  },
);
