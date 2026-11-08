import { expect, open, test } from "nsh/test";
import { network, products, server } from "./test-fixtures";
const stockNetwork = {
  ...network,
  [`GET ${server}/api/objects/product_groups`]: { body: [] },
};

test("barcode lookup recovers from unknown codes and opens a reviewed purchase", async () => {
  let booked = 0;
  const app = await open("./App.tsx", {
    network: {
      ...stockNetwork,
      [`GET ${server}/api/stock/products/by-barcode/unknown`]: {
        status: 400,
        body: { error_message: "No product found" },
      },
      [`GET ${server}/api/stock/products/by-barcode/123456`]: {
        body: { product: products[0], stock_amount: 3 },
      },
      [`POST ${server}/api/stock/products/1/add`]: () => {
        booked++;
        return { body: [{ transaction_id: "scan-purchase" }] };
      },
    },
  });
  await app.press("Use development API key");
  await app.press("Connect");
  await app.waitFor("Oats");
  await app.press("Barcode entry");
  await app.type("Barcode", "unknown");
  await app.press("Look up barcode");
  await app.waitFor(
    "Barcode lookup failed: No product found Check the code or add the product in Settings.",
  );
  expect(app.value("Barcode")).toBe("unknown");
  await app.press("Barcode action");
  await app.press("Purchase");
  await app.clear("Barcode");
  await app.type("Barcode", "123456");
  await app.press("Look up barcode");
  await app.waitFor("Add to stock");
  expect(booked).toBe(0);
  await app.press("Add to stock");
  await app.waitFor("Purchase added.");
  expect(booked).toBe(1);
  expect(app.texts()).toContain("Undo stock change");
  expect(app.value("Barcode")).toBe("");
});

test("stock filters combine status and location and can reveal all products again", async () => {
  const app = await open("./App.tsx", { network: stockNetwork });
  await app.press("Use development API key");
  await app.press("Connect");
  await app.waitFor("Oats");
  await app.press("Filter and sort");
  await app.press("Stock status");
  await app.press("Out of stock");
  expect(app.texts()).toContain("Whole Milk");
  expect(app.texts()).not.toContain("Oats");
  await app.press("Stock location");
  await app.press("Pantry");
  expect(app.texts()).toContain("No products match these filters.");
  await app.press("Show all products");
  expect(app.texts()).toContain("Oats");
  expect(app.texts()).toContain("Whole Milk");
});
