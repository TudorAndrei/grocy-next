import { act, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { JsonObject } from "@/lib/json";
import { mountNativeEditor, notesField } from "./native-editor";
import { nativeProductContext } from "./native-product";
import { productOverview } from "./product-overview";

export const nativeCreateHosts = [
  { route: "/equipment/new", namespace: "equipment" },
  { route: "/battery/new", namespace: "batteries" },
  { route: "/task/new", namespace: "tasks" },
  { route: "/taskcategory/new", namespace: "task_categories" },
  { route: "/location/new", namespace: "locations" },
  { route: "/productgroup/new", namespace: "product_groups" },
  { route: "/shoppinglocation/new", namespace: "shopping_locations" },
  { route: "/quantityunit/new", namespace: "quantity_units" },
  { route: "/quantityunitconversion/new?qu-unit=1", namespace: "quantity_unit_conversions" },
  { route: "/userobject/tools/new", namespace: "userentity-tools" },
  { route: "/product/new", namespace: "products" },
  { route: "/chore/new", namespace: "chores" },
  { route: "/recipe/new", namespace: "recipes" },
  { route: "/shoppinglist/new", namespace: "shopping_lists" },
  { route: "/shoppinglistitem/new", namespace: "shopping_list" },
  { route: "/user/new", namespace: "users" },
  { route: "/productbarcodes/new?product=7", namespace: "product_barcodes" },
  { route: "/purchase", namespace: "stock" },
  { route: "/inventory", namespace: "stock" },
] as const;

export const nativeUserfieldHosts = [
  ...nativeCreateHosts,
  { route: "/stockentry/51", namespace: "stock" },
  { route: "/choretracking", namespace: "chores_log" },
  { route: "/batterytracking", namespace: "battery_charge_cycles" },
] as const;

type Host = (typeof nativeUserfieldHosts)[number];

function deferredResponse() {
  let release = (_response: Response) => {};

  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

export function mountNativeUserfieldsHost(
  host: Host,
  options: {
    raw?: boolean;
    strict?: boolean;
    holdFields?: boolean;
    noFields?: boolean;
    singlePreset?: boolean;
    showPurchased?: boolean;
    localization?: JsonObject;
    config?: JsonObject;
  } = {},
) {
  const init = deferredResponse(),
    clear = deferredResponse(),
    metadata = deferredResponse();

  const definition = (
    id: number,
    name: string,
    caption: string,
    type: string,
    required = 0,
    defaultValue: string | null = null,
  ) => ({
    ...notesField(host.namespace),
    id,
    name,
    caption,
    type,
    input_required: required,
    default_value: defaultValue,
    sort_number: id,
    show_as_column_in_tables: 0,
  });

  const fields = options.noFields
    ? []
    : [
        definition(1, "day", "Created day", "date", 0, "now"),
        definition(2, "at", "Created time", "datetime", 0, "now"),
        definition(3, "ack", "Acknowledge", "checkbox", 1),
        definition(4, "omitted", "Omitted acknowledgement", "checkbox", 1),
        definition(5, "text", "Local text", "text-single-line", 0, "Configured text default"),
        ...(options.raw
          ? [
              definition(6, "raw", "Raw control", "text-single-line", 1),
              definition(7, "optional", "Optional acknowledgement", "checkbox"),
            ]
          : []),
        ...(options.singlePreset
          ? [{ ...definition(8, "choice", "Preset choice", "preset-list"), config: "Alpha\nBeta" }]
          : []),
      ];

  const product = {
    ...productOverview.product,
    active: 1,
    location_id: 1,
    qu_id_stock: 1,
    qu_id_purchase: 1,
    qu_id_consume: 1,
    qu_id_price: 1,
    userfields: null,
  };

  const units = [
    {
      id: 1,
      name: "Piece",
      name_plural: "Pieces",
      plural_forms: null,
      active: 1,
      description: null,
    },
    {
      id: 2,
      name: "Bottle",
      name_plural: "Bottles",
      plural_forms: null,
      active: 1,
      description: null,
    },
  ];

  const entity = {
    id: 8,
    name: "tools",
    caption: "Tools",
    description: null,
    show_in_sidebar_menu: 0,
    icon_css_class: null,
  };

  const catalog = {
    barcode_lookup_plugin_name: "",
    products: [{ id: 7, name: "Coffee" }],
    locations: [{ id: 1, name: "Shelf", is_freezer: 0 }],
    stores: [],
    units,
    barcodes: [],
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
  };

  const reads: { path: string; signal?: AbortSignal | null }[] = [];
  const definitionReads: { signal?: AbortSignal | null }[] = [];
  const writes: { path: string; body: JsonObject }[] = [];
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  const messages = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});

  const app = mountNativeEditor(
    host.route,
    (path, request) => {
      const url = new URL(path, window.location.origin);

      if (path.startsWith("/api/v2/localization") && options.localization)
        return Response.json(options.localization);

      if (!request?.method || request.method === "GET")
        reads.push({ path, signal: request?.signal });

      if (
        url.pathname === "/api/objects/userfields" &&
        url.searchParams.get("query[]") === `entity=${host.namespace}`
      ) {
        const index = definitionReads.push({ signal: request?.signal });

        return (index === 1 || options.strict ? init.promise : clear.promise).then((response) =>
          response.clone(),
        );
      }

      if (path === "/api/objects/userfields" || path === "/api/v2/custom-data/fields")
        return Response.json(fields);

      if (path === "/api/v2/shopping-lists/1") return Response.json({ items: [] });

      if (path === "/api/v2/user/permissions")
        return Response.json({
          MASTER_DATA_EDIT: true,
          USERS_CREATE: true,
          USERS_READ: true,
          USERS_EDIT_SELF: true,
        });

      if (path === "/api/user/settings")
        return Response.json({
          stock_decimal_places_amounts: 2,
          product_presets_location_id: 1,
          product_presets_qu_id: 1,
          stock_default_purchase_amount: 1,
          show_purchased_date_on_purchase: options.showPurchased ?? false,
        });

      if (path === "/api/system/info")
        return Response.json({
          grocy_version: { Version: "4.5.0", ReleaseDate: "" },
          php_version: "",
          python_version: "3",
          sqlite_version: "3",
          db_version: 1,
          os: "test",
          client: "test",
        });

      if (path === "/api/objects/quantity_units") return Response.json(units);

      if (path === "/api/objects/quantity_unit_conversions") return Response.json([]);

      if (path === "/api/objects/products/7") return Response.json(product);

      if (path === "/api/objects/shopping_locations") return Response.json([]);

      if (path === "/api/v2/quantity-unit-conversions/resolved?product=7")
        return Response.json({
          product,
          units,
          rows: [{ id: 1, from_qu_id: 1, to_qu_id: 1, factor: "1" }],
        });

      if (path === "/api/v2/custom-data/userobjects/tools")
        return Response.json({ userentity: entity, fields, rows: [] });

      if (path === "/api/objects/userentities") return Response.json([entity]);

      if (path.startsWith("/api/v2/stock/entries/native-editor?"))
        return Response.json({
          entry: {
            id: 51,
            product_id: 7,
            stock_id: "native-stock-uuid",
            product_name: "Coffee",
            qu_name: "Piece",
            amount: 2,
            best_before_date: "2028-01-01",
            purchased_date: "2028-02-03",
            price: 1,
            location_id: 1,
            shopping_location_id: null,
            note: "Stock note",
            open: 0,
          },
          locations: [{ id: 1, name: "Shelf" }],
          stores: [],
          fields,
          values: {},
        });

      if (path === "/api/userfields/stock/native-stock-uuid" && !request?.method)
        return init.promise.then((response) => response.clone());

      if (path === "/api/objects/chores" || path === "/api/objects/batteries")
        return Response.json([]);

      if (path === "/api/v2/chores/tracking/users")
        return Response.json([{ id: 7, username: "owner", display_name: "Owner" }]);

      if (path.startsWith("/api/v2/products/native-editor?"))
        return Response.json(
          nativeProductContext({
            product: null,
            fields,
            references: {
              locations: [{ id: 1, name: "Shelf" }],
              quantity_units: units,
              products: [],
              product_groups: [],
              shopping_locations: [],
            },
            user_settings: { product_presets_location_id: 1, product_presets_qu_id: 1 },
            config: { FEATURE_FLAG_STOCK: true },
          }),
        );

      if (path === "/api/v2/chores/new/editor")
        return Response.json({
          chore: null,
          has_history: false,
          initial_start_date: "2020-01-02 03:04:00",
          users: [{ id: 7, username: "owner", display_name: "Owner" }],
          products: [],
        });

      if (path === "/api/v2/recipes/editor")
        return Response.json({
          recipe: null,
          positions: [],
          nestings: [],
          recipes: [],
          products: [],
          units,
          conversions: [],
          fields,
          values: {},
        });

      if (path === "/api/v2/shopping-lists/editor")
        return Response.json({ list: null, fields, values: {} });

      if (path === "/api/v2/shopping-lists/items/editor")
        return Response.json({
          item: null,
          lists: [{ id: 1, name: "Groceries" }],
          products: [product],
          units,
          conversions: catalog.conversions,
          fields,
          values: {},
        });

      if (path === "/api/v2/users/new/form-context")
        return Response.json({
          user: null,
          fields,
          values: {},
          current_user_id: 7,
          password_controls: true,
          hidden_password: false,
          externally_managed_authentication: false,
        });

      if (path === "/api/v2/stock/purchase/editor" || path === "/api/v2/stock/inventory/editor")
        return Response.json(catalog);

      if (path === "/api/stock/products/7")
        return Response.json({
          ...productOverview,
          product: {
            ...product,
            enable_tare_weight_handling: 0,
            tare_weight: 0,
            default_best_before_days: 5,
            default_best_before_days_after_freezing: -1,
            default_purchase_price_type: 0,
            default_stock_label_type: 0,
          },
          stock_amount: 2,
          quantity_unit_stock: units[0],
          default_quantity_unit_purchase: units[0],
          location: { id: 1, is_freezer: 0 },
          last_price: 1,
          last_shopping_location_id: null,
          default_shopping_location_id: null,
          next_due_date: "2999-12-31",
        });

      if (
        request?.method === "POST" &&
        /\/api\/v2\/content\/(equipment|products|recipes)\/editor$/.test(path)
      )
        return new Response("<!doctype html><html><body>Editor</body></html>");

      if (
        (request?.method === "POST" || request?.method === "PUT") &&
        (path.startsWith("/api/objects/") ||
          path.startsWith("/api/userfields/") ||
          path.startsWith("/api/stock/products/"))
      ) {
        writes.push({ path, body: JSON.parse(String(request.body)) });

        if (path.startsWith("/api/userfields/"))
          return options.holdFields
            ? metadata.promise.then((response) => response.clone())
            : new Response(null, { status: 204 });

        if (path.endsWith("/add") || path.endsWith("/inventory"))
          return Response.json([
            {
              id: 90,
              product_id: 7,
              amount: 1,
              stock_id: "stock-new",
              transaction_id: "transaction-new",
              transaction_type: "purchase",
            },
          ]);

        return Response.json({ created_object_id: "41" });
      }

      return undefined;
    },
    {
      FEATURE_FLAG_STOCK: true,
      FEATURE_FLAG_CHORES_ASSIGNMENTS: false,
      FEATURE_FLAG_SHOPPINGLIST: true,
      FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: false,
      FEATURE_FLAG_STOCK_PRICE_TRACKING: false,
      FEATURE_FLAG_STOCK_LOCATION_TRACKING: false,
      ...options.config,
    },
    {},
    { strictMode: options.strict },
  );

  async function ready() {
    const day = await screen.findByLabelText<HTMLInputElement>("Created day");

    const title =
      host.namespace === "equipment"
        ? "Notes"
        : host.namespace === "products"
          ? "Description"
          : host.namespace === "recipes"
            ? "Preparation"
            : undefined;

    if (title) {
      const frame = await screen.findByTitle<HTMLIFrameElement>(title);
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

    return day;
  }

  return {
    ...app,
    ready,
    init,
    clear,
    metadata,
    fields,
    reads,
    definitionReads,
    writes,
    logger,
    messages,
  };
}
