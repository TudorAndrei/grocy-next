import moment from "moment/min/moment-with-locales.js";
import type { ProductOverviewData } from "./product-overview";
import { nativeQuantityUnit } from "./native-quantity-unit";
import { tableDate } from "./native-table-cell";

type CardDate = ReturnType<typeof tableDate>;

type Price = { text: string; title?: string };

export type ProductCardView = {
  name: string;
  description: string | null;
  descriptionProductId: number | null;
  descriptionVisible: boolean;
  ownAmount: string;
  ownUnit: string;
  ownOpened: string;
  aggregateAmount: string;
  aggregateUnit: string;
  aggregateOpened: string;
  aggregateVisible: boolean;
  noOwnStock: boolean;
  stockValue: string;
  location: string;
  lastPurchased: CardDate;
  lastUsed: CardDate;
  shelfLife: string;
  spoilRate: string;
  actionProductId: number | null;
  lastPrice: Price;
  averagePrice: Price;
  picture: string | null;
  history: { productId: number; factor: number; revision: number } | null;
};

export function emptyProductCard(): ProductCardView {
  const date = { date: "", relative: "", timestamp: null, html: "" };

  return {
    name: "",
    description: null,
    descriptionProductId: null,
    descriptionVisible: false,
    ownAmount: "",
    ownUnit: "",
    ownOpened: "",
    aggregateAmount: "",
    aggregateUnit: "",
    aggregateOpened: "",
    aggregateVisible: false,
    noOwnStock: false,
    stockValue: "",
    location: "",
    lastPurchased: date,
    lastUsed: date,
    shelfLife: "",
    spoilRate: "",
    actionProductId: null,
    lastPrice: { text: "" },
    averagePrice: { text: "" },
    picture: null,
    history: null,
  };
}

/** Preserve the native callback's field order when a formatter interrupts a read. */
export function refreshProductCard(
  previous: ProductCardView,
  data: ProductOverviewData,
  settings: {
    amountPrecision: number;
    pricePrecision: number;
    currency: string;
    priceTracking: boolean;
    now: Date;
    locale: string;
    t: (message: string, ...values: Array<string | number>) => string;
    pluralIndex: (count: number) => number;
  },
): ProductCardView {
  const view = { ...previous };

  const unit = (amount: number) =>
    nativeQuantityUnit(data.quantity_unit_stock, amount, settings.pluralIndex);

  const opened = (amount: number) =>
    amount > 0 ? settings.t("%s opened", amount.toLocaleString()) : "";

  const number = (amount: number) =>
    amount.toLocaleString(undefined, { maximumFractionDigits: settings.amountPrecision });

  const money = (amount: number) =>
    amount.toLocaleString(undefined, {
      style: "currency",
      currency: settings.currency,
      minimumFractionDigits: settings.pricePrecision,
      maximumFractionDigits: settings.pricePrecision,
    });

  const price = (amount: number): Price => ({
    text: settings.t(
      "%1$s per %2$s",
      money(amount * data.qu_conversion_factor_price_to_stock),
      data.quantity_unit_price.name ?? "",
    ),
    title: settings.t("%1$s per %2$s", money(amount), data.quantity_unit_stock.name ?? ""),
  });

  const rawDate = (source: string | null, prior: CardDate): CardDate => ({
    ...prior,
    date: (source || "2999-12-31").slice(0, 10),
    timestamp: source || "2999-12-31",
  });

  const date = (source: string | null) => {
    const cell = tableDate(source || "2999-12-31", settings.now, settings.locale, settings.t);

    return { ...cell, date: cell.date === source ? cell.date.slice(0, 10) : cell.date };
  };

  try {
    view.name = data.product.name ?? "";
    view.description = data.product.description;
    view.descriptionProductId = data.product.id;
    view.ownAmount = String(data.stock_amount || "0");
    view.ownUnit = unit(data.stock_amount);
    view.stockValue = String(data.stock_value || "0");
    view.lastPurchased = rawDate(data.last_purchased, view.lastPurchased);
    view.lastUsed = rawDate(data.last_used, view.lastUsed);

    if (data.location) view.location = data.location.name ?? "";
    view.spoilRate = (data.spoil_rate_percent / 100).toLocaleString(undefined, {
      style: "percent",
    });

    if (data.is_aggregated_amount === 1) {
      view.aggregateAmount = String(data.stock_amount_aggregated);
      view.aggregateUnit = unit(data.stock_amount_aggregated);
      view.aggregateOpened = opened(data.stock_amount_opened_aggregated);
      view.aggregateVisible = true;
    } else view.aggregateVisible = false;

    view.descriptionVisible = !!data.product.description;
    view.shelfLife =
      data.average_shelf_life_days === -1
        ? settings.t("Unknown")
        : data.average_shelf_life_days > 73000
          ? settings.t("Unlimited")
          : moment
              .duration(data.average_shelf_life_days, "days")
              .locale(settings.locale)
              .humanize();
    view.ownOpened = opened(data.stock_amount_opened);
    view.actionProductId = data.product.id;
    view.lastPrice =
      data.last_price === null ? { text: settings.t("Unknown") } : price(data.last_price);
    // The pinned average-price empty branch fails to remove its old tooltip.
    view.averagePrice =
      data.avg_price === null
        ? { ...view.averagePrice, text: settings.t("Unknown") }
        : price(data.avg_price);
    view.picture = data.product.picture_file_name;
    view.noOwnStock = data.product.no_own_stock === 1;
    view.lastPurchased = date(data.last_purchased);
    view.lastUsed = date(data.last_used);
    view.ownAmount = number(data.stock_amount);
    view.aggregateAmount = number(data.stock_amount_aggregated);
    view.stockValue = money(data.stock_value);

    if (settings.priceTracking)
      view.history = {
        productId: data.product.id,
        factor: data.qu_conversion_factor_price_to_stock,
        revision: (view.history?.revision ?? 0) + 1,
      };
  } catch {
    // Native __n can throw after earlier fields have already been written.
  }

  return view;
}
