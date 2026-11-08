import { expect, open, test } from "nsh/test";
import { network, products, server } from "./test-fixtures";
test("all products remain findable, never-due dates stay hidden, and disconnect forgets the key", async () => {
  const app = await open("./App.tsx", { network });
  await app.press("Use development API key");
  await app.press("Connect");
  await app.waitFor("Oats");
  expect(app.texts().join(" ")).not.toContain("2999-12-31");
  expect(app.texts()).toContain("Pantry");
  await app.type("Search products", "milk");
  await app.waitFor("Whole Milk");
  expect(app.texts()).toContain("Not in stock");
  expect(app.texts()).not.toContain("Use 1");
  await app.press("Settings");
  await app.press("Disconnect");
  expect(app.texts()).toContain("Connect your household");
  expect(app.value("API key")).toBe("");
  expect(app.storage()).toEqual({ "grocy.server": server });
});
test("invalid key gives a recoverable connection error", async () => {
  const app = await open("./App.tsx", {
    network: {
      [`GET ${server}/api/system/info`]: {
        status: 401,
        body: { detail: "Unauthorized" },
      },
    },
  });
  await app.press("Use development API key");
  await app.press("Connect");
  await app.waitFor("API key rejected. Check your connection settings.");
  expect(app.texts()).toContain("Connect");
});
test("one-tap use can fail, retry and undo", async () => {
  let attempt = 0,
    amount = 3;
  const app = await open("./App.tsx", {
    network: {
      ...network,
      [`GET ${server}/api/v2/stock/overview`]: () => ({
        body: {
          rows: [
            {
              product_id: 1,
              product_name: "Oats",
              amount,
              unit_label: "packs",
            },
          ],
        },
      }),
      [`POST ${server}/api/stock/products/1/consume`]: () => {
        if (++attempt === 1)
          return { status: 400, body: { error_message: "Not enough stock" } };
        amount = 2;
        return { body: [{ transaction_id: "tx-1" }] };
      },
      [`POST ${server}/api/stock/transactions/tx-1/undo`]: () => {
        amount = 3;
        return { status: 204 };
      },
    },
  });
  await app.press("Use development API key");
  await app.press("Connect");
  await app.waitFor("Oats");
  await app.press("Use 1 Oats");
  await app.waitFor("Not enough stock");
  await app.press("Use 1 Oats");
  await app.waitFor("Used 1 packs of Oats.");
  expect(app.texts()).toContain("2 packs");
  await app.press("Undo stock change");
  await app.waitFor("Stock change undone.");
  expect(app.texts()).toContain("3 packs");
});
test("create a product during purchase and preserve the editor after a booking error", async () => {
  let saved = products.slice(),
    attempt = 0;
  const app = await open("./App.tsx", {
    network: {
      ...network,
      [`GET ${server}/api/objects/products`]: () => ({ body: saved }),
      [`POST ${server}/api/objects/products`]: (req) => {
        saved = [...saved, { ...JSON.parse(req.body ?? "{}"), id: 3 }];
        return { body: { created_object_id: "3" } };
      },
      [`POST ${server}/api/stock/products/3/add`]: () =>
        ++attempt === 1
          ? { status: 400, body: { error_message: "Try the booking again" } }
          : { body: [{ transaction_id: "purchase-3" }] },
    },
  });
  await app.press("Use development API key");
  await app.press("Connect");
  await app.waitFor("Oats");
  await app.press("Add purchase");
  await app.type("New product name", "Brown rice");
  await app.press("Add to stock");
  await app.waitFor("Try the booking again");
  expect(app.texts()).toContain("Add to stock");
  await app.press("Add to stock");
  await app.waitFor("Purchase added.");
  expect(app.texts()).toContain("Brown rice");
  expect(saved.filter((r) => r.name === "Brown rice").length).toBe(1);
});
test("shopping is list-first and a batch preserves failed purchases", async () => {
  let items = [
    { id: 1, product_id: 1, amount: 1, qu_id: 1, done: false },
    { id: 2, product_id: 2, amount: 1, qu_id: 2, done: false },
  ];
  const app = await open("./App.tsx", {
    network: {
      ...network,
      [`GET ${server}/api/v2/shopping-lists`]: {
        body: [{ id: 1, name: "Groceries" }],
      },
      [`GET ${server}/api/v2/shopping-lists/1`]: () => ({ body: { items } }),
      [`PUT ${server}/api/objects/shopping_list/*`]: (req) => {
        const id = Number(req.url.split("/").pop());
        items = items.map((r) =>
          r.id === id
            ? { ...r, done: Boolean(JSON.parse(req.body ?? "{}").done) }
            : r,
        );
        return { status: 204 };
      },
      [`POST ${server}/api/v2/shopping-lists/1/items/1/purchase`]: () => {
        items = items.filter((r) => r.id !== 1);
        return {
          body: {
            purchased: true,
            bookings: [{ transaction_id: "shopping-1" }],
          },
        };
      },
      [`POST ${server}/api/v2/shopping-lists/1/items/2/purchase`]: {
        status: 400,
        body: { error_message: "Product unavailable" },
      },
    },
  });
  await app.press("Use development API key");
  await app.press("Connect");
  await app.waitFor("Oats");
  await app.press("Shopping");
  await app.waitFor("Whole Milk");
  expect(app.texts()).not.toContain("Product to add");
  await app.press("Oats");
  await app.press("Whole Milk");
  await app.waitUntil(() => app.enabled("Put away 2 items"));
  await app.press("Put away 2 items");
  await app.waitFor(
    "1 item put away. 1 failed — Whole Milk: Product unavailable",
  );
  expect(app.texts()).toContain("Whole Milk");
  expect(app.texts()).not.toContain("Oats");
  expect(app.texts()).toContain("Undo stock changes");
});
test("settings edits retain full text and require confirmation before deletion", async () => {
  let locations = [
    { id: 1, name: "Pantry", description: "Dry goods", is_freezer: 0 },
  ];
  const app = await open("./App.tsx", {
    network: {
      ...network,
      [`GET ${server}/api/objects/locations`]: () => ({ body: locations }),
      [`GET ${server}/api/objects/product_groups`]: { body: [] },
      [`PUT ${server}/api/objects/locations/1`]: (req) => {
        locations = [{ ...locations[0], ...JSON.parse(req.body ?? "{}") }];
        return { status: 204 };
      },
      [`DELETE ${server}/api/objects/locations/1`]: () => {
        locations = [];
        return { status: 204 };
      },
    },
  });
  await app.press("Use development API key");
  await app.press("Connect");
  await app.waitFor("Oats");
  await app.press("Settings");
  await app.press("Record type");
  await app.press("Locations");
  await app.waitFor("Edit Pantry");
  await app.press("Edit Pantry");
  await app.clear("Location name");
  await app.type("Location name", "Kitchen pantry");
  expect(app.value("Location name")).toBe("Kitchen pantry");
  await app.press("Save record");
  await app.waitFor("Record saved.");
  await app.press("Delete Kitchen pantry");
  await app.press("Keep record");
  expect(app.texts()).toContain("Kitchen pantry");
  await app.press("Delete Kitchen pantry");
  await app.press("Confirm delete");
  await app.waitFor("Record deleted.");
  expect(app.texts()).not.toContain("Kitchen pantry");
});

test("planning and cooking a meal updates the week and prevents duplicate cooking", async () => {
  const day = new Date();
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  let events: any[] = [];
  const app = await open("./App.tsx", {
    network: {
      ...network,
      [`GET ${server}/api/v2/recipes/overview`]: {
        body: [
          {
            id: 1,
            name: "Soup",
            desired_servings: 2,
            missing_products_count: 0,
          },
        ],
      },
      [`GET ${server}/api/v2/meal-plan/calendar*`]: () => ({
        body: { events, recipes: [], units: [] },
      }),
      [`POST ${server}/api/objects/meal_plan`]: (req) => {
        const draft = JSON.parse(req.body ?? "{}");
        events = [
          { id: 1, title: "Soup", start: date, entry: { ...draft, done: 0 } },
        ];
        return { body: { created_object_id: "1" } };
      },
      [`GET ${server}/api/v2/recipes/1/view`]: {
        body: {
          recipe_id: 1,
          cards: [
            {
              name: "Soup",
              desired_servings: 2,
              ingredients: [
                { product_name: "Oats", amount: 1, fulfilled: true },
              ],
              preparation_html: "Simmer.",
            },
          ],
        },
      },
      [`POST ${server}/api/v2/meal-plan/1/consume`]: () => {
        events = events.map((r) => ({ ...r, entry: { ...r.entry, done: 1 } }));
        return { body: { done: true } };
      },
    },
  });
  await app.press("Use development API key");
  await app.press("Connect");
  await app.waitFor("Oats");
  await app.press("Meals");
  await app.waitFor("Plan a meal");
  await app.press("Plan a meal");
  await app.press("Recipe");
  await app.press("Soup");
  await app.press("Add meal");
  await app.waitFor("Meal planned.");
  await app.press("Soup");
  await app.waitFor("Cook");
  await app.press("Cook");
  await app.waitFor("Confirm cooking");
  await app.press("Confirm cooking");
  await app.waitFor("Ingredients consumed.");
  expect(app.texts()).toContain("Soup · Cooked");
});

test("household work shares one list and task completion has undo", async () => {
  let done = 0;
  const app = await open("./App.tsx", {
    network: {
      ...network,
      [`GET ${server}/api/v2/tasks/overview*`]: () => ({
        body: {
          rows: done
            ? []
            : [{ id: 1, name: "Water plants", done: 0, due_date: null }],
        },
      }),
      [`GET ${server}/api/v2/chores/overview`]: {
        body: {
          rows: [
            {
              chore_id: 2,
              name: "Clean fridge",
              next_estimated_execution_time: null,
            },
          ],
        },
      },
      [`GET ${server}/api/v2/batteries/overview`]: {
        body: { rows: [{ id: 3, name: "Scale", charge_interval_days: 0 }] },
      },
      [`POST ${server}/api/tasks/1/complete`]: () => {
        done = 1;
        return { status: 204 };
      },
      [`POST ${server}/api/tasks/1/undo`]: () => {
        done = 0;
        return { status: 204 };
      },
    },
  });
  await app.press("Use development API key");
  await app.press("Connect");
  await app.waitFor("Oats");
  await app.press("Chores");
  await app.waitFor("Water plants");
  expect(app.texts()).toContain("Clean fridge");
  expect(app.texts()).toContain("Scale");
  await app.press("Complete Water plants");
  await app.waitFor("Recorded.");
  expect(app.texts()).not.toContain("Water plants");
  await app.press("Undo last completion");
  await app.waitFor("Completion undone.");
  expect(app.texts()).toContain("Water plants");
});
