import { useMutation } from "@tanstack/react-query";
import { useNotify } from "@/components/Toaster";
import { api, type ConsumeOptions, type PurchaseOptions } from "./api";
import { useCatalog, useInvalidateStock } from "./catalog";
import { useFeatures } from "./features";
import { preferenceEnabled } from "./preferences";

type Move = {
  productId: number;
  amount: number;
  purchase?: PurchaseOptions;
  consume?: ConsumeOptions;
};

const VERB = { purchase: "Purchased", consume: "Consumed", open: "Opened" } as const;

/** Purchase / consume / open with an undo toast. */
export function useStockMove(kind: keyof typeof VERB, enabled = true) {
  const features = useFeatures();
  const notify = useNotify();
  const catalog = useCatalog(enabled);
  const invalidate = useInvalidateStock();

  return useMutation({
    mutationFn: ({ productId, amount, purchase, consume }: Move) => {
      if (kind === "purchase") {
        const options = { ...purchase };

        if (!features.enabled("STOCK_PRICE_TRACKING")) {
          options.price = 0;
          delete options.shopping_location_id;
        }

        if (!features.enabled("STOCK_LOCATION_TRACKING")) delete options.location_id;

        if (!features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING")) options.best_before_date = null;

        return api.purchaseStock(productId, amount, options);
      }

      if (kind === "consume") return api.consumeStock(productId, amount, consume);

      return api.openStock(productId, amount);
    },
    onSuccess: async (bookings, { productId, amount }) => {
      await invalidate();
      const transactionId = bookings[0]?.transaction_id;

      const movedAmount =
        preferenceEnabled(catalog.product(productId)?.enable_tare_weight_handling) &&
        bookings.length
          ? Math.abs(bookings.reduce((sum, booking) => sum + Number(booking.amount), 0))
          : amount;

      notify({
        message: `${VERB[kind]} ${catalog.amountText(productId, movedAmount)} ${catalog.productName(productId)}`,
        undo: transactionId
          ? async () => {
              await api.undoTransaction(transactionId);
              await invalidate();
            }
          : undefined,
      });
    },
    onError: (err: Error) => notify({ message: err.message, tone: "error" }),
  });
}
