import type { EntityRow } from "./entities";
import { preferenceEnabled } from "./preferences";

export type NativeProductControl = {
  presence: "visible" | "hidden" | "absent";
  /** Whether the source control has the field's ID (parent uses ProductPicker). */
  addressable: boolean;
  /** Explicit hidden initial value, independent of the stored product. */
  value?: string;
};

export type NativeProductControls = Record<string, NativeProductControl>;

/** Productform.blade.php at Grocy 4.5.0: feature branches describe DOM, not grants. */
export function nativeProductControls(enabled: (name: string) => boolean) {
  const visible = (): NativeProductControl => ({ presence: "visible", addressable: true });
  const absent = (): NativeProductControl => ({ presence: "absent", addressable: false });

  const hidden = (value: string, addressable = true): NativeProductControl => ({
    presence: "hidden",
    addressable,
    value,
  });

  const location = enabled("STOCK_LOCATION_TRACKING");
  const price = enabled("STOCK_PRICE_TRACKING");
  const due = enabled("STOCK_BEST_BEFORE_DATE_TRACKING");
  const opened = enabled("STOCK_PRODUCT_OPENED_TRACKING");
  const freezing = enabled("STOCK_PRODUCT_FREEZING");
  const labels = enabled("LABEL_PRINTER");

  return {
    name: visible(),
    active: visible(),
    parent_product_id: visible(),
    description: visible(),
    location_id: location ? visible() : hidden("1"),
    default_consume_location_id: location ? visible() : hidden("1"),
    move_on_open: location && opened ? visible() : absent(),
    shopping_location_id: price ? visible() : hidden("1"),
    min_stock_amount: visible(),
    cumulate_min_stock_amount_of_sub_products: visible(),
    treat_opened_as_out_of_stock: opened ? visible() : absent(),
    due_type: due ? { presence: "visible", addressable: false } : hidden("1"),
    default_best_before_days: due ? visible() : hidden("1"),
    default_best_before_days_after_open: !due ? absent() : opened ? visible() : hidden("1"),
    // Unlike the other hidden inputs, these three source branches have no IDs.
    default_best_before_days_after_freezing: freezing ? visible() : hidden("0", false),
    default_best_before_days_after_thawing: freezing ? visible() : hidden("0", false),
    should_not_be_frozen: freezing ? visible() : hidden("0", false),
    product_group_id: visible(),
    qu_id_stock: visible(),
    qu_id_purchase: visible(),
    qu_id_consume: visible(),
    qu_id_price: visible(),
    enable_tare_weight_handling: visible(),
    tare_weight: visible(),
    not_check_stock_fulfillment_for_recipes: enabled("RECIPES") ? visible() : hidden("0"),
    calories: visible(),
    quick_consume_amount: visible(),
    quick_open_amount: visible(),
    default_stock_label_type: labels ? visible() : absent(),
    auto_reprint_stock_label: labels ? visible() : absent(),
    default_purchase_price_type: price ? { presence: "visible", addressable: false } : absent(),
    disable_open: opened ? visible() : absent(),
    hide_on_stock_overview: visible(),
    no_own_stock: visible(),
    qu_factor_purchase_to_stock: absent(),
  } satisfies NativeProductControls;
}

export type NativeProductCopy = {
  values: Record<string, string>;
  /** Actual value assignments in source order, even when the value is unchanged. */
  assigned: string[];
  description?: string;
  error?: Error;
};

/** Execute the native callback's mutations in order; selection and paste stay with the caller. */
export function copyNativeProductControls(
  current: Record<string, string>,
  source: EntityRow,
  controls: NativeProductControls,
): NativeProductCopy {
  const result: NativeProductCopy = { values: { ...current }, assigned: [] };

  const present = (name: string) =>
    controls[name]?.presence !== "absent" && controls[name]?.addressable;

  const assign = (name: string) => {
    if (!present(name)) return;
    // jQuery .val(undefined/null) explicitly sets the empty value.
    result.values[name] = source[name] == null ? "" : String(source[name]);
    result.assigned.push(name);
  };

  const check = (name: string) => {
    if (!present(name) || !preferenceEnabled(String(source[name] ?? ""))) return;

    // Setting .checked on a hidden input does not alter its serialized value.
    if (controls[name]?.presence !== "visible") return;
    result.values[name] = "1";
    result.assigned.push(name);
  };

  if (source.parent_product_id != null) assign("parent_product_id");

  if (source.description && present("description")) result.description = source.description;
  assign("location_id");

  if (source.shopping_location_id != null) {
    if (controls.shopping_location_id?.presence !== "visible") {
      result.error = new TypeError("Cannot read properties of undefined (reading 'SetId')");

      return result;
    }

    assign("shopping_location_id");
  }

  assign("min_stock_amount");
  check("cumulate_min_stock_amount_of_sub_products");
  assign("default_best_before_days");
  assign("default_best_before_days_after_open");

  if (source.product_group_id != null) assign("product_group_id");
  assign("qu_id_stock");
  assign("qu_id_purchase");
  check("enable_tare_weight_handling");
  assign("tare_weight");
  check("not_check_stock_fulfillment_for_recipes");

  if (source.calories != null) assign("calories");
  assign("default_best_before_days_after_freezing");
  assign("default_best_before_days_after_thawing");
  assign("quick_consume_amount");
  assign("quick_open_amount");
  assign("default_consume_location_id");
  check("no_own_stock");
  check("hide_on_stock_overview");
  check("auto_reprint_stock_label");
  assign("default_stock_label_type");
  check("move_on_open");
  check("treat_opened_as_out_of_stock");

  return result;
}

/** PHP-rendered radios and the label select fall back to their first native choice. */
export function normalizeNativeProductEnums(
  current: Record<string, string>,
  controls: NativeProductControls,
) {
  const values = { ...current };

  const number = (value: string | undefined) => {
    const text = (value ?? "").replace(/^[ \t\n\r\v\f]+|[ \t\n\r\v\f]+$/g, "");

    return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : undefined;
  };

  if (controls.due_type?.presence === "visible")
    values.due_type = number(values.due_type) === 2 ? "2" : "1";
  else if (controls.due_type?.presence === "hidden") values.due_type = "1";

  if (controls.default_purchase_price_type?.presence === "visible") {
    const price = number(values.default_purchase_price_type);
    values.default_purchase_price_type = price === 2 || price === 3 ? String(price) : "1";
  }

  if (controls.default_stock_label_type?.presence === "visible") {
    const label = number(values.default_stock_label_type);
    values.default_stock_label_type = label === 1 || label === 2 ? String(label) : "0";
  }

  return values;
}
