import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { JsonObject } from "@/lib/json";
import { mountNativeEditor, notesField } from "./fixtures/native-editor";
import { nativeProductContext } from "./fixtures/native-product";

const hosts = [
  {
    name: "Product",
    route: "product/007",
    namespace: "products",
    target: "7",
    primary: "/api/objects/products/7",
    save: "Save & continue",
    main: "Name",
  },
  {
    name: "Stock entry",
    route: "stockentry/0051",
    namespace: "stock",
    target: "stock-original-uuid",
    primary: "/api/stock/entry/51",
    save: "OK",
    main: "Note",
  },
  {
    name: "Chore",
    route: "chore/7",
    namespace: "chores",
    target: "7",
    primary: "/api/objects/chores/7",
    save: "Save",
    main: "Name",
  },
  {
    name: "Recipe",
    route: "recipe/7",
    namespace: "recipes",
    target: "7",
    primary: "/api/objects/recipes/7",
    save: "Save & continue",
    main: "Name",
  },
  {
    name: "Shopping list",
    route: "shoppinglist/7",
    namespace: "shopping_lists",
    target: "7",
    primary: "/api/objects/shopping_lists/7",
    save: "Save",
    main: "Name",
  },
  {
    name: "Shopping item",
    route: "shoppinglistitem/51",
    namespace: "shopping_list",
    target: "51",
    primary: "/api/objects/shopping_list/51",
    save: "Save",
    main: "Note",
  },
  {
    name: "User",
    route: "user/007",
    namespace: "users",
    target: "7",
    primary: "/api/users/7",
    save: "Save",
    main: "Username",
  },
] as const;

type Host = (typeof hosts)[number];

function deferredResponse() {
  let release = (_response: Response) => {};

  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function mountRemaining(
  host: Host,
  options: { required?: boolean; path?: string; strict?: boolean } = {},
) {
  const load = deferredResponse();

  const fields = [
    {
      ...notesField(host.namespace),
      name: "late",
      caption: "Late note",
      sort_number: 1,
      show_as_column_in_tables: 0,
    },
    {
      ...notesField(host.namespace),
      id: 2,
      name: "returned",
      caption: "Returned flag",
      type: "checkbox",
      input_required: options.required ? 1 : 0,
      sort_number: 2,
      show_as_column_in_tables: 0,
    },
    {
      ...notesField(host.namespace),
      id: 3,
      name: "omitted",
      caption: "Omitted flag",
      type: "checkbox",
      input_required: options.required ? 1 : 0,
      sort_number: 3,
      show_as_column_in_tables: 0,
    },
    {
      ...notesField(host.namespace),
      id: 4,
      name: "clean",
      caption: "Clean note",
      sort_number: 4,
      show_as_column_in_tables: 0,
    },
  ];

  const inline = {
    late: "Inline context must not initialize native controls",
    returned: "1",
    clean: "Inline clean",
  };

  const product = {
    id: 7,
    name: "Selected product",
    active: 1,
    description: "",
    picture_file_name: null,
    location_id: 1,
    qu_id_stock: 1,
    qu_id_purchase: 1,
    qu_id_consume: 1,
    qu_id_price: 1,
    min_stock_amount: 0,
    userfields: inline,
  };

  const unit = { id: 1, name: "Piece", name_plural: "Pieces", plural_forms: null, active: 1 };

  const recipe = {
    id: 7,
    name: "Selected recipe",
    description: "",
    picture_file_name: null,
    base_servings: 1,
    desired_servings: 1,
    not_check_shoppinglist: 0,
    product_id: null,
    type: "normal",
  };

  const user = {
    id: 7,
    username: "selected-user",
    first_name: "Selected",
    last_name: "User",
    picture_file_name: null,
  };

  const userContext = {
    user,
    fields,
    values: inline,
    current_user_id: 7,
    password_controls: true,
    hidden_password: false,
    externally_managed_authentication: false,
  };

  const reads: { path: string; signal?: AbortSignal | null }[] = [];
  const writes: { path: string; method: string; body: JsonObject }[] = [];
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  const parent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});

  const app = mountNativeEditor(
    options.path ?? `/${host.route}?embedded`,
    (url, init) => {
      if (!init?.method || init.method === "GET") reads.push({ path: url, signal: init?.signal });

      if (url === `/api/objects/userfields?query[]=entity=${host.namespace}`)
        return Response.json(fields);

      if (url === "/api/v2/shopping-lists/1") return Response.json({ items: [] });

      if (
        url.startsWith(`/api/userfields/${host.namespace}/`) &&
        (!init?.method || init.method === "GET")
      )
        return url.endsWith(`/${host.target}`)
          ? load.promise.then((response) => response.clone())
          : Response.json({ late: "Replacement loaded" });

      if (url === "/api/v2/user/permissions")
        return Response.json({
          MASTER_DATA_EDIT: true,
          USERS_EDIT: true,
          USERS_EDIT_SELF: true,
          USERS_READ: true,
        });

      if (url === "/api/v2/custom-data/fields" || url === "/api/objects/userfields")
        return Response.json(fields);

      if (url === "/api/system/info")
        return Response.json({
          grocy_version: { Version: "4.5.0", ReleaseDate: "" },
          php_version: "",
          python_version: "3",
          sqlite_version: "3",
          db_version: 1,
          os: "test",
          client: "test",
        });

      if (url === "/api/user/settings")
        return Response.json({
          stock_decimal_places_amounts: 2,
          product_presets_location_id: 1,
          product_presets_qu_id: 1,
        });

      if (url.startsWith("/api/v2/products/native-editor?")) {
        const raw = new URL(url, window.location.origin).searchParams.get("row");

        return Response.json(
          nativeProductContext({
            product: raw === "new" ? null : product,
            fields,
            references: {
              locations: [{ id: 1, name: "Shelf" }],
              quantity_units: [unit],
              products: [],
              product_groups: [],
              shopping_locations: [],
            },
            user_settings: { product_presets_location_id: 1, product_presets_qu_id: 1 },
            config: { FEATURE_FLAG_STOCK: true },
          }),
        );
      }

      if (url === "/api/objects/products/7" && !init?.method) return Response.json(product);

      if (url === "/api/objects/quantity_units") return Response.json([unit]);

      if (url === "/api/objects/locations") return Response.json([{ id: 1, name: "Shelf" }]);

      if (url.startsWith("/api/v2/stock/entries/native-editor?"))
        return Response.json({
          entry: {
            id: 51,
            product_id: 7,
            stock_id: host.target,
            product_name: "Selected product",
            qu_name: "Piece",
            amount: 2,
            best_before_date: "2027-01-01",
            purchased_date: "2026-11-01",
            price: 1,
            location_id: 1,
            shopping_location_id: null,
            note: "Selected stock note",
            open: 0,
          },
          locations: [{ id: 1, name: "Shelf" }],
          stores: [],
          fields,
          values: inline,
        });

      if (url === "/api/stock/products/7")
        return Response.json({
          product,
          quantity_unit_stock: unit,
          default_quantity_unit_purchase: unit,
        });

      if (url.startsWith("/api/v2/chores/") && url.endsWith("/editor"))
        return Response.json({
          chore: {
            id: 7,
            name: "Selected chore",
            description: "",
            active: 1,
            period_type: "daily",
            period_days: 1,
            period_interval: 1,
            period_config: "",
            assignment_type: "no-assignment",
            assignment_config: "",
            track_date_only: 0,
            rollover: 0,
            consume_product_on_execution: 0,
            product_id: null,
            product_amount: null,
            userfields: inline,
          },
          has_history: false,
          initial_start_date: "2020-01-02 03:04:00",
          users: [{ id: 7, username: "owner", display_name: "Owner" }],
          products: [],
        });

      if (url.startsWith("/api/v2/recipes/editor"))
        return Response.json({
          recipe,
          positions: [],
          nestings: [],
          recipes: [recipe],
          products: [],
          units: [unit],
          conversions: [],
          fields,
          values: inline,
        });

      if (url.startsWith("/api/v2/shopping-lists/items/editor"))
        return Response.json({
          item: {
            id: 51,
            shopping_list_id: 1,
            product_id: 7,
            amount: 1,
            qu_id: 1,
            note: "Selected item note",
          },
          lists: [{ id: 1, name: "Groceries" }],
          products: [product],
          units: [unit],
          conversions: [
            {
              product_id: 7,
              from_qu_id: 1,
              to_qu_id: 1,
              factor: 1,
              to_qu_name: "Piece",
              to_qu_name_plural: "Pieces",
            },
          ],
          fields,
          values: inline,
        });

      if (url.startsWith("/api/v2/shopping-lists/editor"))
        return Response.json({ list: { id: 7, name: "Selected list" }, fields, values: inline });

      if (/^\/api\/v2\/users\/[^/]+\/form-context$/.test(url)) {
        const replacement = url.includes("/8/");

        return Response.json(
          replacement
            ? { ...userContext, user: { ...user, id: 8, username: "replacement-user" } }
            : userContext,
        );
      }

      if (init?.method === "POST" && /\/api\/v2\/content\/(products|recipes)\/editor$/.test(url))
        return new Response("<!doctype html><html><body>Editor</body></html>");

      if (
        (init?.method === "PUT" || init?.method === "POST") &&
        (url.startsWith("/api/objects/") ||
          url.startsWith("/api/userfields/") ||
          url.startsWith("/api/users/") ||
          url.startsWith("/api/stock/entry/"))
      ) {
        writes.push({ path: url, method: init.method, body: JSON.parse(String(init.body)) });

        return url === "/api/stock/entry/51"
          ? Response.json([
              { id: 901, product_id: 7, stock_id: "stock-new", transaction_id: "transaction-new" },
            ])
          : new Response(null, { status: 204 });
      }

      return undefined;
    },
    {
      FEATURE_FLAG_STOCK: true,
      FEATURE_FLAG_SHOPPINGLIST: true,
      FEATURE_FLAG_CHORES_ASSIGNMENTS: false,
    },
    {},
    options.strict
      ? {
          strictMode: true,
          prepareClient: (client) => {
            client.setQueryDefaults(["user-editor", "007"], { staleTime: Infinity });
            client.setQueryData(["user-editor", "007"], userContext);
          },
        }
      : {},
  );

  async function ready() {
    const note = await screen.findByLabelText<HTMLInputElement>("Late note");

    for (const title of host.name === "Product"
      ? ["Description"]
      : host.name === "Recipe"
        ? ["Preparation"]
        : []) {
      const frame = await screen.findByTitle<HTMLIFrameElement>(title);

      if (frame)
        await act(async () =>
          window.dispatchEvent(
            new MessageEvent("message", {
              source: frame.contentWindow,
              origin: "null",
              data: {
                channel: "grocy-description",
                kind: "ready",
                html: "",
                empty: true,
                height: 390,
                fullscreen: false,
              },
            }),
          ),
        );
    }

    return note;
  }

  return { ...app, ready, reads, writes, logger, parent, load };
}

test.each(hosts)(
  "selected native $name loads fresh fields independently and saves the loaded dirty values through its own pipeline",
  async (host) => {
    const app = mountRemaining(host, { required: true });
    const note = await app.ready();
    const main = screen.getByLabelText<HTMLInputElement>(host.main);
    const form = note.closest("form")!;
    const save = within(form).getByRole<HTMLButtonElement>("button", { name: host.save });
    await waitFor(() => expect(save.disabled).toBe(false));
    expect(main.value).not.toBe("");
    expect(note.value).toBe("");
    const returned = screen.getByLabelText<HTMLInputElement>("Returned flag");
    const omitted = screen.getByLabelText<HTMLInputElement>("Omitted flag");
    expect(returned.checked).toBe(false);
    expect(returned.required).toBe(true);
    expect(returned.indeterminate).toBe(false);
    const user = userEvent.setup();
    await user.type(note, "Local before Load");
    await user.click(returned);
    await waitFor(() =>
      expect(
        app.reads.some((read) => read.path === `/api/userfields/${host.namespace}/${host.target}`),
      ).toBe(true),
    );
    await act(async () =>
      app.load.release(
        Response.json({ late: "Fresh stored note", returned: "0", clean: "Clean loaded note" }),
      ),
    );
    await waitFor(() => expect(note.value).toBe("Fresh stored note"));
    expect(screen.getByLabelText("Late note")).toBe(note);
    expect(note.closest("form")).toBe(form);
    expect(screen.getByLabelText(host.main)).toBe(main);
    expect(returned.checked).toBe(true);
    expect(returned.required).toBe(false);
    expect(omitted.required).toBe(true);
    await user.click(omitted);
    await user.click(save);
    await waitFor(() =>
      expect(app.writes.filter((write) => write.path.startsWith("/api/userfields/"))).toHaveLength(
        3,
      ),
    );
    const fieldTarget = host.namespace === "stock" ? "transaction-new" : host.target;
    const metadata = app.writes.filter((write) => write.path.startsWith("/api/userfields/"));
    expect(metadata.map((write) => write.path)).toEqual(
      Array(3).fill(`/api/userfields/${host.namespace}/${fieldTarget}`),
    );
    expect(metadata.map((write) => write.body)).toEqual([
      { late: "Fresh stored note" },
      { returned: "1" },
      { omitted: "1" },
    ]);
    expect(app.writes.some((write) => write.path === host.primary)).toBe(true);
    expect(app.logger).not.toHaveBeenCalled();
  },
);

test.each(hosts)(
  "selected native $name custom-value503 logs without hiding or blocking its draft",
  async (host) => {
    const app = mountRemaining(host);
    const note = await app.ready();
    const user = userEvent.setup();
    await user.type(note, "Retained after denied read");
    await act(async () =>
      app.load.release(Response.json({ error_message: "Custom read denied" }, { status: 503 })),
    );
    await waitFor(() => expect(app.logger).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("Late note")).toBe(note);
    expect(note.value).toBe("Retained after denied read");
    expect(screen.queryByText("Custom read denied")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    await user.click(within(note.closest("form")!).getByRole("button", { name: host.save }));
    await waitFor(() => expect(app.writes.some((write) => write.path === host.primary)).toBe(true));
    const fieldTarget = host.namespace === "stock" ? "transaction-new" : host.target;
    await waitFor(() =>
      expect(app.writes).toContainEqual({
        path: `/api/userfields/${host.namespace}/${fieldTarget}`,
        method: "PUT",
        body: { late: "Retained after denied read" },
      }),
    );
  },
);

test("remaining native selected Load survives StrictMode warm-ready effect replay", async () => {
  const app = mountRemaining(hosts[6], { strict: true });
  const note = await app.ready();
  expect(note.value).toBe("");
  await act(async () => app.load.release(Response.json({ late: "Loaded after replay" })));
  await waitFor(() => expect(note.value).toBe("Loaded after replay"));
  expect(app.logger).not.toHaveBeenCalled();
  expect(app.writes).toEqual([]);
});

test("Product copy with custom definitions stays create initialization without reading source custom values", async () => {
  const app = mountRemaining(hosts[0], {
    path: "/product/new?copy-of=7&flow=InplaceNewProductWithName&name=Copied",
  });

  const note = await app.ready();
  await waitFor(() =>
    expect(app.reads.some((read) => read.path === "/api/objects/products/7")).toBe(true),
  );
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Copied");
  expect(note.value).toBe("");
  expect(app.reads.filter((read) => read.path.startsWith("/api/userfields/products/"))).toEqual([]);
  expect(app.writes).toEqual([]);
});

test("remaining native Load from a departed User cannot overwrite the replacement", async () => {
  const app = mountRemaining(hosts[6]);
  const note = await app.ready();
  await userEvent.type(note, "Old local draft");
  await act(async () => app.router.navigate({ href: "/user/8?embedded" }));
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>("Late note").value).toBe("Replacement loaded"),
  );
  const replacement = screen.getByLabelText<HTMLInputElement>("Late note");
  await act(async () => app.load.release(Response.json({ late: "Obsolete stored note" })));
  expect(replacement.value).toBe("Replacement loaded");
  expect(app.reads.find((read) => read.path === "/api/userfields/users/7")?.signal?.aborted).toBe(
    true,
  );
  expect(app.logger).not.toHaveBeenCalled();
  expect(app.writes).toEqual([]);
  expect(app.parent).not.toHaveBeenCalledWith(
    { Message: "Reload", Payload: null },
    window.location.origin,
  );
});
