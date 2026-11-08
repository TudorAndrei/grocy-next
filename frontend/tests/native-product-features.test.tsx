import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { z } from "zod";
import type { JsonObject } from "@/lib/json";
import { mountNativeEditor, notesField } from "./fixtures/native-editor";
import { nativeProductContext } from "./fixtures/native-product";
import { supportDescriptionEditors } from "./fixtures/editor";
import { supportProductOptions } from "./fixtures/product-options";

const flags = {
  FEATURE_FLAG_STOCK: true,
  FEATURE_FLAG_RECIPES: true,
  FEATURE_FLAG_SHOPPINGLIST: false,
  FEATURE_FLAG_STOCK_LOCATION_TRACKING: true,
  FEATURE_FLAG_STOCK_PRICE_TRACKING: true,
  FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: true,
  FEATURE_FLAG_STOCK_PRODUCT_OPENED_TRACKING: true,
  FEATURE_FLAG_STOCK_PRODUCT_FREEZING: true,
  FEATURE_FLAG_LABEL_PRINTER: true,
};

const product = {
  id: 7,
  name: "Coffee",
  active: 1,
  userfields: null,
  description: "",
  parent_product_id: null,
  location_id: 2,
  default_consume_location_id: 2,
  shopping_location_id: 3,
  product_group_id: null,
  qu_id_stock: 1,
  qu_id_purchase: 1,
  qu_id_consume: 1,
  qu_id_price: 1,
  min_stock_amount: 2,
  default_best_before_days: 9,
  default_best_before_days_after_open: 5,
  default_best_before_days_after_freezing: 6,
  default_best_before_days_after_thawing: 7,
  should_not_be_frozen: 1,
  due_type: 2,
  quick_consume_amount: 3,
  quick_open_amount: 4,
  default_stock_label_type: 2,
  auto_reprint_stock_label: 1,
  disable_open: 1,
  treat_opened_as_out_of_stock: 1,
  move_on_open: 1,
  default_purchase_price_type: 3,
  not_check_stock_fulfillment_for_recipes: 1,
  picture_file_name: null,
  enable_tare_weight_handling: 0,
  tare_weight: 0,
  calories: 50,
};

const references = {
  locations: [
    { id: 1, name: "Default" },
    { id: 2, name: "Shelf" },
    { id: 9, name: "Copied place" },
  ],
  quantity_units: [{ id: 1, name: "Piece" }],
  shopping_locations: [
    { id: 1, name: "Default store" },
    { id: 3, name: "Shop" },
  ],
  product_groups: [],
  products: [{ id: 9, name: "Parent" }],
};

const settings = {
  stock_decimal_places_amounts: 2,
  product_presets_qu_id: 1,
  product_presets_location_id: 2,
};

function held() {
  let release = (_response: Response) => {};

  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

function mount(
  overrides: JsonObject = {},
  options: {
    path?: string;
    copy?: Promise<Response>;
    fields?: boolean;
    last?: Promise<Response>;
    enums?: number | string;
    checkboxFlag?: number;
  } = {},
) {
  const config = { ...flags, ...overrides };
  const fields = options.fields ? [notesField("products")] : [];
  const writes: { url: string; body: JsonObject }[] = [];
  const close = vi.spyOn(window, "close").mockImplementation(() => {});

  const app = mountNativeEditor(
    options.path ?? "/product/7?closeAfterCreation",
    async (url, init) => {
      if (url === "/api/objects/userfields?query[]=entity=products") return Response.json(fields);

      if (url.startsWith("/api/v2/products/native-editor?")) {
        const creating = new URL(url, window.location.origin).searchParams.get("row") === "new";

        return Response.json(
          nativeProductContext({
            product: creating
              ? null
              : {
                  ...product,
                  active: options.checkboxFlag ?? product.active,
                  due_type: options.enums ?? 2,
                  default_purchase_price_type: options.enums ?? 3,
                  default_stock_label_type: options.enums ?? 2,
                },
            references,
            fields,
            user_settings: settings,
            config,
          }),
        );
      }

      if (url === "/api/user/settings") return Response.json(settings);

      if (url === "/api/v2/custom-data/fields") return Response.json(fields);

      if (url === "/api/userfields/products/7" && !init?.method) return Response.json({});

      if (url === "/api/objects/products/7" && !init?.method)
        return options.copy ?? Response.json(product);

      if (url === "/api/objects/products/9")
        return Response.json({
          id: 9,
          name: "Parent",
          cumulate_min_stock_amount_of_sub_products: 0,
        });

      if (url === "/api/objects/products" && !init?.method) return Response.json([product]);

      const referenceRows = new Map<string, JsonObject[]>([
        ["/api/objects/locations", references.locations],
        ["/api/objects/quantity_units", references.quantity_units],
        ["/api/objects/shopping_locations", references.shopping_locations],
        ["/api/objects/product_groups", references.product_groups],
      ]).get(url);

      if (referenceRows) return Response.json(referenceRows);

      if (url.startsWith("/api/objects/products") && ["POST", "PUT"].includes(init?.method ?? "")) {
        writes.push({ url, body: JSON.parse(String(init?.body)) });

        return Response.json({ created_object_id: "42" });
      }

      if (url === "/api/userfields/products/42" && init?.method === "PUT") {
        writes.push({ url, body: JSON.parse(String(init.body)) });

        return options.last ?? Response.json({});
      }

      return undefined;
    },
    config,
  );

  supportProductOptions();
  supportDescriptionEditors();

  return { ...app, writes, close };
}

function hidden(form: HTMLElement, name: string, value: string, addressable = true) {
  const input = form.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`);
  expect(input, `hidden ${name}`).not.toBeNull();
  expect(input!.value).toBe(value);
  expect(Boolean(input!.id)).toBe(addressable);
}

function absent(form: HTMLElement, name: string) {
  expect(form.querySelector(`[name="${name}"]`)).toBeNull();
}

const allOff = {
  FEATURE_FLAG_STOCK_LOCATION_TRACKING: false,
  FEATURE_FLAG_STOCK_PRICE_TRACKING: false,
  FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: false,
  FEATURE_FLAG_STOCK_PRODUCT_OPENED_TRACKING: false,
  FEATURE_FLAG_STOCK_PRODUCT_FREEZING: false,
  FEATURE_FLAG_LABEL_PRINTER: false,
  FEATURE_FLAG_RECIPES: false,
};

for (const fixture of [
  {
    name: "recipes",
    config: { FEATURE_FLAG_RECIPES: false },
    hidden: { not_check_stock_fulfillment_for_recipes: "0" },
    omitted: [],
    labels: ["Skip recipe stock checks"],
  },
  {
    name: "location",
    config: { FEATURE_FLAG_STOCK_LOCATION_TRACKING: false },
    hidden: { location_id: "1", default_consume_location_id: "1" },
    omitted: ["move_on_open"],
    labels: ["Default location", "Default consume location"],
  },
  {
    name: "price",
    config: { FEATURE_FLAG_STOCK_PRICE_TRACKING: false },
    hidden: { shopping_location_id: "1" },
    omitted: ["default_purchase_price_type"],
    labels: ["Default store", "Default purchase price type"],
  },
  {
    name: "due dates",
    config: { FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: false },
    hidden: { default_best_before_days: "1", due_type: "1" },
    omitted: ["default_best_before_days_after_open"],
    labels: ["Days before expiry", "Days after opening"],
  },
  {
    name: "opened tracking",
    config: { FEATURE_FLAG_STOCK_PRODUCT_OPENED_TRACKING: false },
    hidden: { default_best_before_days_after_open: "1" },
    omitted: ["disable_open", "treat_opened_as_out_of_stock", "move_on_open"],
    labels: [
      "Days after opening",
      "Disable opening",
      "Treat opened stock as missing",
      "Move opened stock to the consume location",
    ],
  },
  {
    name: "freezing",
    config: { FEATURE_FLAG_STOCK_PRODUCT_FREEZING: false },
    hidden: {},
    omitted: [],
    labels: ["Days after freezing", "Days after thawing", "Should not be frozen"],
  },
  {
    name: "labels",
    config: { FEATURE_FLAG_LABEL_PRINTER: false },
    hidden: {},
    omitted: ["default_stock_label_type", "auto_reprint_stock_label"],
    labels: ["Default stock label", "Reprint labels when the due date changes"],
  },
  {
    name: "all optional stock tracking",
    config: allOff,
    hidden: {
      location_id: "1",
      default_consume_location_id: "1",
      shopping_location_id: "1",
      default_best_before_days: "1",
      due_type: "1",
      not_check_stock_fulfillment_for_recipes: "0",
    },
    omitted: [
      "default_best_before_days_after_open",
      "disable_open",
      "treat_opened_as_out_of_stock",
      "move_on_open",
      "default_stock_label_type",
      "auto_reprint_stock_label",
      "default_purchase_price_type",
    ],
    labels: [
      "Default location",
      "Default consume location",
      "Default store",
      "Days before expiry",
      "Days after opening",
      "Days after freezing",
      "Days after thawing",
      "Should not be frozen",
      "Default stock label",
      "Disable opening",
    ],
  },
]) {
  test(`native ${fixture.name} feature controls preserve source hidden values and omissions`, async () => {
    const { writes, close } = mount(fixture.config);
    const form = await screen.findByRole("form", { name: "Edit product" });

    for (const label of fixture.labels) expect(within(form).queryByLabelText(label)).toBeNull();

    for (const [key, value] of Object.entries(fixture.hidden)) hidden(form, key, value);

    for (const key of fixture.omitted) absent(form, key);

    if (fixture.config.FEATURE_FLAG_STOCK_PRODUCT_FREEZING === false) {
      for (const key of [
        "default_best_before_days_after_freezing",
        "default_best_before_days_after_thawing",
        "should_not_be_frozen",
      ])
        hidden(form, key, "0", false);
    }

    expect(within(form).getByLabelText("Quick open amount")).toBeTruthy();
    const save = within(form).getByRole<HTMLButtonElement>("button", { name: "Save & continue" });
    await waitFor(() => expect(save.disabled).toBe(false));
    await userEvent.click(save);
    await waitFor(() => expect(writes).toHaveLength(1));

    for (const [key, value] of Object.entries(fixture.hidden))
      expect(writes[0]?.body[key]).toBe(value);

    for (const key of fixture.omitted) expect(writes[0]?.body).not.toHaveProperty(key);

    if (fixture.config.FEATURE_FLAG_STOCK_PRODUCT_FREEZING === false) {
      expect(writes[0]?.body).toMatchObject({
        default_best_before_days_after_freezing: "0",
        default_best_before_days_after_thawing: "0",
        should_not_be_frozen: "0",
      });
    }

    expect(close).toHaveBeenCalledOnce();
  });
}

test.each([
  { value: 1, due: "Best before date", price: "Unspecified", label: "1" },
  { value: 2, due: "Expiration date", price: "Unit price", label: "2" },
  { value: 3, due: "Best before date", price: "Total price", label: "0" },
  { value: 99, due: "Best before date", price: "Unspecified", label: "0" },
  { value: "0x2", due: "Best before date", price: "Unspecified", label: "0" },
])(
  "native radio and label controls choose source defaults for stored $value",
  async ({ value, due, price, label }) => {
    mount({}, { enums: value });
    const dueRadio = await screen.findByRole<HTMLInputElement>("radio", { name: due });
    expect(dueRadio.checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>("radio", { name: price }).checked).toBe(true);
    const picker = screen.getByLabelText<HTMLSelectElement>("Default stock label");
    expect(picker.value).toBe(label);
    expect(Array.from(picker.options).map((option) => option.text)).toEqual([
      "No label",
      "Single label",
      "Label per unit",
    ]);
  },
);

for (const dueDates of [true, false]) {
  test(`copy updates addressable hidden controls but cannot update ID-less or absent controls (due dates=${dueDates})`, async () => {
    const copy = held();

    const { writes } = mount(
      { ...allOff, FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: dueDates },
      { path: "/product/new?copy-of=7&closeAfterCreation", copy: copy.promise },
    );

    const name = await screen.findByLabelText("Name");
    await userEvent.type(name, "Copied");
    await userEvent.selectOptions(screen.getByLabelText("Stock unit"), "1");
    await act(async () => {
      copy.release(
        Response.json({
          ...product,
          parent_product_id: null,
          shopping_location_id: null,
          location_id: 9,
          default_consume_location_id: 4,
          default_best_before_days: 18,
          default_best_before_days_after_open: 7,
          default_best_before_days_after_freezing: 28,
          default_best_before_days_after_thawing: 29,
        }),
      );
    });
    const form = screen.getByRole("form", { name: "Add product" });
    await waitFor(() => hidden(form, "location_id", "9"));
    hidden(form, "default_consume_location_id", "4");
    hidden(form, "not_check_stock_fulfillment_for_recipes", "0");

    for (const key of [
      "default_best_before_days_after_freezing",
      "default_best_before_days_after_thawing",
      "should_not_be_frozen",
    ])
      hidden(form, key, "0", false);

    if (dueDates) hidden(form, "default_best_before_days_after_open", "7");
    else absent(form, "default_best_before_days_after_open");
    await userEvent.click(screen.getByRole("button", { name: "Save & continue" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.body).toMatchObject({
      location_id: "9",
      default_consume_location_id: "4",
      shopping_location_id: "1",
      default_best_before_days_after_freezing: "0",
      default_best_before_days_after_thawing: "0",
      should_not_be_frozen: "0",
      not_check_stock_fulfillment_for_recipes: "0",
    });
    expect(writes[0]?.body.default_best_before_days).toBe(dueDates ? 18 : "18");

    if (dueDates) expect(writes[0]?.body.default_best_before_days_after_open).toBe("7");
    else expect(writes[0]?.body).not.toHaveProperty("default_best_before_days_after_open");

    for (const key of [
      "default_stock_label_type",
      "auto_reprint_stock_label",
      "disable_open",
      "move_on_open",
      "treat_opened_as_out_of_stock",
    ])
      expect(writes[0]?.body).not.toHaveProperty(key);
  });
}

test("price-disabled copy stops after parent, description and hidden location while its draft still saves through custom fields", async () => {
  const copy = held();
  const last = held();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});

  const { writes, close } = mount(
    { ...allOff, FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: true },
    {
      path: "/product/new?copy-of=7&closeAfterCreation",
      copy: copy.promise,
      last: last.promise,
      fields: true,
    },
  );

  const name = await screen.findByLabelText<HTMLInputElement>("Name");
  await userEvent.type(name, "Draft name");
  await userEvent.selectOptions(screen.getByLabelText("Stock unit"), "1");
  await userEvent.clear(screen.getByLabelText("Minimum stock"));
  await userEvent.type(screen.getByLabelText("Minimum stock"), "5");
  await userEvent.type(screen.getByLabelText("Owner note"), "Retained note");
  const frame = await screen.findByTitle<HTMLIFrameElement>("Description");
  const child = frame.contentWindow!;
  const pasted: string[] = [];

  const command = z.object({
    channel: z.literal("grocy-description"),
    command: z.literal("paste"),
    html: z.string(),
  });

  const reply = (event: MessageEvent<unknown>) => {
    const parsed = command.safeParse(event.data);

    if (!parsed.success) return;
    pasted.push(parsed.data.html);
    window.dispatchEvent(
      new MessageEvent("message", {
        source: child,
        origin: "null",
        data: {
          channel: "grocy-description",
          kind: "change",
          html: parsed.data.html,
          empty: false,
          height: 390,
          fullscreen: false,
        },
      }),
    );
  };

  child.addEventListener("message", reply);
  onTestFinished(() => child.removeEventListener("message", reply));
  await act(async () => {
    copy.release(
      Response.json({
        ...product,
        parent_product_id: 9,
        description: "<p>Copied description</p>",
        location_id: 9,
        shopping_location_id: 3,
        min_stock_amount: 27,
        default_best_before_days: 18,
        default_consume_location_id: 4,
      }),
    );
  });
  const form = screen.getByRole("form", { name: "Add product" });
  await waitFor(() => hidden(form, "location_id", "9"));
  await waitFor(() => expect(pasted).toEqual(["<p>Copied description</p>"]));
  expect(screen.getByLabelText<HTMLSelectElement>("Parent product").value).toBe("9");
  expect(name.value).toBe("Draft name");
  expect(screen.getByLabelText<HTMLInputElement>("Minimum stock").value).toBe("5");
  expect(screen.getByLabelText<HTMLInputElement>("Days before expiry").value).toBe("0");
  hidden(form, "default_consume_location_id", "1");
  hidden(form, "default_best_before_days_after_open", "1");
  await waitFor(() => expect(errors).toHaveBeenCalledWith(expect.any(TypeError)));
  expect(screen.queryByText("Error while saving, probably this item already exists")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Save & continue" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[0]).toMatchObject({
    url: "/api/objects/products",
    body: {
      name: "Draft name",
      parent_product_id: 9,
      description: "<p>Copied description</p>",
      location_id: "9",
      default_consume_location_id: "1",
      shopping_location_id: "1",
      min_stock_amount: 5,
      default_best_before_days: 0,
    },
  });
  expect(writes[1]).toEqual({
    url: "/api/userfields/products/42",
    body: { note: "Retained note" },
  });
  expect(close).not.toHaveBeenCalled();
  await act(async () => {
    last.release(Response.json({}));
  });
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});

test("the modern catalog keeps its separate numeric disabled-field defaults", async () => {
  const { writes } = mount(allOff, { path: "/catalog" });
  await userEvent.click(await screen.findByRole("button", { name: "Edit catalog" }));
  await userEvent.click(await screen.findByRole("button", { name: "Add product" }));
  await userEvent.type(await screen.findByLabelText("Name"), "Modern product");
  const save = screen.getByRole<HTMLButtonElement>("button", { name: "Save product" });
  await waitFor(() => expect(save.disabled).toBe(false));
  await userEvent.click(save);
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]?.body).toMatchObject({
    name: "Modern product",
    location_id: 1,
    default_consume_location_id: 1,
    shopping_location_id: 1,
    default_best_before_days: 1,
    default_best_before_days_after_freezing: 0,
    default_best_before_days_after_thawing: 0,
    should_not_be_frozen: 0,
  });
});

test("an imported checkbox value of two stays unchecked and saves as unchecked", async () => {
  const { writes } = mount({}, { checkboxFlag: 2 });
  const active = await screen.findByLabelText<HTMLInputElement>("Active");
  expect(active.checked).toBe(false);
  const save = screen.getByRole<HTMLButtonElement>("button", { name: "Save & continue" });
  await waitFor(() => expect(save.disabled).toBe(false));
  await userEvent.click(save);
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]?.body.active).toBe(0);
});
