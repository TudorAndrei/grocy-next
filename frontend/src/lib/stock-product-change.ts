import { createContext, useEffect, useEffectEvent } from "react";
import { z } from "zod";
import { getTopmostGrocyWindow } from "./embedded-window";

export function broadcastProductChanged(productId: number) {
  getTopmostGrocyWindow().postMessage(
    {
      Message: "BroadcastMessage",
      Payload: { Message: "ProductChanged", Payload: productId },
    },
    window.location.origin,
  );
}

/** A legacy table may refresh a product without rebuilding its cached rows. */
export const StockProductChangeContext = createContext<((id: number) => Promise<void>) | null>(
  null,
);

const productChanged = z.object({
  Message: z.literal("ProductChanged"),
  Payload: z
    .union([z.number(), z.string().regex(/^\d+$/)])
    .transform((value) => Number(value))
    .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)),
});

/** The host unwraps broadcast bags and delivers their original local message. */
export function useProductChangedMessage(refresh: (id: number) => Promise<void>) {
  const changed = useEffectEvent(refresh);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const parsed = productChanged.safeParse(event.data);

      if (!parsed.success) return;
      void changed(parsed.data.Payload);
    };

    window.addEventListener("message", receive);

    return () => window.removeEventListener("message", receive);
  }, []);
}
