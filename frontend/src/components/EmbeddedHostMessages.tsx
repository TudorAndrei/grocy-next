import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useLocation, useMatch } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, request } from "@/lib/api";
import { useInvalidateStock } from "@/lib/catalog";
import { embeddedSuccess } from "@/lib/embedded-success";
import { useI18n } from "@/lib/i18n";
import { useNotify } from "./Toaster";
import { EmbeddedPageDialog, type EmbeddedPage } from "./EmbeddedPageDialog";
import { resizeResponsiveEmbeds } from "@/lib/responsive-embeds";
import { getTopmostGrocyWindow } from "@/lib/embedded-window";

const message = z.discriminatedUnion("Message", [
  z.object({ Message: z.literal("ShowSuccessMessage"), Payload: z.string() }),
  z.object({ Message: z.literal("CloseLastModal"), Payload: z.null().optional() }),
  z.object({ Message: z.literal("ResizeResponsiveEmbeds"), Payload: z.null().optional() }),
  z.object({ Message: z.literal("Reload"), Payload: z.null().optional() }),
  z.object({ Message: z.literal("ProductBarcodesChanged"), Payload: z.null().optional() }),
  z.object({ Message: z.literal("ProductQUConversionChanged"), Payload: z.null().optional() }),
  z.object({
    Message: z.literal("IframeModal"),
    Payload: z.object({ Link: z.string(), DialogType: z.string().optional() }),
  }),
]);

const broadcast = z.object({
  Message: z.literal("BroadcastMessage"),
  Payload: z.object({ Message: z.string(), Payload: z.json().optional() }).passthrough(),
});

const bookings = z.array(z.object({ product_id: z.number().int().positive() }));

export function EmbeddedHostMessages() {
  const notify = useNotify();
  const client = useQueryClient();
  const invalidate = useInvalidateStock();
  const { t } = useI18n();
  const [pages, setPages] = useState<EmbeddedPage[]>([]);
  const nextId = useRef(1);
  const pathname = useLocation({ select: (location) => location.pathname });
  const nativeProduct = useMatch({ from: "/product/$productId", shouldThrow: false });
  const modernCatalog = useMatch({ from: "/catalog", shouldThrow: false });
  const modernProduct = useMatch({ from: "/products/$productId", shouldThrow: false });
  const [pagePath, setPagePath] = useState(pathname);

  if (pagePath !== pathname) {
    setPagePath(pathname);
    setPages([]);
  }

  const receive = useEffectEvent((event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    const envelope = broadcast.safeParse(event.data);

    if (envelope.success) {
      window.postMessage(envelope.data.Payload, window.location.origin);

      for (const frame of document.querySelectorAll<HTMLIFrameElement>("iframe.embed-responsive"))
        frame.contentWindow?.postMessage(event.data, window.location.origin);

      return;
    }

    const parsed = message.safeParse(event.data);

    if (!parsed.success) return;

    if (
      parsed.data.Message === "ProductBarcodesChanged" ||
      parsed.data.Message === "ProductQUConversionChanged"
    ) {
      if (nativeProduct) window.location.reload();
      else if (modernCatalog || modernProduct) {
        const entity =
          parsed.data.Message === "ProductBarcodesChanged"
            ? "product_barcodes"
            : "quantity_unit_conversions";

        void Promise.all([
          client.invalidateQueries({ queryKey: ["product-related"] }),
          client.invalidateQueries({ queryKey: ["entity-manager", entity] }),
          client.invalidateQueries({ queryKey: ["objects", entity] }),
          ...(entity === "quantity_unit_conversions"
            ? [
                client.invalidateQueries({
                  queryKey: ["objects", "quantity_unit_conversions_resolved"],
                }),
              ]
            : []),
        ]);
      }

      return;
    }

    if (parsed.data.Message === "ResizeResponsiveEmbeds") {
      resizeResponsiveEmbeds();

      return;
    }

    if (parsed.data.Message === "Reload") {
      window.location.reload();

      return;
    }

    if (parsed.data.Message === "IframeModal") {
      let url: URL;

      try {
        url = new URL(parsed.data.Payload.Link, window.location.href);
      } catch {
        notify({ message: t("Could not open embedded page."), tone: "error" });

        return;
      }

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        notify({ message: t("Could not open embedded page."), tone: "error" });

        return;
      }

      const page = {
        id: nextId.current++,
        url: url.href,
        dialogType: parsed.data.Payload.DialogType ?? "form",
      };

      setPages((current) => [...current, page]);

      return;
    }

    if (parsed.data.Message === "CloseLastModal") {
      const dialog = Array.from(
        document.querySelectorAll<HTMLDialogElement>(
          "dialog[open]:not(.custom-escape-key-handling)",
        ),
      ).at(-1);

      if (dialog?.dispatchEvent(new Event("cancel", { cancelable: true }))) dialog.close();

      return;
    }

    const receipt = embeddedSuccess(parsed.data.Payload);
    const undo = receipt.undo;
    notify({
      message: receipt.message,
      content: receipt.content,
      undo: undo
        ? async () => {
            if (undo.kind === "native-entry-booking") {
              if (pathname.replace(/\/+$/, "") !== "/stockentries") {
                console.error(new ReferenceError("UndoStockBookingEntry is not defined"));

                return false;
              }

              try {
                await request("/api/stock/bookings/undefined/undo", {
                  method: "POST",
                  body: "{}",
                });
                getTopmostGrocyWindow().postMessage(
                  {
                    Message: "BroadcastMessage",
                    Payload: { Message: "ProductChanged", Payload: null },
                  },
                  window.location.origin,
                );
                notify({ message: t("Booking successfully undone") });
              } catch (error) {
                console.error(error);
              }

              return false;
            }

            if (undo.kind === "chore" || undo.kind === "battery") {
              const chore = undo.kind === "chore";

              if (chore) await api.undoChoreExecution(undo.id);
              else await api.undoBatteryCharge(undo.id);

              notify({
                message: chore
                  ? t("Chore execution successfully undone")
                  : t("Charge cycle successfully undone"),
              });
              const entity = chore ? "chores" : "batteries";

              await Promise.all([
                client.invalidateQueries({ queryKey: [entity] }),
                client.invalidateQueries({ queryKey: ["household-current", entity] }),
                client.invalidateQueries({
                  queryKey: ["objects", chore ? "chores_log" : "battery_charge_cycles"],
                }),
                client.invalidateQueries({ queryKey: ["calendar"] }),
              ]);

              return;
            }

            if (undo.kind === "booking") {
              await api.action(`/api/stock/bookings/${undo.id}/undo`);
              notify({ message: t("Booking successfully undone") });

              if (undo.productId !== undefined)
                window.postMessage(
                  {
                    Message: "BroadcastMessage",
                    Payload: { Message: "ProductChanged", Payload: undo.productId },
                  },
                  window.location.origin,
                );
              await invalidate();

              return;
            }

            const transaction = undo.id;
            await api.undoTransaction(transaction);
            notify({ message: t("Transaction successfully undone") });

            try {
              const saved = bookings.parse(
                await request(`/api/stock/transactions/${encodeURIComponent(transaction)}`),
              );

              if (saved[0])
                window.postMessage(
                  {
                    Message: "BroadcastMessage",
                    Payload: { Message: "ProductChanged", Payload: saved[0].product_id },
                  },
                  window.location.origin,
                );
              await invalidate();
            } catch (error) {
              notify({
                message: error instanceof Error ? error.message : t("Failed to load product"),
                tone: "error",
              });
            }
          }
        : undefined,
    });
  });

  useEffect(() => {
    const listener = (event: MessageEvent) => receive(event);
    window.addEventListener("message", listener);

    return () => window.removeEventListener("message", listener);
  }, []);

  useEffect(() => {
    const loaded = (event: Event) => {
      if (event.target instanceof HTMLIFrameElement) resizeResponsiveEmbeds();
    };

    window.addEventListener("resize", resizeResponsiveEmbeds);
    document.addEventListener("load", loaded, true);

    return () => {
      window.removeEventListener("resize", resizeResponsiveEmbeds);
      document.removeEventListener("load", loaded, true);
    };
  }, []);

  return pages.map((page) => (
    <EmbeddedPageDialog
      key={page.id}
      page={page}
      onClose={() => setPages((current) => current.filter((item) => item.id !== page.id))}
    />
  ));
}
