import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, queryKeys } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { fetchApiDocument } from "@/lib/open-document";
import type { ShoppingList } from "@/lib/types";
import { ErrorBlock } from "./ErrorBlock";
import { FullscreenCard } from "./FullscreenCard";
import { LoadingBlock } from "./LoadingBlock";

const editorMessage = z.object({
  channel: z.literal("grocy-shopping-notes"),
  kind: z.enum(["ready", "change", "clear", "resize", "focus-forward", "focus-back"]),
  html: z.string(),
  empty: z.boolean(),
  height: z.number().finite().positive(),
  fullscreen: z.boolean(),
});

const interactionMessage = z.discriminatedUnion("kind", [
  z.object({
    channel: z.literal("grocy-shopping-notes"),
    kind: z.literal("activity"),
    event: z.enum(["mousemove", "mousedown", "click", "scroll", "keypress"]),
  }),
  z.object({
    channel: z.literal("grocy-shopping-notes"),
    kind: z.literal("dirty"),
    event: z.enum(["keyup", "paste", "change", "click"]),
  }),
]);

export function ShoppingNotes({
  listId,
  description,
  onDraft,
  initialDocument,
}: {
  listId: number;
  description: string | null | undefined;
  onDraft: (notes: { html: string; visible: boolean }) => void;
  initialDocument?: string;
}) {
  const { t, locale } = useI18n();
  const client = useQueryClient();
  const frame = useRef<HTMLIFrameElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [initiallyVisible] = useState(Boolean(description));

  const [state, setState] = useState({
    html: description ?? "",
    ready: false,
    dirty: false,
    empty: true,
    height: 390,
  });

  const document = useQuery({
    queryKey: ["shopping-notes-editor", listId, locale],
    queryFn: async ({ signal }) =>
      (await fetchApiDocument(`/api/v2/shopping-lists/${listId}/notes/editor`, signal)).text(),
    staleTime: Infinity,
    gcTime: 0,
    enabled: initialDocument === undefined,
  });

  const editorDocument = initialDocument ?? document.data;
  const documentError = initialDocument === undefined ? document.error : null;

  const save = useMutation({
    mutationFn: (html: string) => api.updateObject("shopping_lists", listId, { description: html }),
    onSuccess: (_data, html) => {
      setState((previous) => ({ ...previous, dirty: previous.html !== html }));
      client.setQueryData<ShoppingList>(queryKeys.shopping(listId), (previous) =>
        previous ? { ...previous, description: html } : previous,
      );
    },
  });

  const saveNotes = save.mutate;

  const sendAppearance = useCallback(() => {
    frame.current?.contentWindow?.postMessage(
      {
        channel: "grocy-shopping-notes",
        command: "appearance",
        dark: window.document.documentElement.dataset.theme === "dark",
        direction: window.document.documentElement.dir,
      },
      "*",
    );
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(sendAppearance);
    observer.observe(window.document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "dir"],
    });
    sendAppearance();

    return () => observer.disconnect();
  }, [sendAppearance]);

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

      const parsed = editorMessage.safeParse(event.data);

      if (!parsed.success) return;
      const data = parsed.data;

      if (data.kind === "ready") sendAppearance();

      if (data.kind === "focus-forward" || data.kind === "focus-back") {
        const controls = frame.current
          ?.closest(".shopping-notes")
          ?.querySelectorAll<HTMLButtonElement>(".shopping-notes-heading button:not(:disabled)");

        const control =
          data.kind === "focus-back"
            ? controls?.item((controls?.length ?? 1) - 1)
            : controls?.item(0);

        control?.focus();

        return;
      }

      setExpanded(data.fullscreen);
      setState((previous) => ({
        html: data.kind === "resize" ? previous.html : data.html,
        empty: data.empty,
        ready: true,
        dirty: data.kind === "change" || data.kind === "clear" || previous.dirty,
        height: Math.max(360, data.height),
      }));

      if (data.kind !== "resize") onDraft({ html: data.html, visible: initiallyVisible });

      if (data.kind === "clear") {
        setClearing(false);
        saveNotes(data.html);
      }
    };

    window.addEventListener("message", receive);

    return () => window.removeEventListener("message", receive);
  }, [initiallyVisible, onDraft, saveNotes, sendAppearance]);

  const changeFullscreen = useCallback((value: boolean) => {
    setExpanded(value);

    if (!value)
      frame.current?.contentWindow?.postMessage(
        { channel: "grocy-shopping-notes", command: "leave-fullscreen" },
        "*",
      );
  }, []);

  useEffect(() => {
    if (expanded)
      frame.current?.contentWindow?.postMessage(
        { channel: "grocy-shopping-notes", command: "focus" },
        "*",
      );
  }, [expanded]);

  return (
    <FullscreenCard
      label={t("Notes")}
      className="shopping-notes panel"
      expanded={expanded}
      onExpandedChange={changeFullscreen}
    >
      <div className="shopping-notes-heading">
        <h2>{t("Notes")}</h2>
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!state.ready || !state.dirty || save.isPending || clearing}
            onClick={() => save.mutate(state.html)}
          >
            {t("Save")}
          </button>
          <button
            type="button"
            className="btn btn-danger-quiet"
            disabled={!state.ready || state.empty || save.isPending || clearing}
            onClick={() => {
              setClearing(true);
              frame.current?.contentWindow?.postMessage(
                { channel: "grocy-shopping-notes", command: "clear" },
                "*",
              );
            }}
          >
            {t("Clear")}
          </button>
          {expanded ? (
            <button type="button" className="btn btn-ghost" onClick={() => changeFullscreen(false)}>
              {t("Leave fullscreen")}
            </button>
          ) : null}
        </div>
      </div>
      {(!editorDocument && document.isPending) || (editorDocument && !state.ready) ? (
        <LoadingBlock label={t("Loading…")} />
      ) : null}
      {documentError || save.error ? (
        <ErrorBlock message={(documentError ?? save.error)?.message ?? ""} />
      ) : null}
      {editorDocument ? (
        <iframe
          ref={frame}
          className="shopping-notes-frame"
          title={t("Notes")}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          srcDoc={editorDocument}
          style={{ height: state.height }}
        />
      ) : null}
    </FullscreenCard>
  );
}
