import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useI18n } from "@/lib/i18n";
import { useNativeProductDocument } from "@/lib/native-product-document";
import { fetchApiDocument } from "@/lib/open-document";
import { ErrorBlock } from "./ErrorBlock";
import { FullscreenCard } from "./FullscreenCard";
import { LoadingBlock } from "./LoadingBlock";

const messageSchema = z.object({
  channel: z.literal("grocy-description"),
  kind: z.enum(["ready", "change", "clear", "resize", "focus-forward", "focus-back"]),
  html: z.string(),
  empty: z.boolean(),
  height: z.number().finite().positive(),
  fullscreen: z.boolean(),
});

const interactionMessage = z.discriminatedUnion("kind", [
  z.object({
    channel: z.literal("grocy-description"),
    kind: z.literal("activity"),
    event: z.enum(["mousemove", "mousedown", "click", "scroll", "keypress"]),
  }),
  z.object({
    channel: z.literal("grocy-description"),
    kind: z.literal("dirty"),
    event: z.enum(["keyup", "paste", "change", "click"]),
  }),
]);

export function DescriptionEditor({
  entity,
  label = "Description",
  value,
  pasteInitial = false,
  pasteHtml,
  onChange,
  onReady,
}: {
  entity: "products" | "recipes" | "equipment";
  label?: string;
  value: string;
  pasteInitial?: boolean;
  pasteHtml?: string;
  onChange: (html: string) => void;
  onReady: (ready: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const nativeProduct = useNativeProductDocument();
  const instance = useId();
  const frame = useRef<HTMLIFrameElement>(null);
  const leave = useRef<HTMLButtonElement>(null);
  const paste = useRef(pasteInitial);
  const submittedPaste = useRef<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState({ document: -1, height: 390 });

  const document = useQuery({
    queryKey: ["description-editor", entity, instance, locale],
    queryFn: async ({ signal }) =>
      (
        await fetchApiDocument(
          `/api/v2/content/${entity}/editor`,
          signal,
          JSON.stringify({ html: value, paste: paste.current }),
        )
      ).text(),
    staleTime: nativeProduct ? "static" : Infinity,
    gcTime: 0,
    retry: false,
  });

  const ready = document.isSuccess && state.document === document.dataUpdatedAt;
  useEffect(() => onReady(ready), [ready, onReady]);

  useEffect(() => {
    const target = frame.current?.contentWindow;

    if (!ready || !target || pasteHtml === undefined || pasteHtml === submittedPaste.current)
      return;
    target.postMessage({ channel: "grocy-description", command: "paste", html: pasteHtml }, "*");
    submittedPaste.current = pasteHtml;
  }, [pasteHtml, ready]);

  const appearance = useCallback(() => {
    frame.current?.contentWindow?.postMessage(
      {
        channel: "grocy-description",
        command: "appearance",
        dark: window.document.documentElement.dataset.theme === "dark",
        direction: window.document.documentElement.dir,
      },
      "*",
    );
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(appearance);
    observer.observe(window.document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "dir"],
    });
    appearance();

    return () => observer.disconnect();
  }, [appearance]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== "null") return;
      const interaction = interactionMessage.safeParse(event.data);

      if (interaction.success) {
        if (interaction.data.kind === "activity")
          window.dispatchEvent(new CustomEvent("grocy-native-activity"));
        else {
          frame.current?.classList.add("is-dirty");
          frame.current?.closest("form")?.classList.add("is-dirty");
        }

        return;
      }

      const parsed = messageSchema.safeParse(event.data);

      if (!parsed.success) return;
      const data = parsed.data;

      if (data.kind === "focus-forward" || data.kind === "focus-back") {
        leave.current?.focus();

        return;
      }

      if (data.kind === "ready") {
        paste.current = false;
        appearance();
      }

      setExpanded(data.fullscreen);
      setState({ document: document.dataUpdatedAt, height: Math.max(360, data.height) });

      if (data.kind === "change" || data.kind === "clear") onChange(data.html);
    };

    window.addEventListener("message", receive);

    return () => window.removeEventListener("message", receive);
  }, [appearance, document.dataUpdatedAt, onChange]);

  const changeFullscreen = useCallback((value: boolean) => {
    setExpanded(value);

    if (!value)
      frame.current?.contentWindow?.postMessage(
        { channel: "grocy-description", command: "leave-fullscreen" },
        "*",
      );
  }, []);

  useEffect(() => {
    if (expanded)
      frame.current?.contentWindow?.postMessage(
        { channel: "grocy-description", command: "focus" },
        "*",
      );
  }, [expanded]);

  return (
    <FullscreenCard
      label={t(label)}
      className="description-editor"
      expanded={expanded}
      onExpandedChange={changeFullscreen}
    >
      <div className="description-editor-heading">
        <span>{t(label)}</span>
        {expanded ? (
          <button
            ref={leave}
            type="button"
            className="btn btn-ghost"
            onClick={() => changeFullscreen(false)}
          >
            {t("Leave fullscreen")}
          </button>
        ) : null}
      </div>
      {document.isPending || (document.isSuccess && !ready) ? (
        <LoadingBlock label={t("Loading editor…")} />
      ) : null}
      {document.error ? (
        <>
          <ErrorBlock message={document.error.message} />
          <button
            type="button"
            className="btn"
            onClick={() => {
              void document.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {document.data ? (
        <iframe
          key={locale + ":" + document.dataUpdatedAt}
          ref={frame}
          title={t(label)}
          className="shopping-notes-frame"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          srcDoc={document.data}
          style={{ height: ready ? state.height : 390 }}
        />
      ) : null}
    </FullscreenCard>
  );
}
