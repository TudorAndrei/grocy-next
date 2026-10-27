import { useQuery } from "@tanstack/react-query";
import { userSettingsQuery } from "@/hooks/queries";
import { formatAmount } from "./format";

export function usePreferences() {
  const settings = useQuery(userSettingsQuery());

  const number = (key: string, fallback: number) => {
    const value = settings.data?.[key];
    const parsed = value == null ? fallback : Number(value);

    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const enabled = (key: string) => {
    const value = settings.data?.[key];

    return value === true || value === 1 || value === "1";
  };

  const amountPrecision = Math.max(
    0,
    Math.min(20, Math.trunc(number("stock_decimal_places_amounts", 4))),
  );

  return {
    amountPrecision,
    dueSoonDays: Math.max(0, Math.trunc(number("stock_due_soon_days", 5))),
    purchaseAmount: number("stock_default_purchase_amount", 0),
    consumeAmount: number("stock_default_consume_amount", 1),
    useQuickConsumeAmount: enabled("stock_default_consume_amount_use_quick_consume_amount"),
    autoReload: enabled("auto_reload_on_db_change"),
    formatAmount: (value: number | string | null | undefined) =>
      formatAmount(value, amountPrecision),
  };
}
