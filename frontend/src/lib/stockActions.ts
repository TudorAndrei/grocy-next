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
export function useStockMove(kind: keyof typeof VERB) {
  const notify = useNotify();
  const catalog = useCatalog();
  const invalidate = useInvalidateStock();

  return useMutation({
    mutationFn: ({ productId, amount, purchase, consume }: Move) => {
      if (kind === "purchase") return api.purchaseStock(productId, amount, purchase);

      if (kind === "consume") return api.consumeStock(productId, amount, consume);

      return api.openStock(productId, amount);
    },
    onSuccess: async (booking, { productId, amount }) => {
      await invalidate();
      notify({
        message: `${VERB[kind]} ${catalog.amountText(productId, amount)} ${catalog.productName(productId)}`,
        undo: async () => {
          await api.undoTransaction(booking.transaction_id);
          await invalidate();
        },
      });
    },
    onError: (err: Error) => notify({ message: err.message, tone: "error" }),
  });
}
