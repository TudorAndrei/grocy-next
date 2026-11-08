import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useLocation, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useI18n } from "@/lib/i18n";
import { apiBrowserDocument, configureApiBrowser } from "@/lib/api-browser";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

const browserMessage = z.discriminatedUnion("kind", [
  z.object({ channel: z.literal("grocy-api-browser"), kind: z.literal("mutation") }),
  z.object({ channel: z.literal("grocy-api-browser"), kind: z.literal("error") }),
  z.object({ channel: z.literal("grocy-api-browser"), kind: z.literal("hash"), hash: z.string() }),
]);

export function ApiBrowser() {
  const { t } = useI18n();
  const router = useRouter();
  const hash = useLocation({ select: () => router.history.location.hash });
  const client = useQueryClient();
  const frame = useRef<HTMLIFrameElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const receive = useEffectEvent((event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow)
      return;
    const parsed = browserMessage.safeParse(event.data);

    if (!parsed.success) return;
    const message = parsed.data;

    if (message.kind === "error") setFailed(true);
    else if (message.kind === "mutation") void client.invalidateQueries({ refetchType: "none" });
    else if (message.hash !== router.history.location.hash)
      void router.navigate({
        href: `${router.history.location.pathname}${router.history.location.search}${message.hash}`,
        replace: true,
      });
  });

  useEffect(() => {
    const listener = (event: MessageEvent) => receive(event);
    window.addEventListener("message", listener);
    const active = frame.current?.contentWindow;

    return () => {
      window.removeEventListener("message", listener);
      active?.postMessage(
        { channel: "grocy-api-browser", kind: "dispose" },
        window.location.origin,
      );
      void client.invalidateQueries({ refetchType: "none" });
    };
  }, [client, attempt]);

  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      { channel: "grocy-api-browser", kind: "navigate", hash },
      window.location.origin,
    );
  }, [hash]);

  return (
    <div className="native-api-browser">
      {loading && !failed ? <LoadingBlock label={t("Loading API browser…")} /> : null}
      {failed ? (
        <>
          <ErrorBlock message={t("Could not load API browser.")} />
          <button
            type="button"
            className="btn"
            onClick={() => {
              setFailed(false);
              setLoading(true);
              setAttempt((value) => value + 1);
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      <iframe
        key={attempt}
        ref={frame}
        title={t("REST API browser")}
        src={apiBrowserDocument()}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        onLoad={() => {
          setLoading(false);

          if (frame.current) configureApiBrowser(frame.current, t("REST API browser"), hash);
        }}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
