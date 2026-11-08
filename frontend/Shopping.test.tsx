import { expect, open, test } from "nsh/test";
import { network, server } from "./test-fixtures";

test("in-store checks recover from a failed sync and item edits survive a rejected save", async () => {
  let item = {
    id: 1,
    product_id: 1,
    amount: 2,
    qu_id: 1,
    note: "Breakfast",
    done: 0,
  };
  let checkAttempt = 0,
    editAttempt = 0;
  const app = await open("./App.tsx", {
    network: {
      ...network,
      [`GET ${server}/api/v2/shopping-lists`]: {
        body: [{ id: 1, name: "Weekly" }],
      },
      [`GET ${server}/api/v2/shopping-lists/1`]: () => ({
        body: { items: [item] },
      }),
      [`PUT ${server}/api/objects/shopping_list/1`]: (req) => {
        const patch = JSON.parse(req.body ?? "{}");
        if (patch.done !== undefined && ++checkAttempt === 1)
          return { status: 400, body: { message: "Check was not saved" } };
        if (patch.amount !== undefined && ++editAttempt === 1)
          return { status: 400, body: { message: "Quantity was not saved" } };
        item = { ...item, ...patch };
        return { status: 204 };
      },
    },
  });
  await app.press("Use development API key");
  await app.press("Connect");
  await app.waitFor("Oats");
  await app.press("Shopping");
  await app.waitUntil(() => app.enabled("In-store mode"));
  await app.press("In-store mode");
  await app.waitFor("0 of 1 collected. Tap a product to check it off.");
  await app.press("Oats");
  await app.waitFor("Check was not saved");
  expect(app.texts()).toContain("0 of 1 collected. Tap a product to check it off.");
  await app.press("Oats");
  await app.waitFor("1 of 1 collected. Tap a product to check it off.");
  await app.press("Finish in-store mode");
  await app.press("Edit Oats");
  await app.clear("Quantity (packs)");
  await app.type("Quantity (packs)", "3");
  await app.press("Save item");
  await app.waitFor("Quantity was not saved");
  expect(app.value("Quantity (packs)")).toBe("3");
  await app.press("Save item");
  await app.waitFor("Item saved.");
  expect(app.texts()).toContain("3 packs");
});

test("create and rename a shopping list, then cancel its deletion", async () => {
  let lists = [{ id: 1, name: "Weekly" }];
  const app = await open("./App.tsx", {
    network: {
      ...network,
      [`GET ${server}/api/v2/shopping-lists`]: () => ({ body: lists }),
      [`GET ${server}/api/v2/shopping-lists/*`]: { body: { items: [] } },
      [`POST ${server}/api/objects/shopping_lists`]: (req) => {
        lists.push({ id: 2, name: JSON.parse(req.body ?? "{}").name });
        return { body: { created_object_id: "2" } };
      },
      [`PUT ${server}/api/objects/shopping_lists/2`]: (req) => {
        lists[1] = { id: 2, name: JSON.parse(req.body ?? "{}").name };
        return { status: 204 };
      },
    },
  });
  await app.press("Use development API key");
  await app.press("Connect");
  await app.waitFor("Oats");
  await app.press("Shopping");
  await app.waitFor("Your list is clear.");
  await app.press("New list");
  await app.type("List name", "Weekend");
  await app.press("Create list");
  await app.waitFor("List created.");
  expect(app.texts()).toContain("Weekend");
  await app.press("Manage list");
  await app.clear("List name");
  await app.type("List name", "Party");
  await app.press("Save list");
  await app.waitFor("List saved.");
  expect(app.texts()).toContain("Party");
  await app.press("Manage list");
  await app.press("Delete list");
  await app.waitFor("Delete Party? This cannot be undone.");
  await app.press("Keep list");
  expect(app.texts()).not.toContain("Confirm delete list");
});
