import type { OverviewProductRefresh } from "./stock-overview";
import { tableDate, type NativeTableRow } from "./native-table-cell";
import { nativeQuantityUnit } from "./native-quantity-unit";

/** Patch only native DOM targets. Search and ordering retain their original caches. */
export function refreshOverviewCells(
  source: NativeTableRow,
  value: OverviewProductRefresh,
  settings: {
    amountPrecision: number;
    pricePrecision: number;
    currency: string;
    locale: string;
    t: (message: string, ...values: (string | number)[]) => string;
    pluralIndex: (count: number) => number;
  },
  hidden: boolean,
): NativeTableRow {
  const cells = { ...source };
  const prefix = `product-${value.product.id}`;

  const amount = (value: number) =>
    value.toLocaleString(undefined, { maximumFractionDigits: settings.amountPrecision });

  let unitText = "";

  try {
    if (!hidden)
      unitText = nativeQuantityUnit(
        value.quantity_unit_stock,
        value.stock_amount,
        settings.pluralIndex,
      );
  } catch {
    // The native callback stops before it writes any cell when sprintf fails.
    return source;
  }

  const patch = (key: string, changes: (root: DocumentFragment) => void) => {
    const cell = source[key];

    if (!cell) return;
    const template = document.createElement("template");
    template.innerHTML = cell.html;
    changes(template.content);
    cells[key] = { ...cell, html: template.innerHTML };
  };

  patch("amount", (root) => {
    const set = (suffix: string, text: string) => {
      const element = root.querySelector(`#${prefix}-${suffix}`);

      if (element) element.textContent = text;
    };

    if (!hidden) {
      set("amount", amount(value.stock_amount));
      set("qu-name", unitText);
    }

    set(
      "opened-amount",
      value.stock_amount_opened > 0 ? settings.t("%s opened", value.stock_amount_opened) : "",
    );

    if (Number(value.is_aggregated_amount) === 1) {
      set("amount-aggregated", amount(value.stock_amount_aggregated));
      set(
        "opened-amount-aggregated",
        value.stock_amount_opened_aggregated > 0
          ? settings.t("%s opened", value.stock_amount_opened_aggregated)
          : "",
      );
    }
  });

  if (!hidden)
    patch("value", (root) => {
      const element = root.querySelector("span:not(.custom-sort)");

      if (element)
        element.textContent = value.stock_value.toLocaleString(undefined, {
          style: "currency",
          currency: settings.currency,
          minimumFractionDigits: settings.pricePrecision,
          maximumFractionDigits: settings.pricePrecision,
        });
    });

  if (source.best_before_date)
    cells.best_before_date = {
      ...source.best_before_date,
      html: tableDate(
        value.next_due_date || "2888-12-31",
        new Date(value.at),
        settings.locale,
        settings.t,
        { dateOnly: true, id: `${prefix}-next-due-date` },
      ).html,
    };

  return cells;
}

export function overviewRefreshTone(value: OverviewProductRefresh, days: number) {
  const due = new Date((value.next_due_date || "2888-12-31") + "T00:00:00");
  const now = new Date(value.at);
  const threshold = new Date(now);
  threshold.setDate(threshold.getDate() + days);

  if (now > due) return value.product.due_type === 1 ? "best-before" : "expired";

  if (due < threshold) return "soon";

  return Number(value.product.min_stock_amount) > 0 &&
    value.stock_amount_aggregated < Number(value.product.min_stock_amount)
    ? "low"
    : undefined;
}
