import { useMutation } from "@tanstack/react-query";
import { api, request } from "@/lib/api";
import { useInvalidateStock } from "@/lib/catalog";
import { useFeatures } from "@/lib/features";
import { unitLabel } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/permissions";
import { usePreferences } from "@/lib/preferences";
import {
  getQuickOpenDetails,
  type OverviewProductRefresh,
  type StockOverviewRow,
} from "@/lib/stock-overview";
import type { Booking } from "@/lib/types";
import { useNotify } from "./Toaster";

/** The pinned overview displays consume units but books stock-unit quick amounts. */
export function StockOverviewQuickActions({
  row,
  refreshed,
}: {
  row: StockOverviewRow;
  refreshed?: OverviewProductRefresh;
}) {
  const { t, pluralIndex } = useI18n();
  const features = useFeatures();
  const can = usePermissions();
  const { amountPrecision } = usePreferences();
  const invalidate = useInvalidateStock();
  const notify = useNotify();
  const tare = row.enable_tare_weight_handling === 1;
  const name = row.product_name ?? "";

  const amountText = (amount: number | null) =>
    amount === null
      ? ""
      : amount.toLocaleString(undefined, { maximumFractionDigits: amountPrecision });

  // Native data attributes pass through PHP's float-to-string conversion before
  // the click handler parses them. The reader preserves that text separately.
  const nativeAmount = (
    key:
      | "amount"
      | "tare_weight"
      | "quick_consume_amount"
      | "quick_open_amount"
      | "quick_consume_amount_qu_consume"
      | "quick_open_amount_qu_consume",
  ) => (row[key] === null ? null : Number.parseFloat(row.number_text[key] ?? String(row[key])));

  const action = useMutation({
    mutationFn: ({ kind, amount }: { kind: "consume" | "open"; amount: number }) =>
      request<Booking[]>(`/api/stock/products/${row.product_id}/${kind}`, {
        method: "POST",
        body: JSON.stringify(
          kind === "consume"
            ? { amount, spoiled: false, allow_subproduct_substitution: true }
            : { amount, allow_subproduct_substitution: true },
        ),
      }),
    onSuccess: async (bookings, { kind, amount }) => {
      const openedDetails = kind === "open" ? await getQuickOpenDetails(row.product_id) : undefined;
      await invalidate(row.product_id);

      const unit =
        kind === "open"
          ? (row.qu_stock_name ?? "")
          : unitLabel(
              { name: row.qu_stock_name ?? "", name_plural: row.qu_stock_name_plural },
              amount,
              pluralIndex,
              false,
            );

      notify({
        message: t(
          kind === "open" ? "Marked %1$s of %2$s as opened" : "Removed %1$s of %2$s from stock",
          `${amountText(tare && kind === "consume" ? row.amount : amount)} ${unit}`.trim(),
          name,
        ),
        undo: bookings[0]?.transaction_id
          ? async () => {
              await api.undoTransaction(bookings[0]!.transaction_id);
              await invalidate(row.product_id);
            }
          : undefined,
      });

      if (
        Number(openedDetails?.product.move_on_open) === 1 &&
        openedDetails?.default_consume_location != null
      )
        notify({ message: t("Moved to %1$s", openedDetails.default_consume_location.name ?? "") });
    },
    onError: (error: Error) => notify({ message: error.message, tone: "error" }),
  });

  return (
    <>
      <button
        type="button"
        className="btn btn-sm"
        aria-label={t(
          "Consume %1$s of %2$s",
          `${amountText(nativeAmount("quick_consume_amount_qu_consume"))} ${row.qu_consume_name ?? ""}`.trim(),
          name,
        )}
        disabled={
          action.isPending ||
          !can("STOCK_CONSUME") ||
          (refreshed
            ? refreshed.stock_amount_aggregated === 0
            : tare || row.amount_aggregated < row.quick_consume_amount)
        }
        onClick={() =>
          action.mutate({ kind: "consume", amount: nativeAmount("quick_consume_amount")! })
        }
      >
        {t("Consume")} {amountText(nativeAmount("quick_consume_amount_qu_consume"))}
      </button>
      <button
        type="button"
        className="btn btn-sm"
        aria-label={t("Consume all %s which are currently in stock", name)}
        disabled={
          action.isPending ||
          !can("STOCK_CONSUME") ||
          (refreshed ? refreshed.stock_amount_aggregated === 0 : row.amount_aggregated === 0)
        }
        onClick={() =>
          action.mutate({
            kind: "consume",
            amount: refreshed
              ? refreshed.stock_amount
              : nativeAmount(tare ? "tare_weight" : "amount")!,
          })
        }
      >
        {t("All")}
      </button>
      {features.enabled("STOCK_PRODUCT_OPENED_TRACKING") ? (
        <button
          type="button"
          className="btn btn-sm"
          aria-label={t(
            "Mark %1$s of %2$s as open",
            `${amountText(nativeAmount("quick_open_amount_qu_consume"))} ${row.qu_consume_name ?? ""}`.trim(),
            name,
          )}
          disabled={
            action.isPending ||
            !can("STOCK_OPEN") ||
            (refreshed
              ? refreshed.stock_amount_aggregated === 0 || refreshed.product.disable_open === 1
              : tare ||
                row.disable_open === 1 ||
                row.amount_aggregated < row.quick_open_amount ||
                row.amount_aggregated === row.amount_opened_aggregated)
          }
          onClick={() =>
            action.mutate({ kind: "open", amount: nativeAmount("quick_open_amount")! })
          }
        >
          {t("Open")} {amountText(nativeAmount("quick_open_amount_qu_consume"))}
        </button>
      ) : null}
    </>
  );
}
