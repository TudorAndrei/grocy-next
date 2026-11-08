import { z } from "zod";
import { filePath, request } from "./api";
import { userfieldSchema } from "./userfields";
import type { TableColumn } from "./table-options";
import {
  nativeNumberCell,
  nativeTableCell,
  tableAttribute,
  tableNumber,
  tablePlainText,
  tableText,
  type NativeTableRow,
} from "./native-table-cell";
import { nativeUserfieldTableCell } from "./userfield-table-cell";
import { nativeUserfieldValues } from "./native-userfield-values";

const product = z
  .object({
    id: z.number(),
    name: z.string().nullable(),
    active: z.number(),
    min_stock_amount: z.union([z.number(), z.string()]).nullable(),
    location_id: z.number().nullable(),
    qu_id_purchase: z.number().nullable(),
    qu_id_stock: z.number().nullable(),
    product_group_id: z.number().nullable(),
    shopping_location_id: z.number().nullable(),
    picture_file_name: z.string().nullable(),
  })
  .passthrough();

const named = z.array(z.object({ id: z.number(), name: z.string().nullable() }).passthrough());

const context = z.object({
  products: z.array(product),
  locations: named,
  quantity_units: named,
  product_groups: named,
  shopping_locations: named,
  userfields: z.array(
    userfieldSchema
      .extend({
        show_as_column_in_tables: z.number(),
        sort_number: z.union([z.number(), z.string()]).nullable().optional(),
      })
      .passthrough(),
  ),
  userfield_values: z.array(
    z
      .object({
        object_id: z.union([z.number(), z.string()]),
        name: z.string(),
        value: z.string().nullable(),
      })
      .passthrough(),
  ),
  user_settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  config: z.record(z.string(), z.json()),
  locale: z.string(),
});

export type NativeProduct = z.infer<typeof product>;

export type NativeProductsContext = z.infer<typeof context>;

export async function getNativeProductsContext(search: string, signal?: AbortSignal) {
  return context.parse(await request(`/api/v2/products/context${search}`, { signal }));
}

export function nativeProductsColumns(data: NativeProductsContext): TableColumn[] {
  return [
    { key: "actions", label: "", configurable: false },
    { key: "name", label: "Name" },
    {
      key: "location",
      label: "Location",
      groupable: true,
      rendered:
        !!data.config.FEATURE_FLAG_STOCK_LOCATION_TRACKING &&
        data.config.FEATURE_FLAG_STOCK_LOCATION_TRACKING !== "0",
    },
    { key: "minimum", label: "Min. stock amount", groupable: true },
    { key: "purchase_unit", label: "Default quantity unit purchase" },
    { key: "stock_unit", label: "Quantity unit stock", groupable: true },
    { key: "product_group", label: "Product group" },
    {
      key: "store",
      label: "Default store",
      groupable: true,
      defaultVisible: false,
      rendered:
        !!data.config.FEATURE_FLAG_STOCK_PRICE_TRACKING &&
        data.config.FEATURE_FLAG_STOCK_PRICE_TRACKING !== "0",
    },
    { key: "grocycode", label: "Grocycode", defaultVisible: false },
    { key: "picture", label: "Product picture", defaultVisible: false },
    ...data.userfields
      .filter((field) => field.show_as_column_in_tables === 1)
      .map((field) => ({
        key: `custom:${field.name}`,
        label: field.caption,
        labelIsLiteral: true,
        groupable: true,
      })),
  ];
}

export function nativeProductValues(data: NativeProductsContext, id: number) {
  return nativeUserfieldValues(data.userfields, data.userfield_values, id);
}

export function nativeProductsCells(
  row: NativeProduct,
  data: NativeProductsContext,
  pictureCaption = "This product has a picture",
): NativeTableRow {
  const name = (rows: NativeProductsContext["locations"], id: number | null) =>
    rows.find((item) => item.id === id)?.name ?? "";

  const amount = tableNumber(
    row.min_stock_amount === null ? "" : String(row.min_stock_amount),
    Number(data.user_settings.stock_decimal_places_amounts ?? 2),
  );

  const minimum = `<span class="locale-number locale-number-quantity-amount${amount ? " number-parsing-done" : ""}">${tableText(amount)}</span>`;

  const minimumOrder = Number.parseFloat(
    tablePlainText(minimum)
      .replace(/[^0-9.,-]/g, "")
      .replaceAll(",", ""),
  );

  const values = nativeProductValues(data, row.id);

  return {
    name: nativeTableCell(
      `${tableText(row.name)}${row.picture_file_name && row.picture_file_name !== "0" ? ` <i class="fa-solid fa-image text-muted" title="${tableAttribute(pictureCaption)}"></i>` : ""}`,
    ),
    location: nativeTableCell(tableText(name(data.locations, row.location_id))),
    minimum: nativeNumberCell(minimum, Number.isNaN(minimumOrder) ? -Infinity : minimumOrder),
    purchase_unit: nativeTableCell(tableText(name(data.quantity_units, row.qu_id_purchase))),
    stock_unit: nativeTableCell(tableText(name(data.quantity_units, row.qu_id_stock))),
    product_group: nativeTableCell(tableText(name(data.product_groups, row.product_group_id))),
    store: nativeTableCell(tableText(name(data.shopping_locations, row.shopping_location_id))),
    grocycode: nativeTableCell(`<img src="/product/${row.id}/grocycode?size=25" loading="lazy">`),
    picture: nativeTableCell(
      row.picture_file_name && row.picture_file_name !== "0"
        ? `<img src="${filePath("productpictures", row.picture_file_name)}?force_serve_as=picture&amp;best_fit_width=64&amp;best_fit_height=64" loading="lazy">`
        : "",
    ),
    ...Object.fromEntries(
      data.userfields
        .filter((field) => field.show_as_column_in_tables === 1)
        .map((field) => [
          `custom:${field.name}`,
          nativeUserfieldTableCell(
            field,
            values[field.name] ?? null,
            Object.hasOwn(values, field.name),
            Number(data.user_settings.stock_decimal_places_prices_display ?? 2),
            String(data.config.CURRENCY ?? "USD"),
            data.config,
          ),
        ]),
    ),
  };
}

/** Native URL helpers serialize with URLSearchParams, then decode the whole query. */
export function nativeProductsSearch(search: string, mutate: (params: URLSearchParams) => void) {
  const params = new URLSearchParams(search);
  mutate(params);

  return decodeURIComponent(params.toString());
}
