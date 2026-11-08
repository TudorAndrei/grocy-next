import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { writeApiConfig } from "@/lib/config";
import type { UserSettings } from "@/lib/types";
import type { UserfieldDefinition } from "@/lib/userfields";
import type { NativeProduct } from "@/lib/native-products";
import type { JsonObject } from "@/lib/json";
import { mountNativeEditor } from "./fixtures/native-editor";
import { pictureBytes } from "./fixtures/picture";
import { productOverview } from "./fixtures/product-overview";

function fixture() {
  const products: NativeProduct[] = [
    {
      id: 1,
      name: "Apple",
      active: 1,
      location_id: 1,
      qu_id_purchase: 2,
      qu_id_stock: 1,
      product_group_id: 1,
      shopping_location_id: 1,
      min_stock_amount: 10,
      picture_file_name: "apple.png",
    },
    {
      id: 2,
      name: "Beans",
      active: 1,
      location_id: 2,
      qu_id_purchase: 1,
      qu_id_stock: 1,
      product_group_id: 2,
      shopping_location_id: null,
      min_stock_amount: 2,
      picture_file_name: null,
    },
    {
      id: 3,
      name: "Carrot",
      active: 1,
      location_id: 1,
      qu_id_purchase: 1,
      qu_id_stock: 1,
      product_group_id: null,
      shopping_location_id: null,
      min_stock_amount: 0,
      picture_file_name: null,
    },
    {
      id: 4,
      name: "Old",
      active: 0,
      location_id: null,
      qu_id_purchase: 1,
      qu_id_stock: 1,
      product_group_id: 3,
      shopping_location_id: null,
      min_stock_amount: 1,
      picture_file_name: null,
    },
  ];

  const userfields: (UserfieldDefinition & { show_as_column_in_tables: number })[] = [
    {
      id: 1,
      name: "note",
      caption: "Storage note",
      type: "text-single-line",
      input_required: 0,
      default_value: null,
      config: null,
      show_as_column_in_tables: 1,
    },
  ];

  const userfield_values: { object_id: string; name: string; value: string | null }[] = [
    { object_id: "1", name: "note", value: "Keep cold" },
  ];

  const config: JsonObject = {
    FEATURE_FLAG_STOCK: true,
    FEATURE_FLAG_STOCK_LOCATION_TRACKING: true,
    FEATURE_FLAG_STOCK_PRICE_TRACKING: true,
    CURRENCY: "USD",
  };

  const user_settings: UserSettings = {};

  return {
    products,
    locations: [
      { id: 1, name: "Fridge" },
      { id: 2, name: "Legacy shelf" },
    ],
    quantity_units: [
      { id: 1, name: "Piece" },
      { id: 2, name: "Pack" },
    ],
    product_groups: [
      { id: 1, name: "Food" },
      { id: 2, name: "food" },
    ],
    shopping_locations: [{ id: 1, name: "Market" }],
    userfields,
    userfield_values,
    user_settings,
    config,
    locale: "en",
  };
}

test("native custom columns use the first PHP-equal identity without trimming Unicode spaces", async () => {
  const app = mountProducts();
  app.data.userfields.push(
    {
      ...app.data.userfields[0]!,
      id: 2,
      name: "1",
      caption: "Hidden numeric name",
      show_as_column_in_tables: 0,
    },
    { ...app.data.userfields[0]!, id: 3, name: "01", caption: "Numeric named field" },
  );
  app.data.userfield_values = [
    { object_id: "\u00a01", name: "note", value: "Unrelated NBSP identity" },
    { object_id: "\ufeff1", name: "note", value: "Unrelated BOM identity" },
    { object_id: " \t1e0\n", name: "note", value: "First native alias" },
    { object_id: "1", name: "note", value: "Later native alias" },
    { object_id: "0x2", name: "note", value: "Unrelated hexadecimal identity" },
    { object_id: "2\u00a0", name: "note", value: "Unrelated trailing NBSP identity" },
    { object_id: "1", name: "1", value: "First numeric field name" },
    { object_id: "1", name: "01", value: "Later numeric field name" },
  ];
  const table = await screen.findByRole("table");
  await within(table).findByText("First native alias");
  expect(within(table).getByText("First numeric field name")).toBeTruthy();
  expect(
    within(table).queryByText(/Unrelated|Later native alias|Later numeric field name/),
  ).toBeNull();
});

function mountProducts(
  path = "/products",
  {
    settings = {},
    fields,
    stock = true,
    basepath = "",
    hold = false,
    failFirst = false,
    holdSettings = false,
  }: {
    settings?: UserSettings;
    fields?: (UserfieldDefinition & { show_as_column_in_tables: number })[];
    stock?: boolean;
    basepath?: string;
    hold?: boolean;
    failFirst?: boolean;
    holdSettings?: boolean;
  } = {},
) {
  const data = fixture();
  data.user_settings = settings;

  if (fields) data.userfields = fields;
  let release = () => {};

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const reads: { search: string; signal?: AbortSignal | null }[] = [];
  let settingsReads = 0;
  const writes: { key: string; value?: string }[] = [];
  const media: { path: string; key: string | null }[] = [];
  writeApiConfig({ baseUrl: "", apiKey: "products-key" });
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => `blob:product-${media.length}`;
      static revokeObjectURL = revoke;
    },
  );

  const app = mountNativeEditor(
    path,
    async (raw, options) => {
      const url = new URL(raw, window.location.href);

      if (url.pathname === "/api/v2/products/context") {
        reads.push({ search: url.search, signal: options?.signal });

        if (hold) await gate;

        if (failFirst && reads.length === 1)
          return Response.json({ error_message: "Products unavailable" }, { status: 503 });

        const keys = Array.from(url.searchParams.keys()).map((key) =>
          key.replace(/[ .]/g, "_").replace(/\[.*$/, ""),
        );

        let products = data.products.filter(
          (row) => keys.includes("include_disabled") || row.active === 1,
        );

        if (keys.includes("only_in_stock")) products = products.filter((row) => row.id === 1);

        if (keys.includes("only_out_of_stock")) products = products.filter((row) => row.id !== 1);

        return Response.json({ ...data, products });
      }

      if (raw === "/api/user/settings") {
        if (holdSettings && ++settingsReads === 1) {
          await gate;

          return Response.json({ ...settings, stock_decimal_places_amounts: 9 });
        }

        return Response.json(settings);
      }

      if (raw.startsWith("/api/user/settings/")) {
        const key = decodeURIComponent(raw.split("/").at(-1)!);

        const value =
          options?.method === "DELETE" ? undefined : JSON.parse(String(options?.body)).value;

        writes.push({ key, value });

        if (value === undefined) delete settings[key];
        else settings[key] = value;

        return new Response(null, { status: 204 });
      }

      if (
        url.pathname.includes("/api/files/productpictures/") ||
        url.pathname.endsWith("/grocycode")
      ) {
        const key = new Headers(options?.headers).get("GROCY-API-KEY");
        media.push({ path: url.pathname + url.search, key });

        return key === "products-key"
          ? new Response(pictureBytes, { headers: { "Content-Type": "image/png" } })
          : new Response("denied", { status: 403 });
      }

      if (options?.method === "DELETE" && url.pathname.startsWith("/api/objects/products/")) {
        const index = data.products.findIndex(
          (row) => row.id === Number(url.pathname.split("/").at(-1)),
        );

        if (index >= 0) data.products.splice(index, 1);

        return new Response(null, { status: 204 });
      }

      if (raw === "/api/stock/products/1")
        return Response.json({
          ...productOverview,
          product: { ...productOverview.product, id: 1, name: "Apple", picture_file_name: null },
        });

      if (raw === "/api/v2/content/products/1") return Response.json({ html: "" });

      if (raw === "/api/stock/products/1/price-history") return Response.json([]);

      if (raw.startsWith("/api/v2/shopping-lists/")) return Response.json({ items: [] });

      return undefined;
    },
    {
      FEATURE_FLAG_STOCK: stock,
      FEATURE_FLAG_STOCK_LOCATION_TRACKING: true,
      FEATURE_FLAG_STOCK_PRICE_TRACKING: true,
    },
    { basepath },
  );

  return { ...app, data, reads, writes, media, release, revoke };
}

const names = () =>
  Array.from(
    document.querySelectorAll<HTMLTableRowElement>("#products-table tbody tr[data-product-id]"),
  )
    .filter((row) => row.style.display !== "none")
    .map((row) => row.querySelector("th")?.textContent);

test("native Products renders its master columns and headers even with stock disabled", async () => {
  mountProducts("/products", { stock: false });
  const table = await screen.findByRole("table", { name: "Products" });
  expect(
    within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent),
  ).toEqual([
    "Table options",
    "Name",
    "Location",
    "Min. stock amount",
    "Default quantity unit purchase",
    "Quantity unit stock",
    "Product group",
    "Storage note",
  ]);
  expect(screen.getByRole("link", { name: "Products" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Add" }).getAttribute("href")).toBe("/product/new");
  expect(screen.getByRole("link", { name: "Configure userfields" }).getAttribute("href")).toBe(
    "/userfields?entity=products",
  );
  expect(screen.getByRole("link", { name: "Presets for new products" }).getAttribute("href")).toBe(
    "/stocksettings#productpresets",
  );
  expect(names()).toEqual(["Apple", "Beans", "Carrot"]);
  expect(within(table).queryByRole("columnheader", { name: "Barcode" })).toBeNull();
});

test("native minimum sorting, location grouping, and stable default column preferences use the complete master table", async () => {
  const app = mountProducts();
  await screen.findByRole("table", { name: "Products" });
  await waitFor(() =>
    expect(app.writes.some((write) => write.key === "datatables_state_products-table")).toBe(true),
  );

  const saved = JSON.parse(
    String(app.writes.find((write) => write.key === "datatables_state_products-table")?.value),
  );

  expect(saved.order).toEqual([[1, "asc"]]);
  expect(saved.columns.map((column: { visible: boolean }) => column.visible)).toEqual([
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    true,
  ]);
  await userEvent.click(screen.getByRole("button", { name: "Min. stock amount" }));
  expect(names()).toEqual(["Carrot", "Beans", "Apple"]);
  await userEvent.click(screen.getByRole("button", { name: "Table options" }));
  const dialog = screen.getByRole("dialog", { name: "Table options" });
  await userEvent.click(within(dialog).getByRole("radio", { name: "Location" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "OK" }));
  expect(screen.getByRole("button", { name: "Fridge" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Legacy shelf" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Fridge" }));
  expect(names()).toEqual(["Beans"]);
});

test.each([
  ["?include_disabled", true],
  ["?include_disabled=", false],
  ["?include_disabled=0", true],
  ["?include.disabled", false],
  ["?include+disabled", false],
  ["?include_disabled[]", false],
])(
  "native server-presence and raw Show disabled remain distinct for %s",
  async (query, checked) => {
    const app = mountProducts(`/products${query}`);
    await screen.findByRole("rowheader", { name: "Old" });
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Show disabled" }).checked).toBe(
      checked,
    );
    await userEvent.click(screen.getByRole("button", { name: "Clear filter" }));

    if (checked) {
      await waitFor(() => expect(screen.queryByRole("rowheader", { name: "Old" })).toBeNull());
      expect(app.router.history.location.search).toBe("");
    } else {
      expect(screen.getByRole("rowheader", { name: "Old" })).toBeTruthy();
      expect(app.router.history.location.search).toBe(query);
      expect(app.reads).toHaveLength(1);
    }
  },
);

test.each([
  ["?product-group=1", ["Apple", "Beans"], "1"],
  ["?product-group=99", ["Carrot"], ""],
  ["?product-group=01", ["Carrot"], ""],
  ["?product-group=", ["Carrot"], ""],
  ["?product-group=1&product-group=99", ["Apple", "Beans"], "1"],
  ["?%70roduct-group=1", ["Apple", "Beans", "Carrot"], "all"],
])(
  "native group lookup uses first exact raw query value and matches selected captions %s",
  async (query, expected, value) => {
    const app = mountProducts(`/products${query}`);
    await screen.findByRole("table", { name: "Products" });
    expect(names()).toEqual(expected);
    const group = screen.getByLabelText<HTMLSelectElement>("Product group");
    expect(group.value).toBe(value);
    expect(group.options).toHaveLength(3);

    if (value === "") {
      expect(group.selectedIndex).toBe(-1);
      await userEvent.click(screen.getByRole("button", { name: "Filter" }));
      expect(group.selectedIndex).toBe(-1);
    }

    await userEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(names()).toEqual(["Apple", "Beans", "Carrot"]);
    expect(app.router.history.location.search).toBe(query);
  },
);

test("stock status reloads the server subset but returns to All, and Clear retains the native stock flag defects", async () => {
  const app = mountProducts();
  await screen.findByRole("table", { name: "Products" });
  await userEvent.selectOptions(screen.getByLabelText("Status"), "in-stock");
  await waitFor(() => expect(names()).toEqual(["Apple"]));
  expect(screen.getByLabelText<HTMLSelectElement>("Status").value).toBe("all");
  expect(app.router.history.location.search).toBe("?only_in_stock=true");
  await userEvent.click(screen.getByRole("button", { name: "Clear filter" }));
  expect(names()).toEqual(["Apple"]);
  expect(app.router.history.location.search).toBe("?only_in_stock=true");
  await userEvent.selectOptions(screen.getByLabelText("Status"), "out-of-stock");
  await waitFor(() => expect(names()).toEqual(["Beans", "Carrot"]));
  await userEvent.click(screen.getByRole("checkbox", { name: "Show disabled" }));
  await screen.findByRole("rowheader", { name: "Old" });
  await userEvent.click(screen.getByRole("button", { name: "Clear filter" }));
  await waitFor(() => expect(names()).toEqual(["Beans", "Carrot"]));
  expect(app.router.history.location.search).toBe("?only_out_of_stock=true");
});

test("delayed search reads the current input and all clears only the search while fresh reentry resets filters", async () => {
  const app = mountProducts();
  await screen.findByRole("table", { name: "Products" });
  const search = screen.getByRole("searchbox", { name: "Search" });
  fireEvent.change(search, { target: { value: "Apple" } });
  fireEvent.keyUp(search);
  fireEvent.change(search, { target: { value: "Legacy shelf" } });
  expect(names()).toEqual(["Apple", "Beans", "Carrot"]);
  await waitFor(() => expect(names()).toEqual(["Beans"]));
  fireEvent.change(search, { target: { value: "all" } });
  fireEvent.keyUp(search);
  await waitFor(() => expect(names()).toEqual(["Apple", "Beans", "Carrot"]));
  app.data.products[0]!.name = "Fresh apple";
  await act(async () => {
    await app.router.navigate({ to: "/about" });
  });
  await act(async () => {
    await app.router.navigate({ to: "/products" });
  });
  await screen.findByRole("rowheader", { name: "Fresh apple" });
  expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" }).value).toBe("");
  expect(app.reads).toHaveLength(2);
});

test("hidden native image columns fetch authenticated size-specific media and retire blobs on reset", async () => {
  const app = mountProducts("/house/products", { basepath: "/house" });
  await screen.findByRole("table", { name: "Products" });
  expect(app.media).toHaveLength(0);
  expect(screen.getByRole("link", { name: "Add" }).getAttribute("href")).toBe("/house/product/new");
  await userEvent.click(screen.getByRole("button", { name: "Table options" }));
  const dialog = screen.getByRole("dialog", { name: "Table options" });
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "Grocycode" }));
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "Product picture" }));
  await screen.findByRole("img", { name: "Apple picture" });
  await screen.findByRole("img", { name: "Apple Grocycode" });
  expect(app.media).toContainEqual({ path: "/product/1/grocycode?size=25", key: "products-key" });
  expect(app.media).toContainEqual({
    path: "/api/files/productpictures/YXBwbGUucG5n?force_serve_as=picture&best_fit_width=64&best_fit_height=64",
    key: "products-key",
  });
  await userEvent.click(within(dialog).getByRole("button", { name: "Reset" }));
  await userEvent.click(
    within(
      screen.getByRole("dialog", { name: "Are you sure you want to reset the table options?" }),
    ).getByRole("button", { name: "Yes" }),
  );
  await waitFor(() => expect(app.reads).toHaveLength(2));
  expect(app.revoke).toHaveBeenCalled();
  expect(screen.queryByRole("columnheader", { name: "Product picture" })).toBeNull();
  expect(app.router.history.location.pathname).toBe("/house/products");
});

test("feature-hidden base columns retain native saved indices and all shown custom-field types preserve presence", async () => {
  const fields = [
    { id: 10, name: "link", caption: "Supplier", type: "link" },
    { id: 11, name: "file", caption: "Manual", type: "file" },
  ].map((field) => ({
    ...field,
    input_required: 0,
    default_value: null,
    config: null,
    show_as_column_in_tables: 1,
  }));

  const settings: UserSettings = {};
  const app = mountProducts("/products", { fields, settings });
  app.data.config.FEATURE_FLAG_STOCK_LOCATION_TRACKING = false;
  app.data.config.FEATURE_FLAG_STOCK_PRICE_TRACKING = false;
  app.data.products[2]!.name = null;
  app.data.products[2]!.min_stock_amount = null;
  const manual = `${btoa("product-manual.pdf")}_${btoa("Adapter manual.pdf")}_extra`;
  app.data.userfield_values.push(
    { object_id: "2", name: "link", value: null },
    { object_id: "1", name: "file", value: "0" },
    { object_id: "2", name: "file", value: manual },
  );
  const table = await screen.findByRole("table", { name: "Products" });
  expect(within(table).queryByRole("columnheader", { name: "Location" })).toBeNull();
  expect(within(table).getByRole("columnheader", { name: "Manual" })).toBeTruthy();
  const apple = screen.getByRole("rowheader", { name: "Apple" }).closest("tr")!;
  const beans = screen.getByRole("rowheader", { name: "Beans" }).closest("tr")!;
  expect(apple.lastElementChild?.textContent).toBe("0");
  expect(apple.querySelectorAll('a[href=""]')).toHaveLength(0);
  expect(beans.querySelector('a[href=""]')).toBeTruthy();

  const attachment = within(beans).getByRole<HTMLAnchorElement>("link", {
    name: "Adapter manual.pdf",
  });

  expect(attachment.getAttribute("href")).toBe(`/files/userfiles/${manual}`);
  expect(attachment.target).toBe("_blank");
  await waitFor(() =>
    expect(app.writes.some((write) => write.key === "datatables_state_products-table")).toBe(true),
  );
  const state = JSON.parse(String(settings["datatables_state_products-table"]));
  expect(state.columns).toHaveLength(12);
  expect(state.ColReorder).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  await userEvent.click(screen.getByRole("button", { name: "Table options" }));
  const options = screen.getByRole("dialog", { name: "Table options" });
  expect(within(options).queryByRole("checkbox", { name: "Location" })).toBeNull();
  expect(within(options).getByRole("radio", { name: "Supplier" })).toBeTruthy();
});

test("saved native column order, grouping and numeric sorting load without restoring old searches", async () => {
  mountProducts("/products", {
    settings: {
      "datatables_state_products-table": JSON.stringify({
        time: 1,
        order: [[3, "desc"]],
        search: { search: "Nothing matches", smart: true, regex: false, caseInsensitive: true },
        columns: Array.from({ length: 11 }, (_, index) => ({
          visible: ![7, 8, 9].includes(index),
        })),
        ColReorder: [0, 10, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      }),
      "datatables_rowGroup_products-table": JSON.stringify({ enable: true, dataSrc: "3" }),
    },
  });
  const table = await screen.findByRole("table", { name: "Products" });
  expect(
    within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent)
      .slice(0, 4),
  ).toEqual(["Table options", "Storage note", "Name", "Location"]);
  expect(screen.getByRole("button", { name: "Fridge" })).toBeTruthy();
  expect(names()).toEqual(["Apple", "Carrot", "Beans"]);
  expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" }).value).toBe("");
});

test("a failed fresh products context can retry without falling back to the previous catalog", async () => {
  const app = mountProducts("/products", { failFirst: true });
  await screen.findByText("Products unavailable");
  expect(screen.queryByRole("table", { name: "Products" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("table", { name: "Products" });
  expect(app.reads).toHaveLength(2);
  expect(names()).toEqual(["Apple", "Beans", "Carrot"]);
});

test("authoritative native context settings do not wait for or yield to a held older settings read", async () => {
  const app = mountProducts("/products", {
    settings: { stock_decimal_places_amounts: 2 },
    holdSettings: true,
  });

  await screen.findByRole("table", { name: "Products" });
  expect(
    app.client.getQueryData<UserSettings>(["user", "settings"])?.stock_decimal_places_amounts,
  ).toBe(2);
  await act(async () => app.release());
  expect(
    app.client.getQueryData<UserSettings>(["user", "settings"])?.stock_decimal_places_amounts,
  ).toBe(2);
});

test("successful row deletion retires a hash-only page state and reads a fresh master table", async () => {
  const app = mountProducts("/products#details");
  await screen.findByRole("table", { name: "Products" });
  const apple = screen.getByRole("rowheader", { name: "Apple" }).closest("tr")!;
  await userEvent.click(within(apple).getByRole("button", { name: "Delete this item" }));
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "Delete this item" })).getByRole("button", {
      name: "Yes",
    }),
  );
  await waitFor(() => expect(names()).toEqual(["Beans", "Carrot"]));
  expect(app.reads).toHaveLength(2);
  expect(app.router.history.location.hash).toBe("");
});

test("product names open the retained native Product overview modal without editing the master record", async () => {
  const app = mountProducts();
  await userEvent.click(await screen.findByRole("button", { name: "Apple" }));
  const dialog = screen.getByRole("dialog", { name: "Product overview" });
  await within(dialog).findByRole("heading", { name: "Apple" });
  expect(app.reads).toHaveLength(1);
  await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog", { name: "Product overview" })).toBeNull();
  expect(names()).toEqual(["Apple", "Beans", "Carrot"]);
});

test("leaving a held native products context aborts the owner and prevents a late table mount", async () => {
  const app = mountProducts("/products", { hold: true });
  await waitFor(() => expect(app.reads).toHaveLength(1));
  await act(async () => {
    await app.router.navigate({ to: "/about" });
  });
  expect(app.reads[0]?.signal?.aborted).toBe(true);
  await act(async () => app.release());
  expect(screen.queryByRole("table", { name: "Products" })).toBeNull();
});
