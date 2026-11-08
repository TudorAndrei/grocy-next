import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { userSettingsQuery } from "@/hooks/queries";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { preferenceEnabled } from "@/lib/preferences";
import { useNativePreferenceAutosave } from "@/lib/native-preferences";
import {
  getStockSettingsContext,
  stockSettingDefaults,
  type StockSettingsContext,
} from "@/lib/stock-settings";
import type { UserSettings } from "@/lib/types";
import { PageHeader } from "./PageHeader";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";
import { NumberPicker } from "./NumberPicker";

export function StockSettings() {
  const { t } = useI18n();
  const features = useFeatures();
  const settings = useQuery({ ...userSettingsQuery(), refetchOnMount: "always" });

  const choices = useQuery({
    queryKey: ["stock-settings-context"],
    queryFn: ({ signal }) => getStockSettingsContext(signal),
    refetchOnMount: "always",
    retry: false,
  });

  const [initial, setInitial] = useState<{
    settings: UserSettings;
    choices: StockSettingsContext;
    flags: { location: boolean; opened: boolean; price: boolean; labels: boolean };
  }>();

  if (
    !initial &&
    settings.isSuccess &&
    !settings.isFetching &&
    choices.isSuccess &&
    !choices.isFetching &&
    features.query.isSuccess &&
    !features.query.isFetching
  )
    setInitial({
      settings: { ...stockSettingDefaults, ...settings.data },
      choices: choices.data,
      flags: {
        location: features.enabled("STOCK_LOCATION_TRACKING"),
        opened: features.enabled("STOCK_PRODUCT_OPENED_TRACKING"),
        price: features.enabled("STOCK_PRICE_TRACKING"),
        labels: features.enabled("LABEL_PRINTER"),
      },
    });
  const error = settings.error ?? choices.error ?? features.query.error;

  return (
    <>
      <PageHeader title={t("Stock settings")} />
      {!initial && !error ? <LoadingBlock /> : null}
      {error ? (
        <>
          <ErrorBlock message={error.message} />
          <button
            type="button"
            className="btn"
            onClick={() =>
              void Promise.all([settings.refetch(), choices.refetch(), features.query.refetch()])
            }
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {initial ? (
        <StockControls initial={initial.settings} choices={initial.choices} flags={initial.flags} />
      ) : null}
    </>
  );
}

function StockControls({
  initial,
  choices,
  flags,
}: {
  initial: UserSettings;
  choices: StockSettingsContext;
  flags: { location: boolean; opened: boolean; price: boolean; labels: boolean };
}) {
  const { t } = useI18n();
  const id = useId();

  const [values, setValues] = useState(() => ({
    ...initial,
    ...Object.fromEntries(
      ["stock_default_purchase_amount", "stock_default_consume_amount"].map((key) => {
        const value = initial[key];

        return [
          key,
          value == null || value === ""
            ? ""
            : Number.parseFloat(String(value)).toLocaleString("en", {
                minimumFractionDigits: 0,
                maximumFractionDigits: Number(initial.stock_decimal_places_amounts),
                useGrouping: false,
              }),
        ];
      }),
    ),
  }));

  const persist = useNativePreferenceAutosave(initial);
  const raw = (key: string) => (values[key] == null ? "" : String(values[key]));

  const change = (key: string, value: UserSettings[string]) => {
    setValues((current) => ({ ...current, [key]: value }));
    persist(key, value);
  };

  const checkbox = (key: string, label: string) => (
    <label className="check-field">
      <input
        type="checkbox"
        checked={preferenceEnabled(values[key])}
        onChange={(event) => change(key, event.target.checked)}
      />
      {t(label)}
    </label>
  );

  const amountDecimals = Number(initial.stock_decimal_places_amounts);

  const number = (
    key: string,
    label: string,
    min: number,
    max?: number,
    amount = false,
    disabled = false,
  ) => (
    <div className="field">
      <label htmlFor={`${id}-${key}`}>{t(label)}</label>
      <NumberPicker
        id={`${id}-${key}`}
        label={t(label)}
        required
        value={raw(key)}
        min={min}
        max={max}
        step={amount ? String(10 ** -amountDecimals) : "1"}
        disabled={disabled}
        onChange={(value) => {
          setValues((current) => ({ ...current, [key]: value }));
        }}
        onBlur={(value) => {
          const input = document.getElementById(`${id}-${key}`);

          if (input instanceof HTMLInputElement && input.checkValidity()) persist(key, value);
        }}
        onStep={(value) => {
          const input = document.getElementById(`${id}-${key}`);

          if (input instanceof HTMLInputElement && input.checkValidity()) persist(key, value);
        }}
      />
    </div>
  );

  const select = (
    key: string,
    label: string,
    rows: { id: number; name: string | null }[],
    blank = true,
  ) => (
    <label className="field">
      {t(label)}
      <select
        value={raw(key)}
        ref={(node) => {
          if (
            node &&
            !(blank && raw(key) === "-1") &&
            !rows.some((row) => String(row.id) === raw(key))
          )
            node.selectedIndex = -1;
        }}
        onChange={(event) => change(key, event.target.value)}
      >
        {blank ? <option value="-1" /> : null}
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section
      className="panel panel-inner"
      style={{ maxWidth: "36rem" }}
      aria-label={t("Stock settings")}
    >
      <h2 className="panel-title">{t("Presets for new products")}</h2>
      {flags.location ? select("product_presets_location_id", "Location", choices.locations) : null}
      {select("product_presets_product_group_id", "Product group", choices.product_groups)}
      {select("product_presets_qu_id", "Quantity unit", choices.quantity_units)}
      {number("product_presets_default_due_days", "Default due days", -1)}
      {flags.opened
        ? checkbox("product_presets_treat_opened_as_out_of_stock", "Treat opened as out of stock")
        : null}
      {flags.labels
        ? select(
            "product_presets_default_stock_label_type",
            "Default stock entry label",
            [
              { id: 0, name: t("No label") },
              { id: 1, name: t("Single label") },
              { id: 2, name: t("Label per unit") },
            ],
            false,
          )
        : null}
      <h2 className="panel-title">{t("Stock overview")}</h2>
      {number("stock_due_soon_days", "Due soon days", 1)}
      {checkbox(
        "show_icon_on_stock_overview_page_when_product_is_on_shopping_list",
        "Show an icon if the product is already on the shopping list",
      )}
      {checkbox("stock_overview_show_all_out_of_stock_products", "Show all out of stock products")}
      <h2 className="panel-title">{t("Purchase")}</h2>
      {number("stock_default_purchase_amount", "Default amount for purchase", 0, undefined, true)}
      {checkbox(
        "show_purchased_date_on_purchase",
        "Show purchased date on purchase and inventory page (otherwise the purchased date defaults to today)",
      )}
      {checkbox(
        "show_warning_on_purchase_when_due_date_is_earlier_than_next",
        "Show a warning when the due date of the purchased product is earlier than the next due date in stock",
      )}
      <h2 className="panel-title">{t("Consume")}</h2>
      {number(
        "stock_default_consume_amount",
        "Default amount for consume",
        0,
        undefined,
        true,
        preferenceEnabled(values.stock_default_consume_amount_use_quick_consume_amount),
      )}
      {checkbox(
        "stock_default_consume_amount_use_quick_consume_amount",
        'Use the products "Quick consume amount"',
      )}
      <h2 className="panel-title">{t("Common")}</h2>
      {number("stock_decimal_places_amounts", "Decimal places allowed for amounts", 0, 10)}
      {flags.price ? (
        <>
          {number(
            "stock_decimal_places_prices_input",
            "Decimal places allowed for prices (input)",
            0,
            10,
          )}
          {number(
            "stock_decimal_places_prices_display",
            "Decimal places allowed for prices (display)",
            0,
            10,
          )}
          {checkbox(
            "stock_auto_decimal_separator_prices",
            "Add decimal separator automatically for price inputs",
          )}
        </>
      ) : null}
      <div className="actions">
        <Link to="/stockoverview" className="btn btn-primary">
          {t("OK")}
        </Link>
      </div>
    </section>
  );
}
