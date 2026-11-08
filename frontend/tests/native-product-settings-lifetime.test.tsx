import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { z } from "zod";
import { queryKeys } from "@/lib/api";
import type { JsonObject } from "@/lib/json";
import type { UserSettings } from "@/lib/types";
import { mountNativeEditor } from "./fixtures/native-editor";
import { nativeProductContext } from "./fixtures/native-product";
import { supportDescriptionEditors } from "./fixtures/editor";
import { supportProductOptions } from "./fixtures/product-options";
import { pictureBytes } from "./fixtures/picture";

const initialSettings: UserSettings = {
  auto_reload_on_db_change: "1",
  stock_decimal_places_amounts: 2,
  stock_decimal_places_prices_input: 2,
  stock_decimal_places_prices_display: 2,
  stock_auto_decimal_separator_prices: true,
};

const updatedSettings: UserSettings = {
  ...initialSettings,
  stock_decimal_places_amounts: 3,
  stock_decimal_places_prices_input: 3,
  stock_decimal_places_prices_display: 3,
};

const initialConfig: JsonObject = {
  FEATURE_FLAG_STOCK: true,
  FEATURE_FLAG_SHOPPINGLIST: false,
  FEATURE_FLAG_STOCK_LOCATION_TRACKING: true,
  FEATURE_FLAG_STOCK_PRICE_TRACKING: true,
  FEATURE_FLAG_LABEL_PRINTER: true,
  ENERGY_UNIT: "kcal",
  CURRENCY: "USD",
  LABEL_PRINTER_RUN_SERVER: false,
  LABEL_PRINTER_WEBHOOK: "https://initial-printer.invalid/label",
  LABEL_PRINTER_PARAMS: { document: "initial" },
};

const updatedConfig: JsonObject = {
  ...initialConfig,
  FEATURE_FLAG_STOCK_LOCATION_TRACKING: false,
  FEATURE_FLAG_STOCK_PRICE_TRACKING: false,
  ENERGY_UNIT: "kJ",
  CURRENCY: "EUR",
  LABEL_PRINTER_WEBHOOK: "https://updated-printer.invalid/label",
  LABEL_PRINTER_PARAMS: { document: "updated" },
};

const references = {
  locations: [
    { id: 1, name: "Default" },
    { id: 2, name: "Shelf" },
  ],
  quantity_units: [{ id: 1, name: "Piece" }],
  shopping_locations: [{ id: 3, name: "Shop" }],
  product_groups: [],
  products: [],
};

const fields = [
  {
    id: 1,
    entity: "products",
    name: "reserve",
    caption: "Reserve",
    type: "number-currency",
    input_required: 0,
    default_value: null,
    config: null,
  },
];

function mount(path: string, options: { editorFailure?: boolean } = {}) {
  let updated = false;
  const reads = { settings: 0, config: 0, context: 0 };
  const writes: { url: string; body: JsonObject }[] = [];
  const hooks: { url: string; body: JsonObject }[] = [];

  const product: JsonObject & { id: number; userfields: Record<string, string | null> } = {
    id: 7,
    name: "Coffee",
    active: 1,
    description: "",
    userfields: { reserve: "1.2" },
    location_id: 2,
    default_consume_location_id: null,
    shopping_location_id: 3,
    qu_id_stock: 1,
    qu_id_purchase: 1,
    qu_id_consume: 1,
    qu_id_price: 1,
    min_stock_amount: 1.23456,
    calories: 100,
    picture_file_name: null,
    default_best_before_days: 0,
    default_best_before_days_after_open: 0,
    default_best_before_days_after_freezing: 0,
    default_best_before_days_after_thawing: 0,
    quick_consume_amount: 1,
    quick_open_amount: 1,
    default_stock_label_type: 0,
  };

  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:product-code";
      static revokeObjectURL = () => {};
    },
  );
  const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  onTestFinished(() => {
    if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility);
    else Reflect.deleteProperty(document, "visibilityState");
  });

  const app = mountNativeEditor(
    path,
    (url, init) => {
      const config = updated ? updatedConfig : initialConfig;
      const user_settings = updated ? updatedSettings : initialSettings;

      if (url.startsWith("/api/v2/products/native-editor?")) {
        reads.context++;

        return Response.json(
          nativeProductContext({ product, references, fields, config, user_settings }),
        );
      }

      if (url === "/api/system/db-changed-time")
        return Response.json({ changed_time: "2026-11-07 10:00:00" });

      if (url === "/api/user/settings") {
        reads.settings++;

        return Response.json(user_settings);
      }

      if (url === "/api/system/config") {
        reads.config++;

        return Response.json(config);
      }

      if (url === "/api/v2/custom-data/fields") return Response.json(fields);

      if (url === "/api/userfields/products/7" && !init?.method)
        return Response.json(product.userfields);

      if (url === "/api/objects/products" && !init?.method) return Response.json([product]);

      if (url === "/api/objects/products/7" && init?.method === "PUT") {
        const body: JsonObject = JSON.parse(String(init.body));
        writes.push({ url, body });
        Object.assign(product, body);

        return new Response(null, { status: 204 });
      }

      if (url === "/api/userfields/products/7" && init?.method === "PUT") {
        const body: JsonObject = JSON.parse(String(init.body));
        writes.push({ url, body });
        Object.assign(product.userfields, z.record(z.string(), z.string().nullable()).parse(body));

        return new Response(null, { status: 204 });
      }

      const rows = new Map<string, JsonObject[]>([
        ["/api/objects/locations", references.locations],
        ["/api/objects/quantity_units", references.quantity_units],
        ["/api/objects/shopping_locations", references.shopping_locations],
        ["/api/objects/product_groups", references.product_groups],
      ]).get(url);

      if (rows) return Response.json(rows);

      if (url.startsWith("/product/7/grocycode"))
        return new Response(pictureBytes, { headers: { "Content-Type": "image/png" } });

      if (url === "/api/stock/products/7/printlabel") return Response.json({ grocycode: "coffee" });

      if (
        url === initialConfig.LABEL_PRINTER_WEBHOOK ||
        url === updatedConfig.LABEL_PRINTER_WEBHOOK
      ) {
        hooks.push({ url, body: JSON.parse(String(init?.body)) });

        return new Response(null, { status: 204 });
      }

      return undefined;
    },
    initialConfig,
  );

  supportProductOptions();
  supportDescriptionEditors();
  const transport = globalThis.fetch;
  let editorRequests = 0;

  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST" && String(input).endsWith("/api/v2/content/products/editor")) {
      editorRequests++;

      if (options.editorFailure && editorRequests === 1)
        return Promise.resolve(
          new Response("Unavailable", { status: 503, statusText: "Editor unavailable" }),
        );
    }

    return transport(input, init);
  });

  return {
    ...app,
    reads,
    writes,
    hooks,
    getEditorRequests: () => editorRequests,
    update: () => {
      updated = true;
    },
  };
}

async function refresh(
  app: ReturnType<typeof mount>,
  source: "shared" | "visibility" = "visibility",
) {
  const previousSettings = app.reads.settings;
  const previousConfig = app.reads.config;
  app.update();
  await act(async () => {
    if (source === "shared") await app.client.refetchQueries({ type: "active" });
    else fireEvent(document, new Event("visibilitychange"));
  });
  await waitFor(() => {
    expect(app.reads.settings).toBeGreaterThan(previousSettings);
    expect(app.reads.config).toBeGreaterThan(previousConfig);
    expect(
      app.client.getQueryData<UserSettings>(queryKeys.userSettings)?.stock_decimal_places_amounts,
    ).toBe(3);
    expect(app.client.getQueryData<JsonObject>(queryKeys.systemConfig)?.CURRENCY).toBe("EUR");
  });
}

async function enterCurrency(value: string) {
  const reserve = screen.getByLabelText<HTMLInputElement>("Reserve");
  await userEvent.clear(reserve);
  await userEvent.type(reserve, value);
  await userEvent.tab();

  return reserve;
}

test("a native product keeps its document settings through shared refetch and adopts new settings after Save & continue", async () => {
  const app = mount("/product/7");
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  const minimum = screen.getByLabelText<HTMLInputElement>("Minimum stock");
  expect(minimum.value).toBe("1.23");
  expect(minimum.step).toBe("0.01");
  await userEvent.type(name, " draft");
  await userEvent.clear(minimum);
  await userEvent.type(minimum, "2.25");
  expect((await enterCurrency("1234")).value).toBe("12.34");
  expect(screen.getByLabelText("Energy per stock unit (kcal)")).toBeTruthy();
  const editor = await screen.findByTitle<HTMLIFrameElement>("Description");
  await act(async () => {
    descriptionChange(editor, "<p>Rich draft</p>");
  });
  await refresh(app, "shared");
  expect(name.value).toBe("Coffee draft");
  expect(minimum.value).toBe("2.25");
  expect(minimum.step).toBe("0.01");
  expect(screen.getByTitle("Description")).toBe(editor);
  expect(editor.isConnected).toBe(true);
  expect(app.getEditorRequests()).toBe(1);
  await act(async () => {
    descriptionChange(editor, "<p>Rich draft continued</p>");
  });
  expect(screen.getByLabelText("Default location")).toBeTruthy();
  expect(screen.getByLabelText("Default store")).toBeTruthy();
  expect(screen.getByLabelText("Energy per stock unit (kcal)")).toBeTruthy();
  expect(screen.queryByLabelText("Energy per stock unit (kJ)")).toBeNull();
  expect((await enterCurrency("5678")).value).toBe("56.78");
  await userEvent.click(await screen.findByRole("link", { name: "Print on label printer" }));
  await waitFor(() =>
    expect(app.hooks).toEqual([
      {
        url: "https://initial-printer.invalid/label",
        body: { grocycode: "coffee", document: "initial" },
      },
    ]),
  );
  const contextReads = app.reads.context;
  const save = screen.getByRole<HTMLButtonElement>("button", { name: "Save & continue" });
  await waitFor(() => expect(save.disabled).toBe(false));
  await userEvent.click(save);
  await waitFor(() => expect(app.reads.context).toBeGreaterThan(contextReads));
  const reloadedMinimum = await screen.findByLabelText<HTMLInputElement>("Minimum stock");
  await waitFor(() => expect(reloadedMinimum.step).toBe("0.001"));
  expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Coffee draft");
  expect(reloadedMinimum.value).toBe("2.25");
  expect(screen.queryByLabelText("Default location")).toBeNull();
  expect(screen.queryByLabelText("Default store")).toBeNull();
  expect(screen.getByLabelText("Energy per stock unit (kJ)")).toBeTruthy();
  expect(
    app.writes.find((write) => write.url === "/api/objects/products/7")?.body.description,
  ).toBe("<p>Rich draft continued</p>");
  expect(app.writes).toContainEqual({
    url: "/api/userfields/products/7",
    body: { reserve: "56.78" },
  });
  expect((await enterCurrency("5678")).value).toBe("5.678");
  await userEvent.click(await screen.findByRole("link", { name: "Print on label printer" }));
  await waitFor(() =>
    expect(app.hooks[1]).toEqual({
      url: "https://updated-printer.invalid/label",
      body: { grocycode: "coffee", document: "updated" },
    }),
  );
});

test("the modern catalog editor keeps live settings and config updates", async () => {
  const app = mount("/catalog");
  await userEvent.click(await screen.findByRole("button", { name: "Edit catalog" }));
  await userEvent.click(await screen.findByRole("button", { name: /Edit.*Coffee/ }));
  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  await userEvent.type(name, " modern draft");
  const minimum = screen.getByLabelText<HTMLInputElement>("Minimum stock");
  expect(minimum.step).toBe("0.01");
  await refresh(app);
  await waitFor(() => expect(minimum.step).toBe("0.001"));
  expect(name.value).toBe("Coffee modern draft");
  expect(screen.queryByLabelText("Default location")).toBeNull();
  expect(screen.getByLabelText("Energy per stock unit (kJ)")).toBeTruthy();
  expect((await enterCurrency("1234")).value).toBe("1.234");
  expect(app.reads.context).toBe(0);
  expect(app.writes).toEqual([]);
});

function descriptionChange(frame: HTMLIFrameElement, html: string) {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame.contentWindow,
      origin: "null",
      data: {
        channel: "grocy-description",
        kind: "change",
        html,
        empty: false,
        height: 390,
        fullscreen: false,
      },
    }),
  );
}

test("a failed native description document can be retried manually and saved", async () => {
  const app = mount("/product/7", { editorFailure: true });
  await screen.findByText("Editor unavailable");
  const save = screen.getByRole<HTMLButtonElement>("button", { name: "Save & continue" });
  expect(save.disabled).toBe(true);
  expect(app.writes).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  const editor = await screen.findByTitle<HTMLIFrameElement>("Description");
  await waitFor(() => expect(save.disabled).toBe(false));
  expect(app.getEditorRequests()).toBe(2);
  await act(async () => {
    descriptionChange(editor, "<p>Recovered native draft</p>");
  });
  await userEvent.click(save);
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(app.writes[0]).toMatchObject({
    url: "/api/objects/products/7",
    body: { description: "<p>Recovered native draft</p>" },
  });
});
