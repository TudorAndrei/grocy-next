import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { mountNativeEditor, notesField } from "./fixtures/native-editor";

const cases = [
  { entity: "locations", path: "/locations", editor: "/location", title: "Locations" },
  {
    entity: "product_groups",
    path: "/productgroups",
    editor: "/productgroup",
    title: "Product groups",
  },
  {
    entity: "shopping_locations",
    path: "/shoppinglocations",
    editor: "/shoppinglocation",
    title: "Stores",
  },
] as const;

function mount(
  path: string,
  entity: string,
  { failure = false, heldDelete = false, heldReload = false, config = {} } = {},
) {
  const records = [
    {
      id: 10,
      name: "Alpha",
      active: 1,
      description: "Keep ready",
      userfields: { note: "Shelf one" },
    },
    { id: 20, name: "Retired", active: 0, description: "Old place", userfields: {} },
    { id: 30, name: "Beta", active: 1, description: "Keep cool", userfields: {} },
  ];

  const products = [
    { id: 1, name: "Apples", product_group_id: 10, active: 1 },
    { id: 2, name: "Pears", product_group_id: 10, active: 1 },
    { id: 3, name: "Retired food", product_group_id: 10, active: 0 },
    { id: 4, name: "Milk", product_group_id: 30, active: 1 },
  ];

  let reads = 0;
  let releaseReload = () => {};

  const context = new Promise<void>((resolve) => {
    releaseReload = resolve;
  });

  let releaseDelete = () => {};

  const held = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });

  const writes: number[] = [];

  const app = mountNativeEditor(
    path,
    async (url, init) => {
      if (url === "/api/objects/" + entity) {
        reads++;

        if (heldReload && reads > 1) await context;

        return Response.json(records);
      }

      if (url === "/api/objects/userfields" || url === "/api/v2/custom-data/fields")
        return Response.json([{ ...notesField(entity), show_as_column_in_tables: 1 }]);

      if (url === "/api/objects/products") return Response.json(products);

      if (url.startsWith("/api/v2/products/context"))
        return Response.json({
          products: products.flatMap((product) =>
            product.active === 1
              ? [
                  {
                    ...product,
                    picture_file_name: null,
                    location_id: null,
                    min_stock_amount: 0,
                    qu_id_purchase: null,
                    qu_id_stock: null,
                    shopping_location_id: null,
                  },
                ]
              : [],
          ),
          locations: [],
          quantity_units: [],
          shopping_locations: [],
          product_groups: records.filter((record) => record.active === 1),
          userfields: [],
          userfield_values: [],
          user_settings: {},
          config: { FEATURE_FLAG_STOCK: true },
          locale: "en",
        });

      if (init?.method === "DELETE" && url.startsWith("/api/objects/" + entity + "/")) {
        writes.push(Number(url.split("/").at(-1)));

        if (heldDelete) await held;

        if (failure && writes.length === 1)
          return Response.json({ error_message: "Still in use" }, { status: 400 });
        const index = records.findIndex((row) => row.id === writes.at(-1));

        if (index >= 0) records.splice(index, 1);

        return new Response(null, { status: 204 });
      }

      return undefined;
    },
    { FEATURE_FLAG_STOCK: true, ...config },
  );

  return { ...app, writes, records, products, releaseDelete, releaseReload, reads: () => reads };
}

test.each(cases)(
  "$path is the native active master list with selected embedded editor links",
  async ({ entity, path, editor, title }) => {
    mount(path, entity);
    await screen.findByRole("heading", { name: title, level: 1 });
    const row = (await screen.findByRole("rowheader", { name: "Alpha" })).closest("tr")!;
    expect(screen.queryByRole("rowheader", { name: "Retired" })).toBeNull();
    expect(within(row).getByText("Keep ready")).toBeTruthy();
    expect(within(row).getByText("Shelf one")).toBeTruthy();

    const url = new URL(
      within(row).getByRole("link", { name: "Edit this item" }).getAttribute("href")!,
      "http://localhost",
    );

    expect(url.pathname).toBe(editor + "/10");
    expect(url.searchParams.has("embedded")).toBe(true);
    expect(screen.getByRole("link", { name: "Add" }).getAttribute("href")).toContain(
      editor + "/new?embedded",
    );
    expect(
      screen.getByRole("link", { name: "Configure userfields" }).getAttribute("href"),
    ).toContain("entity=" + entity);

    if (entity === "product_groups") {
      expect(within(row).getByText("2")).toBeTruthy();
      expect(
        within(row).getByRole("link", { name: "Products in Alpha" }).getAttribute("href"),
      ).toContain("product-group=10");
    }
  },
);

test.each(
  cases.flatMap((entry) => [
    { ...entry, flag: "include_disabled", checked: true, included: true },
    { ...entry, flag: "include_disabled=", checked: false, included: true },
    { ...entry, flag: "include_disabled=0", checked: true, included: true },
    { ...entry, flag: "include.disabled=1", checked: false, included: true },
    { ...entry, flag: "include+disabled=1", checked: false, included: true },
    { ...entry, flag: "include_disabled[=1", checked: false, included: false },
    { ...entry, flag: "include_disabled[]=1", checked: false, included: true },
    { ...entry, flag: "include[disabled=1", checked: false, included: true },
    { ...entry, flag: "include_disabled[x][=1", checked: false, included: true },
  ]),
)(
  "$path?$flag preserves native inclusion, checkbox and Clear behavior",
  async ({ entity, path, flag, checked, included }) => {
    const app = mount(path + "?" + flag, entity);
    const user = userEvent.setup();
    await screen.findByRole("rowheader", { name: "Alpha" });
    expect(Boolean(screen.queryByRole("rowheader", { name: "Retired" }))).toBe(included);
    const box = screen.getByRole<HTMLInputElement>("checkbox", { name: "Show disabled" });
    expect(box.checked).toBe(checked);
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "No match");
    expect(screen.queryByRole("rowheader", { name: "Retired" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(Boolean(screen.queryByRole("rowheader", { name: "Retired" }))).toBe(included);
    expect(box.checked).toBe(checked);
    expect(app.router.history.location.search).toBe("?" + flag);
    await user.click(box);
    await waitFor(() =>
      expect(app.router.history.location.search).toBe(checked ? "" : "?include_disabled"),
    );
  },
);

test("delete failure retains the selected record, then success returns to active records without flags", async () => {
  const app = mount("/locations?include_disabled", "locations", { failure: true });
  const user = userEvent.setup();
  const row = (await screen.findByRole("rowheader", { name: "Alpha" })).closest("tr")!;
  await user.click(within(row).getByRole("button", { name: "Delete this item" }));
  const dialog = screen.getByRole("dialog", { name: "Delete this item" });
  expect(
    within(dialog).getByText('Are you sure you want to delete location "Alpha"?'),
  ).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "No" }));
  expect(app.writes).toEqual([]);
  await user.click(within(row).getByRole("button", { name: "Delete this item" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Delete this item" })).getByRole("button", {
      name: "Yes",
    }),
  );
  await screen.findByText("Still in use");
  expect(screen.getByRole("rowheader", { name: "Alpha" })).toBeTruthy();
  await user.click(
    within(screen.getByRole("dialog", { name: "Delete this item" })).getByRole("button", {
      name: "Yes",
    }),
  );
  await waitFor(() => expect(screen.queryByRole("rowheader", { name: "Alpha" })).toBeNull());
  expect(screen.queryByRole("rowheader", { name: "Retired" })).toBeNull();
  expect(app.router.history.location.search).toBe("");
  expect(app.writes).toEqual([10, 10]);
});

test("leaving during deletion cannot redirect or deliver a stale list response", async () => {
  const app = mount("/locations", "locations", { heldDelete: true });
  const user = userEvent.setup();
  const row = (await screen.findByRole("rowheader", { name: "Alpha" })).closest("tr")!;
  await user.click(within(row).getByRole("button", { name: "Delete this item" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Delete this item" })).getByRole("button", {
      name: "Yes",
    }),
  );
  await waitFor(() => expect(app.writes).toEqual([10]));
  await act(async () => {
    await app.router.navigate({ to: "/settings", search: { tab: "connection" } });
  });
  await act(async () => {
    app.releaseDelete();
  });
  expect(app.router.state.location.pathname).toBe("/settings");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("product-group count links filter the native Products list and Clear retains its bookmark", async () => {
  const app = mount("/productgroups", "product_groups");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("link", { name: "Products in Alpha" }));
  await screen.findByRole("heading", { name: "Products", level: 1 });
  await screen.findByRole("button", { name: "Apples" });
  expect(screen.getByRole("button", { name: "Pears" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Milk" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Retired food" })).toBeNull();
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Product group" }).value).toBe(
    "10",
  );
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  await screen.findByRole("button", { name: "Milk" });
  expect(app.router.history.location.search).toContain("product-group=10");
});

test.each([
  { path: "/locations", entity: "locations", config: { FEATURE_FLAG_STOCK: false } },
  {
    path: "/locations",
    entity: "locations",
    config: { FEATURE_FLAG_STOCK_LOCATION_TRACKING: false },
  },
  {
    path: "/shoppinglocations",
    entity: "shopping_locations",
    config: { FEATURE_FLAG_STOCK_PRICE_TRACKING: false },
  },
])(
  "native $path reads reference records independently of its navigation flags",
  async ({ path, entity, config }) => {
    const app = mount(path, entity, { config });
    await screen.findByRole("rowheader", { name: "Alpha" });
    expect(app.fetchMock.mock.calls.some(([url]) => String(url) === "/api/objects/" + entity)).toBe(
      true,
    );
    expect(app.writes).toEqual([]);
  },
);

test("product-group masters remain available with stock disabled, matching native navigation", async () => {
  mount("/productgroups", "product_groups", { config: { FEATURE_FLAG_STOCK: false } });
  await screen.findByRole("rowheader", { name: "Alpha" });
  expect(screen.getByRole("link", { name: "Add" })).toBeTruthy();
});

test("the native product-group close message reloads records and active counts while retaining inclusion", async () => {
  const app = mount("/productgroups?include_disabled", "product_groups");
  const user = userEvent.setup();
  await screen.findByRole("rowheader", { name: "Alpha" });
  await user.type(screen.getByRole("searchbox", { name: "Search" }), "Alpha");
  app.records[0]!.name = "Changed group";
  app.products.push({ id: 5, name: "Rice", product_group_id: 10, active: 1 });
  fireEvent(
    window,
    new MessageEvent("message", {
      origin: "https://foreign.test",
      data: { Message: "CloseLastModal", Payload: null },
    }),
  );
  expect(screen.getByRole("rowheader", { name: "Alpha" })).toBeTruthy();
  fireEvent(
    window,
    new MessageEvent("message", {
      origin: window.location.origin,
      data: { Message: "CloseLastModal", Payload: null },
    }),
  );
  const row = (await screen.findByRole("rowheader", { name: "Changed group" })).closest("tr")!;
  expect(within(row).getByText("3")).toBeTruthy();
  expect(screen.getByRole("rowheader", { name: "Retired" })).toBeTruthy();
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Show disabled" }).checked).toBe(
    true,
  );
  expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" }).value).toBe("");
  expect(app.router.history.location.search).toBe("?include_disabled");
});

test("resetting reference table options finishes a delayed replacement read", async () => {
  const app = mount("/locations?include_disabled", "locations", { heldReload: true });
  const user = userEvent.setup();
  await screen.findByRole("rowheader", { name: "Alpha" });
  await user.type(screen.getByRole("searchbox", { name: "Search" }), "Alpha");
  await user.click(screen.getByRole("button", { name: "Table options" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Table options" })).getByRole("button", {
      name: "Reset",
    }),
  );
  await user.click(
    within(
      screen.getByRole("dialog", { name: "Are you sure you want to reset the table options?" }),
    ).getByRole("button", { name: "Yes" }),
  );
  await waitFor(() => expect(app.reads()).toBe(2));
  expect(screen.queryByRole("rowheader", { name: "Alpha" })).toBeNull();
  await act(async () => {
    app.releaseReload();
  });
  await screen.findByRole("rowheader", { name: "Retired" });
  expect(screen.getByRole<HTMLInputElement>("searchbox", { name: "Search" }).value).toBe("");
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Show disabled" }).checked).toBe(
    true,
  );
});
