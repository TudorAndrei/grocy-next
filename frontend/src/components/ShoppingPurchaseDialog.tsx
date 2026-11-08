import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { request } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type PurchaseEntry = { itemId: number; url: string; target?: HTMLElement };

export type ShoppingPurchaseRequest = {
  entries: readonly PurchaseEntry[];
  all: boolean;
  version: number;
};

type Session = {
  request: ShoppingPurchaseRequest | undefined;
  active: PurchaseEntry | undefined;
  queue: readonly PurchaseEntry[];
  position: number;
  shown: number;
  all: boolean;
  visible: boolean;
};

function initialSession(request?: ShoppingPurchaseRequest): Session {
  return {
    request,
    active: request?.entries[0],
    queue: request?.all ? request.entries : [],
    position: 0,
    shown: 0,
    all: Boolean(request?.all),
    visible: Boolean(request?.entries.length),
  };
}

const purchaseMessage = z.discriminatedUnion("Message", [
  z.object({ Message: z.literal("Ready"), Payload: z.null().optional() }),
  z.object({
    Message: z.literal("AfterItemAdded"),
    Payload: z.union([z.string(), z.number().int()]),
  }),
]);

function invalidatePurchasedStock(client: QueryClient) {
  for (const key of [
    ["stock"],
    ["products"],
    ["objects", "products"],
    ["recipes"],
    ["recipe-fulfillment"],
    ["recipe-view"],
    ["recipe-overview"],
    ["meal-plan"],
    ["mealplan-calendar"],
  ])
    void client.invalidateQueries({ queryKey: key, refetchType: "none" });
}

export function ShoppingPurchaseDialog({
  purchase,
  onRemoved,
}: {
  purchase?: ShoppingPurchaseRequest;
  onRemoved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const owner = useRef<AbortController>(undefined);
  const pending = useRef(new Set<number>());
  const [session, setSession] = useState(() => initialSession(purchase));

  if (purchase !== session.request) setSession(initialSession(purchase));

  const close = () =>
    setSession((current) => ({ ...current, visible: false, all: false, queue: [], position: 0 }));

  const ready = () =>
    setSession((current) => {
      const position = current.position + 1;

      if (!current.all || position >= current.queue.length)
        return { ...current, visible: false, all: false, queue: [], position: 0 };
      const active = current.queue[position]!;

      // Native captures DOM nodes. A removed node's delegated click no longer opens
      // a frame or updates its caption, although the sequence cursor advanced.
      if (active.target && !active.target.isConnected) return { ...current, position };

      return { ...current, active, position, shown: position, visible: true };
    });

  useEffect(() => {
    const controller = new AbortController();
    owner.current = controller;

    return () => {
      controller.abort();
      document.body.classList.remove("cursor-busy");
    };
  }, []);

  useEffect(() => {
    if (!session.active) return;

    // Navigating/replacing the iframe can retire a booking after its server write committed.
    return () => invalidatePurchasedStock(client);
  }, [client, session.active]);

  useEffect(() => {
    if (!session.visible) return;
    const element = dialog.current;
    const focus = document.activeElement;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";

    return () => {
      element?.close();
      document.body.style.overflow = overflow;

      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
    };
  }, [session.visible]);

  const receive = useEffectEvent((event: MessageEvent) => {
    if (!purchase || event.origin !== window.location.origin) return;
    const parsed = purchaseMessage.safeParse(event.data);

    if (!parsed.success) return;
    const bag = parsed.data;
    const fromFrame = event.source === frame.current?.contentWindow;

    if (bag.Message === "Ready") {
      if (fromFrame || (event.source === window && session.all)) ready();

      return;
    }

    if (!fromFrame || bag.Message !== "AfterItemAdded") return;
    const entry = purchase.entries.find((item) => String(bag.Payload) === String(item.itemId));

    if (!entry) return;
    // The child has already booked stock, independently of the following row deletion.
    invalidatePurchasedStock(client);

    if (pending.current.has(entry.itemId)) return;
    const signal = owner.current?.signal;
    const itemId = entry.itemId;

    if (signal?.aborted) return;
    pending.current.add(itemId);
    document.body.classList.add("cursor-busy");
    void request(`/api/objects/shopping_list/${itemId}`, { method: "DELETE", signal })
      .finally(() => {
        for (const key of [
          ["shopping"],
          ["shopping-lists"],
          ["objects", "shopping_list"],
          ["entity-manager", "shopping_list"],
          ["shopping-item-editor"],
        ])
          void client.invalidateQueries({ queryKey: key, refetchType: "none" });
      })
      .then(async () => {
        if (signal?.aborted) return;
        document.body.classList.remove("cursor-busy");
        await onRemoved();
      })
      .catch((error) => {
        if (!signal?.aborted) {
          document.body.classList.remove("cursor-busy");
          console.error(error);
        }
      })
      .finally(() => {
        pending.current.delete(itemId);
      });
  });

  useEffect(() => {
    const listener = (event: MessageEvent) => receive(event);
    window.addEventListener("message", listener);

    return () => window.removeEventListener("message", listener);
  }, []);

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog embedded-page-dialog form shopping-purchase-dialog"
      aria-label={t("Purchase")}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="section-heading">
        <h2>{t("Purchase")}</h2>
        <button type="button" className="btn btn-ghost" onClick={close}>
          {t("Close")}
        </button>
      </div>
      {session.active ? (
        <iframe
          key={session.request?.version}
          ref={frame}
          className="embed-responsive embedded-page-frame"
          title={t("Purchase")}
          src={session.active.url}
        />
      ) : null}
      {session.all ? (
        <div className="shopping-purchase-footer">
          <span role="status">
            {t(
              "Adding shopping list item %1$s of %2$s",
              String(session.shown + 1),
              String(session.queue.length),
            )}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              window.postMessage({ Message: "Ready", Payload: null }, window.location.origin)
            }
          >
            {t("Skip")}
          </button>
        </div>
      ) : null}
    </dialog>
  );
}
