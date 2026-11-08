import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, onTestFinished, test, vi } from "vitest";
import { mountNativeEditor } from "./fixtures/native-editor";
import { productOverview } from "./fixtures/product-overview";
import type { UserSettings } from "@/lib/types";

function mountStockSettings({
  path = "/stocksettings",
  values = {},
  fail = false,
  hold = false,
  features = {},
  holdContext = false,
  failRead = false,
}: {
  path?: string;
  values?: UserSettings;
  fail?: boolean;
  hold?: boolean;
  features?: Record<string, boolean>;
  holdContext?: boolean;
  failRead?: boolean;
} = {}) {
  const settings: UserSettings = {
    stock_decimal_places_amounts: 2,
    stock_decimal_places_prices_input: 2,
    stock_default_purchase_amount: 1,
    ...values,
  };

  const customWrites: unknown[] = [];
  const writes: { key: string; value: UserSettings[string] }[] = [];
  let release = () => {};

  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });

  let readFailure = failRead;
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => logger.mockRestore());

  const app = mountNativeEditor(
    path,
    async (url, init) => {
      if (url === "/api/user/settings") return Response.json(settings);

      if (url.startsWith("/api/user/settings/") && init?.method === "PUT") {
        const key = decodeURIComponent(url.slice("/api/user/settings/".length));
        const value = JSON.parse(String(init.body)).value;
        writes.push({ key, value });

        if (hold && writes.length === 1) await pending;

        if (fail) return Response.json({ error_message: "Setting unavailable" }, { status: 503 });
        settings[key] = value;

        return new Response(null, { status: 204 });
      }

      if (url === "/api/v2/settings/stock-context") {
        if (readFailure) {
          readFailure = false;

          return Response.json({ error_message: "Choices unavailable" }, { status: 503 });
        }

        if (holdContext) await pending;

        return Response.json({
          locations: [{ id: 2, name: "Shelf" }],
          quantity_units: [{ id: 1, name: "Piece" }],
          product_groups: [{ id: 3, name: "Dry goods" }],
        });
      }

      if (url === "/api/stock/products/7/add")
        return Response.json([
          { id: 90, product_id: 7, transaction_id: "purchase", stock_id: "stock", amount: 1 },
        ]);

      if (url === "/api/userfields/stock/purchase") {
        customWrites.push(JSON.parse(String(init?.body)));

        return new Response(null, { status: 204 });
      }

      if (url === "/api/v2/stock/entries/native-editor?row=1")
        return Response.json({
          entry: {
            id: 1,
            product_id: 7,
            stock_id: "stock",
            amount: 1,
            best_before_date: null,
            purchased_date: "2026-11-07",
            price: 1,
            location_id: 2,
            shopping_location_id: null,
            note: null,
            open: 0,
            product_name: "Coffee",
            qu_name: "Piece",
          },
          locations: [{ id: 2, name: "Shelf" }],
          stores: [],
          fields: [],
          values: {},
        });

      if (url === "/api/v2/stock/purchase/editor" || url === "/api/v2/stock/inventory/editor")
        return Response.json({
          barcode_lookup_plugin_name: "",
          products: [{ id: 7, name: "Coffee" }],
          locations: [{ id: 2, name: "Shelf", is_freezer: 0 }],
          stores: [],
          units: [{ id: 1, name: "Piece", name_plural: "Pieces" }],
          barcodes: [],
          fields: [
            {
              id: 1,
              name: "fee",
              caption: "Fee",
              type: "number-currency",
              input_required: 0,
              default_value: null,
              config: null,
            },
          ],
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
        });

      if (url === "/api/stock/products/7")
        return Response.json({
          ...productOverview,
          product: {
            ...productOverview.product,
            enable_tare_weight_handling: 0,
            tare_weight: 0,
            default_best_before_days: 0,
            default_best_before_days_after_freezing: 0,
            default_purchase_price_type: 0,
            default_stock_label_type: 0,
          },
          quantity_unit_stock: { id: 1, name: "Piece", name_plural: "Pieces" },
          default_quantity_unit_purchase: { id: 1, name: "Piece", name_plural: "Pieces" },
          location: { id: 2, is_freezer: 0 },
          last_shopping_location_id: null,
          default_shopping_location_id: null,
          next_due_date: null,
        });

      return undefined;
    },
    {
      FEATURE_FLAG_STOCK: true,
      FEATURE_FLAG_STOCK_PRICE_TRACKING: true,
      FEATURE_FLAG_STOCK_LOCATION_TRACKING: true,
      FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING: false,
      FEATURE_FLAG_LABEL_PRINTER: true,
      ...features,
    },
  );

  return { ...app, settings, writes, logger, release, customWrites };
}

test("native stock settings exposes presets and autosaves only valid committed values", async () => {
  const app = mountStockSettings();
  const due = await screen.findByLabelText<HTMLInputElement>("Due soon days");
  expect(screen.getByRole("heading", { name: "Stock settings" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "OK" }).getAttribute("href")).toBe("/stockoverview");
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  await userEvent.clear(due);
  await userEvent.type(due, "0");
  await userEvent.tab();
  expect(due.validity.rangeUnderflow).toBe(true);
  expect(app.writes).toEqual([]);
  await userEvent.clear(due);
  await userEvent.type(due, "7");
  await userEvent.tab();
  await waitFor(() => expect(app.writes).toEqual([{ key: "stock_due_soon_days", value: "7" }]));
});

test("price auto-decimal blur applies the saved preference in the real purchase form", async () => {
  const app = mountStockSettings();
  await userEvent.click(
    await screen.findByLabelText("Add decimal separator automatically for price inputs"),
  );
  await waitFor(() => expect(app.settings.stock_auto_decimal_separator_prices).toBe(true));
  await act(async () => app.router.navigate({ href: "/purchase?product=7" }));
  const price = await screen.findByLabelText<HTMLInputElement>("Price");
  await waitFor(() => expect(price.matches(":disabled")).toBe(false));

  fireEvent.change(price, { target: { value: "123" } });
  fireEvent.blur(price);
  expect(price.value).toBe("1.23");
});

test("BoolVal checkboxes and raw selectors preserve native stored values and feature visibility", async () => {
  const app = mountStockSettings({
    values: {
      product_presets_location_id: 99,
      product_presets_product_group_id: 3,
      stock_auto_decimal_separator_prices: "false",
      stock_overview_show_all_out_of_stock_products: "oN",
    },
    features: {
      FEATURE_FLAG_STOCK_PRODUCT_OPENED_TRACKING: false,
      FEATURE_FLAG_LABEL_PRINTER: false,
    },
  });

  expect((await screen.findByLabelText<HTMLSelectElement>("Location")).value).toBe("");
  expect(screen.getByLabelText<HTMLSelectElement>("Product group").value).toBe("3");
  expect(
    screen.getByLabelText<HTMLInputElement>("Add decimal separator automatically for price inputs")
      .checked,
  ).toBe(false);
  expect(screen.getByLabelText<HTMLInputElement>("Show all out of stock products").checked).toBe(
    true,
  );
  expect(screen.queryByLabelText("Treat opened as out of stock")).toBeNull();
  expect(screen.queryByLabelText("Default stock entry label")).toBeNull();
  await userEvent.selectOptions(screen.getByLabelText("Location"), "2");
  await waitFor(() => expect(app.settings.product_presets_location_id).toBe("2"));
});

test("quick-consume toggles disable the retained amount while number arrows save immediately", async () => {
  const app = mountStockSettings({
    values: {
      stock_default_consume_amount: 2.345,
      stock_default_consume_amount_use_quick_consume_amount: true,
    },
  });

  const amount = await screen.findByLabelText<HTMLInputElement>("Default amount for consume");
  expect(amount.value).toBe("2.35");
  expect(amount.disabled).toBe(true);
  await userEvent.click(screen.getByLabelText('Use the products "Quick consume amount"'));
  expect(amount.disabled).toBe(false);
  expect(amount.value).toBe("2.35");
  await userEvent.click(
    screen.getByRole("button", { name: "Increase Default amount for consume" }),
  );
  await waitFor(() => expect(app.settings.stock_default_consume_amount).toBe("3.35"));
  expect(app.writes).toEqual([
    { key: "stock_default_consume_amount_use_quick_consume_amount", value: false },
    { key: "stock_default_consume_amount", value: "3.35" },
  ]);
});

test("precision limits reject invalid commits and changing precision keeps the original page amount step", async () => {
  const app = mountStockSettings();

  const precision = await screen.findByLabelText<HTMLInputElement>(
    "Decimal places allowed for amounts",
  );

  await userEvent.clear(precision);
  await userEvent.type(precision, "11");
  await userEvent.tab();
  expect(precision.validity.rangeOverflow).toBe(true);
  expect(app.writes).toEqual([]);
  await userEvent.clear(precision);
  await userEvent.type(precision, "3");
  await userEvent.tab();
  await waitFor(() => expect(app.settings.stock_decimal_places_amounts).toBe("3"));
  const amount = screen.getByLabelText<HTMLInputElement>("Default amount for purchase");
  expect(amount.step).toBe("0.01");
  await userEvent.clear(amount);
  await userEvent.type(amount, "1.234");
  await userEvent.tab();
  expect(amount.validity.stepMismatch).toBe(true);
  expect(app.writes).toHaveLength(1);
});

test("failed autosave retains the local value, logs silently and allows later independent changes", async () => {
  const app = mountStockSettings({ fail: true });
  const checkbox = await screen.findByLabelText<HTMLInputElement>("Show all out of stock products");
  await userEvent.click(checkbox);
  await waitFor(() => expect(app.logger).toHaveBeenCalled());
  expect(checkbox.checked).toBe(true);
  expect(checkbox.disabled).toBe(false);
  expect(screen.queryByText("Setting unavailable")).toBeNull();
  await userEvent.click(checkbox);
  await waitFor(() => expect(app.writes.map((row) => row.value)).toEqual([true, false]));
});

test("overlapping autosaves retain completion order without locking navigation or refreshing departed controls", async () => {
  const app = mountStockSettings({ hold: true });
  const checkbox = await screen.findByLabelText<HTMLInputElement>("Show all out of stock products");
  await userEvent.click(checkbox);
  await userEvent.click(checkbox);
  await waitFor(() => expect(app.writes).toHaveLength(2));
  await act(async () => app.router.navigate({ href: "/settings?tab=connection" }));
  await act(async () => app.release());
  await waitFor(() =>
    expect(app.settings.stock_overview_show_all_out_of_stock_products).toBe(true),
  );
  await act(async () => app.router.navigate({ href: "/stocksettings" }));
  expect(
    (await screen.findByLabelText<HTMLInputElement>("Show all out of stock products")).checked,
  ).toBe(true);
});

test.each([
  ["/inventory?product=7", "123", 2, true, "1.23"],
  ["/stockentry/1", "5", 3, true, "0.005"],
  ["/purchase?product=7", "123", 0, true, "123.123"],
  ["/purchase?product=7", "1.23", 2, true, "1.23"],
  ["/purchase?product=7", "123", 2, false, "123"],
] as const)(
  "native currency blur in %s transforms %s at precision %s enabled=%s",
  async (path, raw, precision, enabled, expected) => {
    mountStockSettings({
      path,
      values: {
        stock_auto_decimal_separator_prices: enabled,
        stock_decimal_places_prices_input: precision,
      },
    });
    const price = await screen.findByLabelText<HTMLInputElement>("Price");
    await waitFor(() => expect(price.matches(":disabled")).toBe(false));

    fireEvent.change(price, { target: { value: raw } });
    fireEvent.blur(price);
    expect(price.value).toBe(expected);
  },
);

test("currency custom fields save the transformed live value while ordinary amounts remain unchanged", async () => {
  const app = mountStockSettings({
    path: "/purchase?product=7",
    values: { stock_auto_decimal_separator_prices: true },
  });

  const fee = await screen.findByLabelText<HTMLInputElement>("Fee");
  await waitFor(() => expect(fee.matches(":disabled")).toBe(false));
  await userEvent.click(fee);
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "OK" }).disabled).toBe(false),
  );
  fireEvent.change(fee, { target: { value: "123" } });
  fireEvent.blur(fee);
  expect(fee.value).toBe("1.23");
  const amount = screen.getByLabelText<HTMLInputElement>("Amount");
  fireEvent.change(amount, { target: { value: "123" } });
  fireEvent.blur(amount);
  expect(amount.value).toBe("123");
  await userEvent.click(screen.getByRole("button", { name: "OK" }));
  await waitFor(() => expect(app.customWrites).toEqual([{ fee: "1.23" }]));
});

test("fresh settings and choices initialize once, then background settings reads preserve the draft and original precision", async () => {
  const app = mountStockSettings({
    path: "/settings?tab=connection",
    holdContext: true,
    values: { stock_default_purchase_amount: 1.236 },
  });

  app.client.setQueryData(["user", "settings"], { stock_decimal_places_amounts: 0 });
  await act(async () => app.router.navigate({ href: "/stocksettings" }));
  await waitFor(() =>
    expect(
      app.fetchMock.mock.calls.some(([url]) => String(url) === "/api/v2/settings/stock-context"),
    ).toBe(true),
  );
  expect(screen.queryByLabelText("Default amount for purchase")).toBeNull();
  await act(async () => app.release());
  const amount = await screen.findByLabelText<HTMLInputElement>("Default amount for purchase");
  expect(amount.value).toBe("1.24");
  await userEvent.clear(amount);
  await userEvent.type(amount, "9.87");
  app.settings.stock_decimal_places_amounts = 4;
  await act(async () => {
    await app.client.invalidateQueries({ queryKey: ["user", "settings"] });
  });
  expect(amount.value).toBe("9.87");
  expect(amount.step).toBe("0.01");
});

test("disabled stock price and location features hide their controls while context failures can retry", async () => {
  mountStockSettings({
    failRead: true,
    features: {
      FEATURE_FLAG_STOCK_PRICE_TRACKING: false,
      FEATURE_FLAG_STOCK_LOCATION_TRACKING: false,
    },
  });
  await screen.findByText("Choices unavailable");
  expect(screen.queryByLabelText("Default amount for purchase")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByLabelText("Default amount for purchase");
  expect(screen.queryByLabelText("Location")).toBeNull();
  expect(screen.queryByLabelText("Decimal places allowed for prices (input)")).toBeNull();
  expect(
    screen.queryByLabelText("Add decimal separator automatically for price inputs"),
  ).toBeNull();
});
