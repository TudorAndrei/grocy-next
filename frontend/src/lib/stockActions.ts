import { useMutation } from "@tanstack/react-query";
import { useNotify } from "@/components/Toaster";
import { api, type ConsumeOptions, type PurchaseOptions } from "./api";
import { useCatalog, useInvalidateStock } from "./catalog";

type Move = {
  productId: number;
  amount: number;
  purchase?: PurchaseOptions;
  consume?: ConsumeOptions;
};

const VERB = { purchase: "Purchased", consume: "Consumed", open: "Opened" } as const;

/** Purchase / consume / open with an undo toast. */
export function useStockMove(kind: keyof typeof VERB, enabled = true) {
  const notify = useNotify();
  const catalog = useCatalog(enabled);
  const invalidate = useInvalidateStock();

  return useMutation({
    mutationFn: ({ productId, amount, purchase, consume }: Move) => {
      if (kind === "purchase") return api.purchaseStock(productId, amount, purchase);

      if (kind === "consume") return api.consumeStock(productId, amount, consume);

      return api.openStock(productId, amount);
    },
    onSuccess: async (bookings, { productId, amount }) => {
      await invalidate();
      const transactionId = bookings[0]?.transaction_id;
      notify({
        message: `${VERB[kind]} ${catalog.amountText(productId, amount)} ${catalog.productName(productId)}`,
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
