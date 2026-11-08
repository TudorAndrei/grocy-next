import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import type { EntryRow } from "@/lib/stock-entries";
import type { JournalRow } from "@/lib/stock-journal";
import { mountNativeEditor } from "./fixtures/native-editor";
import { productOverview } from "./fixtures/product-overview";

const productName = "Coffee & milk#tail";

const entry: EntryRow = {
  id: 51,
  product_id: 7,
  stock_id: "stock&branch",
  amount: 2.5,
  best_before_date: "2026-12-01",
  purchased_date: "2026-11-01",
  row_created_timestamp: "2026-11-01 12:00:00",
  price: 1.25,
  open: 0,
  location_id: 2,
  shopping_location_id: 3,
  note: null,
  qu_factor_price_to_stock: 1,
  qu_factor_purchase_to_stock: 1,
  product_name: productName,
  qu_name: "Piece",
  qu_name_plural: "Pieces",
  price_qu_name: "Piece",
  purchase_qu_name: "Piece",
  location_name: "Shelf",
  shopping_location_name: "Shop",
  enable_tare_weight_handling: 0,
  disable_open: 0,
  due_type: 1,
  product_values: {},
  stock_values: {},
};

const journal: JournalRow = {
  id: 101,
  product_id: 7,
  product_name: productName,
  amount: -2.5,
  qu_name: "Piece",
  qu_name_plural: "Pieces",
  row_created_timestamp: "2026-11-01 12:00:00",
  transaction_type: "consume",
  location_id: 2,
  location_name: "Shelf",
  user_display_name: "Owner",
  note: null,
  stock_id: "stock&branch",
  spoiled: 0,
  undone: 0,
  undone_timestamp: null,
  correlation_id: null,
  custom_values: {},
};

type Kind = "stockentries" | "stockjournal";

const label = (kind: Kind) =>
  kind === "stockentries"
    ? "More actions for stock entry 51"
    : "More actions for stock transaction 101";

function mount(
  kind: Kind,
  options: {
    denied?: boolean;
    optional?: boolean;
    basepath?: string;
    browser?: boolean;
    labelReply?: Promise<void>;
    getFailure?: boolean;
    hookFailure?: boolean;
  } = {},
) {
  const prints: { url: string; signal: AbortSignal | null | undefined }[] = [];
  const hooks: string[] = [];
  const prefix = options.basepath ?? "";

  const app = mountNativeEditor(
    `${prefix}/${kind}?product=7&marker=keep#details`,
    async (url, init) => {
      if (url === "/api/user/settings") return Response.json({ stock_decimal_places_amounts: "2" });

      if (url === "/api/v2/user/permissions")
        return Response.json(
          Object.fromEntries(
            [
              "MASTER_DATA_EDIT",
              "STOCK_PURCHASE",
              "STOCK_CONSUME",
              "STOCK_TRANSFER",
              "STOCK_INVENTORY",
              "SHOPPINGLIST_ITEMS_ADD",
            ].map((key) => [key, !options.denied]),
          ),
        );

      if (url.startsWith("/api/v2/custom-data/fields")) return Response.json([]);

      if (url.startsWith("/api/v2/shopping-lists/")) return Response.json({ items: [] });

      if (url === "/api/v2/stock/entries")
        return Response.json({
          products: [{ id: 7, name: productName }],
          locations: [
            { id: 2, name: "Shelf" },
            { id: 8, name: "Cellar" },
          ],
          stores: [{ id: 3, name: "Shop" }],
          rows: [entry],
        });

      if (url.startsWith("/api/v2/stock/journal?"))
        return Response.json({
          products: [{ id: 7, name: productName }],
          locations: [
            { id: 2, name: "Shelf" },
            { id: 8, name: "Cellar" },
          ],
          users: [{ id: 7, name: "Owner" }],
          transaction_types: ["consume"],
          rows: [journal],
        });

      if (url === "/api/stock/products/7")
        return Response.json({
          ...productOverview,
          product: { ...productOverview.product, name: productName },
        });

      if (url === "/api/v2/content/products/7")
        return Response.json({ html: "<p>Roast carefully</p>" });

      if (url === "/api/stock/products/7/price-history") return Response.json([]);

      if (url.endsWith("/printlabel")) {
        prints.push({ url, signal: init?.signal });
        await options.labelReply;

        return options.getFailure
          ? Response.json({ error_message: "private label read failure" }, { status: 500 })
          : Response.json({ label: "native-label" });
      }

      if (url === "https://printer.test/label") {
        hooks.push(String(init?.body));

        return options.hookFailure
          ? new Response("private printer diagnostic", { status: 500 })
          : new Response(null, { status: 204 });
      }

      return undefined;
    },
    {
      FEATURE_FLAG_STOCK: true,
      FEATURE_FLAG_SHOPPINGLIST: options.optional !== false,
      FEATURE_FLAG_RECIPES: options.optional !== false,
      FEATURE_FLAG_STOCK_LOCATION_TRACKING: options.optional !== false,
      FEATURE_FLAG_LABEL_PRINTER: options.optional !== false,
      LABEL_PRINTER_RUN_SERVER: !options.browser,
      LABEL_PRINTER_WEBHOOK: "https://printer.test/label",
      LABEL_PRINTER_PARAMS: {},
    },
    { basepath: prefix || undefined },
  );

  return { ...app, prints, hooks };
}

const printName = (kind: Kind) =>
  `Print ${kind === "stockentries" ? "Stock entry" : "Product"} Grocycode on label printer`;

async function print(kind: Kind) {
  await userEvent.click((await menu(kind)).getByRole("menuitem", { name: printName(kind) }));
}

function held() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

for (const kind of ["stockentries", "stockjournal"] as const) {
  test(`${kind} opens the native consume iframe with its own source prefills`, async () => {
    const { router } = mount(kind);
    await userEvent.click((await menu(kind)).getByRole("menuitem", { name: "Consume" }));
    expect(
      within(await screen.findByRole("dialog", { name: "Consume" }))
        .getByTitle<HTMLIFrameElement>("Consume")
        .getAttribute("src"),
    ).toBe(
      `${window.location.origin}/consume?embedded&product=7${kind === "stockentries" ? "&locationId=2&stockId=stock&branch" : ""}`,
    );
    expect(router.history.location.pathname).toBe(`/${kind}`);
  });

  test(`${kind} retains source permission behavior without hiding denied actions`, async () => {
    mount(kind, { denied: true });
    const items = await menu(kind);

    for (const name of [
      "Add to shopping list",
      "Purchase",
      "Consume",
      "Transfer",
      "Inventory",
      "Edit product",
    ]) {
      const action = items.getByRole("menuitem", { name });
      expect(action).toBeTruthy();

      if (kind === "stockjournal") expect(action.getAttribute("aria-disabled")).toBe("true");
      else expect(action.getAttribute("aria-disabled")).not.toBe("true");
    }

    if (kind === "stockentries") {
      await userEvent.click(items.getByRole("menuitem", { name: "Purchase" }));
      expect(
        within(await screen.findByRole("dialog", { name: "Purchase" }))
          .getByTitle<HTMLIFrameElement>("Purchase")
          .getAttribute("src"),
      ).toBe(`${window.location.origin}/purchase?embedded&product=7`);
    }
  });

  test(`${kind} opens summary as a table iframe and product overview as a local card`, async () => {
    mount(kind);
    await userEvent.click(
      (await menu(kind)).getByRole("menuitem", { name: "Stock journal summary" }),
    );
    const summary = await screen.findByRole("dialog", { name: "Stock journal summary" });
    expect(summary.classList.contains("table")).toBe(true);
    expect(within(summary).getByTitle("Stock journal summary").getAttribute("src")).toBe(
      `${window.location.origin}/stockjournal/summary?embedded&${kind === "stockentries" ? "product" : "product_id"}=7`,
    );
    await userEvent.click(within(summary).getByRole("button", { name: "Close" }));
    await userEvent.click((await menu(kind)).getByRole("menuitem", { name: "Product overview" }));
    const overview = await screen.findByRole("dialog", { name: "Product overview" });
    expect(await within(overview).findByRole("heading", { name: productName })).toBeTruthy();
    expect(within(overview).getByText("Roast carefully")).toBeTruthy();
  });

  test(`${kind} hides only optional feature menu actions`, async () => {
    mount(kind, { optional: false });
    const items = await menu(kind);

    for (const name of [
      "Add to shopping list",
      "Transfer",
      "Search for recipes containing this product",
      printName(kind),
    ])
      expect(items.queryByRole("menuitem", { name })).toBeNull();

    for (const name of [
      "Purchase",
      "Consume",
      "Inventory",
      "Product overview",
      "Stock journal summary",
      "Edit product",
    ])
      expect(items.getByRole("menuitem", { name })).toBeTruthy();
  });

  test(`${kind} requests the native row/product label without browser webhook configuration`, async () => {
    const { prints, hooks } = mount(kind);
    await print(kind);
    await waitFor(() => expect(prints).toHaveLength(1));
    expect(prints[0]?.url).toBe(
      kind === "stockentries"
        ? "/api/stock/entry/51/printlabel"
        : "/api/stock/products/7/printlabel",
    );
    expect(hooks).toEqual([]);
    expect(screen.queryByText("Label request sent")).toBeNull();
  });
}

test("pending label requests remain usable across row filtering", async () => {
  const reply = held();
  const { prints, hooks } = mount("stockentries", { browser: true, labelReply: reply.promise });
  await print("stockentries");
  await print("stockentries");
  expect(prints).toHaveLength(2);
  expect(hooks).toEqual([]);
  expect(document.body.classList.contains("cursor-busy")).toBe(false);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Location" }), "8");
  expect(screen.queryByRole("button", { name: label("stockentries") })).toBeNull();
  expect(prints.every((request) => !request.signal?.aborted)).toBe(true);
  await act(async () => {
    reply.release();
  });
  await waitFor(() => expect(hooks).toHaveLength(2));
  expect(hooks.map((body) => JSON.parse(body))).toEqual([
    { label: "native-label" },
    { label: "native-label" },
  ]);
});

test("leaving a document aborts a held label read before any browser webhook or notice", async () => {
  const reply = held();

  const { prints, hooks, router } = mount("stockjournal", {
    browser: true,
    labelReply: reply.promise,
  });

  await print("stockjournal");
  expect(prints).toHaveLength(1);
  await act(async () => {
    await router.navigate({ to: "/stockentries" });
  });
  await screen.findByRole("button", { name: label("stockentries") });
  expect(prints[0]?.signal?.aborted).toBe(true);
  await act(async () => {
    reply.release();
  });
  expect(hooks).toEqual([]);
  expect(screen.queryByText("Error while executing WebHook")).toBeNull();
});

for (const stage of ["read", "webhook"] as const) {
  test(`native label ${stage} failure follows its source notification contract`, async () => {
    const { prints, hooks } = mount("stockjournal", {
      browser: true,
      getFailure: stage === "read",
      hookFailure: stage === "webhook",
    });

    await print("stockjournal");
    await waitFor(() => expect(prints).toHaveLength(1));

    if (stage === "webhook") {
      expect(await screen.findByText("Error while executing WebHook")).toBeTruthy();
      expect(hooks).toHaveLength(1);
      await userEvent.click(
        screen.getByRole("button", { name: /Click to show technical details/ }),
      );
      expect(screen.getByText("undefined")).toBeTruthy();
    } else {
      await act(async () => {});
      expect(hooks).toEqual([]);
      expect(screen.queryByText("Error while executing WebHook")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    }

    expect(screen.queryByText(/private (printer|label)/)).toBeNull();
    expect(screen.queryByText("Label request sent")).toBeNull();
  });
}

async function menu(kind: Kind) {
  const table = await screen.findByRole("table", {
    name: kind === "stockentries" ? "Stock entries" : "Stock journal",
  });

  expect(within(table).getByText(productName)).toBeTruthy();
  await userEvent.click(await screen.findByRole("button", { name: label(kind) }));

  return within(screen.getByRole("menu", { name: label(kind) }));
}

for (const kind of ["stockentries", "stockjournal"] as const) {
  test(`${kind} exposes the full native row menu and exact peer/query destinations`, async () => {
    const prefix = kind === "stockentries" ? "/house.hold" : "/house.hold/index.php";
    mount(kind, { basepath: prefix });
    const items = await menu(kind);
    const link = (name: string) => items.getByRole("menuitem", { name });
    expect(link("Add to shopping list").getAttribute("href")).toBe(
      `${prefix}/shoppinglistitem/new?embedded&updateexistingproduct&list=1&product=7`,
    );
    expect(link("Purchase").getAttribute("href")).toBe(`${prefix}/purchase?embedded&product=7`);
    const stock = kind === "stockentries" ? "&locationId=2&stockId=stock&branch" : "";
    expect(link("Consume").getAttribute("href")).toBe(
      `${prefix}/consume?embedded&product=7${stock}`,
    );
    expect(link("Transfer").getAttribute("href")).toBe(
      `${prefix}/transfer?embedded&product=7${stock}`,
    );
    expect(link("Inventory").getAttribute("href")).toBe(`${prefix}/inventory?embedded&product=7`);
    expect(link("Search for recipes containing this product").getAttribute("href")).toBe(
      `${prefix}/recipes?search=${productName}`,
    );

    const recipes = new URL(
      link("Search for recipes containing this product").getAttribute("href")!,
      window.location.origin,
    );

    expect(recipes.searchParams.get("search")).toBe("Coffee ");
    expect(recipes.hash).toBe("#tail");
    expect(
      link(kind === "stockentries" ? "Stock journal" : "Stock entries").getAttribute("href"),
    ).toBe(
      `${prefix}/${kind === "stockentries" ? "stockjournal" : "stockentries"}?embedded&product=7`,
    );
    expect(link("Stock journal summary").getAttribute("href")).toBe(
      `${prefix}/stockjournal/summary?embedded&${kind === "stockentries" ? "product" : "product_id"}=7`,
    );
    expect(link("Edit product").getAttribute("href")).toBe(
      `${prefix}/product/7?returnto=${encodeURIComponent(`/${kind}`)}`,
    );
    expect(
      link(
        kind === "stockentries" ? "Download Stock entry Grocycode" : "Download Product Grocycode",
      ).getAttribute("href"),
    ).toBe(
      `${prefix}/${kind === "stockentries" ? "stockentry/51" : "product/7"}/grocycode?download=true`,
    );
    expect(link("Product overview")).toBeTruthy();

    if (kind === "stockentries") {
      expect(link("Consume this stock entry as spoiled")).toBeTruthy();
      expect(link("Open stock entry label in new window").getAttribute("target")).toBe("_blank");
      expect(link("Open stock entry label in new window").getAttribute("href")).toBe(
        `${prefix}/stockentry/51/label`,
      );
    }
  });
}
