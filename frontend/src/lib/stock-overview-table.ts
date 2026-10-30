import { filePath } from "./api";
import type { StockOverviewRow } from "./stock-overview";
import type { TableColumn } from "./table-options";
import type { UserfieldDefinition } from "./userfields";
import { userfieldFile } from "./userfields";
import {
  nativeNumberCell,
  nativeTableCell,
  tableDate,
  tableText,
  tableNumber,
  tableLine,
  tableAttribute,
  type NativeTableRow,
} from "./native-table-cell";

export function overviewColumns(
  dates: boolean,
  prices: boolean,
  fields: UserfieldDefinition[],
  translate: (message: string) => string,
): TableColumn[] {
  const hidden = { defaultVisible: false };

  return [
    { key: "actions", label: "", configurable: false },
    { key: "product_name", label: "Product" },
    { key: "product_group_name", label: "Product group", groupable: true, ...hidden },
    { key: "amount", label: "Amount" },
    { key: "value", label: "Value", rendered: prices, ...hidden },
    { key: "best_before_date", label: "Next due date", rendered: dates, groupable: true },
    { key: "locations", label: "", rendered: false, configurable: false, defaultVisible: false },
    { key: "status", label: "", rendered: false, configurable: false, defaultVisible: false },
    { key: "group_filter", label: "", rendered: false, configurable: false, defaultVisible: false },
    {
      key: "product_calories",
      label: translate("Calories") + " (" + translate("Per stock quantity unit") + ")",
      labelIsLiteral: true,
      ...hidden,
    },
    { key: "calories", label: "Calories", ...hidden },
    { key: "last_purchased", label: "Last purchased", groupable: true, ...hidden },
    { key: "last_price", label: "Last price", rendered: prices, ...hidden },
    { key: "min_stock_amount", label: "Min. stock amount", groupable: true, ...hidden },
    { key: "product_description", label: "Product description", ...hidden },
    { key: "parent_product_name", label: "Parent product", groupable: true, ...hidden },
    { key: "product_default_location_name", label: "Default location", groupable: true, ...hidden },
    { key: "product_picture", label: "Product picture", ...hidden },
    { key: "average_price", label: "Average price", rendered: prices, ...hidden },
    {
      key: "default_store_name",
      label: "Default store",
      rendered: prices,
      groupable: true,
      ...hidden,
    },
    ...fields.map((f) => ({
      key: "product:" + f.name,
      label: f.caption,
      labelIsLiteral: true,
      groupable: true,
    })),
  ];
}

type Context = {
  now: Date;
  locale: string;
  amountPrecision: number;
  pricePrecision: number;
  currency: string;
  showShoppingIcon: boolean;
  dueDays: number;
  t: (text: string, ...values: (string | number)[]) => string;
};

export function overviewCells(
  row: StockOverviewRow,
  fields: UserfieldDefinition[],
  context: Context,
): NativeTableRow {
  const { t } = context;
  const raw = (key: string) => row.number_text[key] ?? "";
  const amount = (key: string) => tableNumber(raw(key), context.amountPrecision);
  const currency = (key: string) => tableNumber(raw(key), context.pricePrecision, context.currency);
  const span = (value: string) => "<span>" + tableText(value) + "</span>";

  const number = (key: string, id = "") =>
    "<span" +
    (id ? ' id="' + id + '"' : "") +
    ' class="locale-number locale-number-quantity-amount number-parsing-done">' +
    tableText(amount(key)) +
    "</span>";

  const id = "product-" + row.product_id;
  const opened = row.amount_opened > 0 ? tableText(t("%s opened", raw("amount_opened"))) : "";

  const sum =
    '<i class="fa-solid fa-custom-sigma-sign"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M13 2H3l5 6-5 6h10" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></i>';

  const own =
    '<span class="' +
    (row.product_no_own_stock === 1 ? "d-none" : "") +
    '">' +
    tableLine +
    "\t" +
    number("amount", id + "-amount") +
    ' <span id="' +
    id +
    '-qu-name">' +
    tableText(row.unit_label) +
    "</span>" +
    tableLine +
    "\t" +
    '<span id="' +
    id +
    '-opened-amount" class="small font-italic">' +
    opened +
    "</span>" +
    tableLine +
    "</span>";

  const aggregate =
    row.is_aggregated_amount === 1
      ? tableLine +
        '<span class="' +
        (row.product_no_own_stock === 0 ? "pl-1 " : "") +
        'text-secondary">' +
        tableLine +
        "\t" +
        sum +
        " " +
        number("amount_aggregated", id + "-amount-aggregated") +
        " " +
        tableText(row.unit_label_aggregated) +
        (row.amount_opened_aggregated > 0
          ? tableLine +
            '<span id="' +
            id +
            '-opened-amount-aggregated" class="small font-italic">' +
            t("%s opened", number("amount_opened_aggregated")) +
            "</span>"
          : "") +
        tableLine +
        "</span>"
      : "";

  const shopping =
    context.showShoppingIcon && row.on_shopping_list
      ? '<span class="text-muted cursor-normal" title="' +
        tableAttribute(t("This product is currently on a shopping list")) +
        '"><i class="fa-solid fa-shopping-cart"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 2h2l2 9h8l2-7H4M6 14h.01M12 14h.01" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></i></span>'
      : "";

  const price = (key: "last_price" | "average_price") =>
    '<span class="custom-sort d-none">' +
    tableText(raw(key)) +
    "</span>" +
    (row[key] ? span(t("%1$s per %2$s", currency(key + "_display"), row.qu_price_name ?? "")) : "");

  const yesterday = new Date(context.now);
  yesterday.setDate(yesterday.getDate() - 1);
  const due = new Date(context.now);
  due.setDate(due.getDate() + context.dueDays);

  const cutoff = (date: Date) =>
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0") +
    " 23:59:59";

  const status =
    row.amount > 0
      ? row.best_before_date < cutoff(yesterday)
        ? row.due_type === 1
          ? "overdue"
          : "expired"
        : row.best_before_date < cutoff(due)
          ? "duesoon"
          : ""
      : "";

  // The native numeric parser sees the span markup before it strips tags.
  // An empty span therefore sorts as zero.
  const formattedNumber = (key: string) => {
    const html = span(amount(key));
    const numeric = Number.parseFloat(amount(key).replaceAll(",", ""));

    return {
      ...nativeNumberCell(html, amount(key) === "" ? 0 : numeric),
      search: nativeTableCell(html, "html").search,
    };
  };

  const values: NativeTableRow = {
    product_name: nativeTableCell(
      tableText(row.product_name) +
        ' <span class="d-none">' +
        tableText(row.product_barcodes) +
        "</span>",
    ),
    product_group_name: nativeTableCell(tableText(row.product_group_name)),
    amount: nativeNumberCell(
      '<span class="custom-sort d-none">' +
        tableText(raw(row.product_no_own_stock === 1 ? "amount_aggregated" : "amount")) +
        "</span>" +
        own +
        aggregate +
        shopping,
      Number(raw(row.product_no_own_stock === 1 ? "amount_aggregated" : "amount")),
    ),
    value: nativeNumberCell(
      '<span class="custom-sort d-none">' +
        tableText(raw("value")) +
        "</span>" +
        span(currency("value")),
      Number(raw("value")),
    ),
    best_before_date: nativeTableCell(
      tableDate(row.best_before_date, context.now, context.locale, t, {
        dateOnly: true,
        id: "product-" + row.product_id + "-next-due-date",
      }).html,
      "html",
    ),
    locations: nativeTableCell(
      tableText(row.location_names.map((name) => "xx" + (name ?? "") + "xx").join(" ")),
    ),
    status: nativeTableCell(
      status +
        " " +
        (row.amount_aggregated > 0 ? "instockX" : "") +
        " " +
        (row.product_missing ? "belowminstockamount" : ""),
    ),
    group_filter: nativeTableCell("xx" + tableText(row.product_group_name) + "xx"),
    product_calories: formattedNumber("product_calories"),
    calories: formattedNumber("calories"),
    last_purchased: nativeTableCell(
      tableDate(row.last_purchased, context.now, context.locale, t, { plain: true }).html,
      "html",
    ),
    last_price: nativeNumberCell(price("last_price"), Number.parseFloat(raw("last_price"))),
    min_stock_amount: formattedNumber("min_stock_amount"),
    product_description: nativeTableCell(row.product_description),
    parent_product_name: nativeTableCell(tableText(row.parent_product_name)),
    product_default_location_name: nativeTableCell(tableText(row.product_default_location_name)),
    product_picture: nativeTableCell(
      row.product_picture_file_name && row.product_picture_file_name !== "0"
        ? '<img src="' +
            tableAttribute(filePath("productpictures", row.product_picture_file_name)) +
            '?force_serve_as=picture&best_fit_width=64&best_fit_height=64" loading="lazy">'
        : "",
    ),
    average_price: nativeNumberCell(
      price("average_price"),
      Number.parseFloat(raw("average_price")),
    ),
    default_store_name: nativeTableCell(tableText(row.default_store_name)),
  };

  // Font Awesome uses CSS in the reference. Keep the SVG used for this
  // interface out of its cached search text.
  values.amount!.search = nativeTableCell(
    values.amount!.html.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/g, ""),
  ).search;

  for (const field of fields) {
    const value = row.product_values[field.name] ?? "";
    let html = tableText(value);

    if (field.type === "checkbox")
      html = Number(value) === 1 ? '<i class="fa-solid fa-check"></i>' : "";
    else if (field.type === "preset-checklist") html = value.split(",").map(tableText).join("<br>");
    else if (field.type === "number-decimal") html = span(tableNumber(value, 0));
    else if (field.type === "number-currency")
      html = span(tableNumber(value, context.pricePrecision, context.currency));
    else if (field.type === "file") html = tableText(userfieldFile(value).display);
    else if (field.type === "image") html = "";
    else if (field.type === "link-with-title") {
      try {
        html = tableText(JSON.parse(value).title ?? "");
      } catch {
        html = "";
      }
    }

    values["product:" + field.name] = nativeTableCell(html);
  }

  return values;
}
