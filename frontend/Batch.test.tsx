import { expect, open, test } from "nsh/test";
import { network, products, server } from "./test-fixtures";

test("batch inventory reviews barcode, preserves a failed zero count, and supports undo", async () => {
  let stock = 3,
    attempts = 0;
  const app = await open("./App.tsx", {
    network: {
      ...network,
      [`GET ${server}/api/stock/products/by-barcode/123`]: {
        body: { product: products[0] },
      },
      [`POST ${server}/api/stock/products/1/inventory`]: (req) => {
        if (++attempts === 1) return { status: 400, body: { message: "Count could not be saved" } };
        stock = JSON.parse(req.body ?? "{}").new_amount;
        return { body: [{ transaction_id: "count-1" }] };
      },
      [`POST ${server}/api/stock/transactions/count-1/undo`]: () => {
        stock = 3;
        return { status: 204 };
      },
    },
  });
  await app.press("Use development API key");
  await app.press("Connect");
  await app.waitFor("Oats");
  await app.press("Batch");
  await app.press("Inventory");
  await app.type("Scan or enter barcode", "123");
  await app.press("Look up barcode");
  await app.waitFor("Product found. Review the quantity before booking.");
  expect(stock).toBe(3);
  await app.clear("Counted quantity");
  await app.type("Counted quantity", "0");
  await app.press("Save count and continue");
  await app.waitFor("Count could not be saved");
  expect(app.value("Counted quantity")).toBe("0");
  await app.press("Save count and continue");
  await app.waitFor("Stock booked. Ready for the next product.");
  expect(stock).toBe(0);
  expect(app.enabled("Save count and continue")).toBe(false);
  await app.press("Undo Oats");
  await app.waitFor("Booking undone.");
  expect(stock).toBe(3);
});

test("overview uses server data and shortcuts select the correct batch action", async () => {
  const app = await open("./App.tsx", {
    network: {
      ...network,
      [`GET ${server}/api/v2/shopping-lists`]: {
        body: [{ id: 1, name: "Groceries" }],
      },
      [`GET ${server}/api/objects/recipes`]: { body: [] },
    },
  });
  await app.press("Use development API key");
  await app.press("Connect");
  await app.waitFor("Oats");
  await app.press("Overview");
  await app.waitFor("1 products in stock");
  await app.press("Consume");
  await app.waitFor("Consume and continue");
  expect(app.texts()).toContain("Spoiled / wasted");
  expect(app.texts()).not.toContain("Best-before date");
});

test("batch purchases show stock units when purchase units differ", async () => {
  let booked = 0;
  const app = await open("./App.tsx", {
    network: {
      ...network,
      [`GET ${server}/api/objects/products`]: {
        body: [{ ...products[0], qu_id_purchase: 2 }],
      },
      [`GET ${server}/api/stock/products/by-barcode/123`]: {
        body: { product: { ...products[0], qu_id_purchase: 2 } },
      },
      [`POST ${server}/api/stock/products/1/add`]: (req) => {
        booked = JSON.parse(req.body ?? "{}").amount;
        return { body: [{ transaction_id: "batch-purchase" }] };
      },
    },
  });
  await app.press("Use development API key");
  await app.press("Connect");
  await app.waitFor("Oats");
  await app.press("Batch");
  await app.type("Scan or enter barcode", "123");
  await app.press("Look up barcode");
  await app.waitFor("Oats · packs");
  expect(app.texts()).not.toContain("Oats · litres");
  await app.clear("Booking quantity");
  await app.type("Booking quantity", "3");
  await app.press("Purchase and continue");
  await app.waitFor("Stock booked. Ready for the next product.");
  expect(booked).toBe(3);
});
