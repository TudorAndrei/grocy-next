import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { useI18n } from "@/lib/i18n";
import { useNativeDocumentReload, useNativePresentation } from "@/lib/native-document";
import {
  configureNativeCalendar,
  getNativeCalendarContext,
  nativeCalendarDocument,
  nativeCalendarTheme,
  type NativeCalendarContext,
} from "@/lib/native-calendar";
import { NativeCalendarActions } from "./NativeCalendarActions";
import { PageHeader } from "./PageHeader";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";

export function NativeCalendar() {
  const router = useRouter();
  const reloadDocument = useNativeDocumentReload("/calendar");

  const reload = async () => {
    reloadDocument();
    await router.navigate({ to: "/calendar", search: {}, hash: "", replace: true });
  };

  return <CalendarSession generation={0} onReload={reload} />;
}

function CalendarSession({
  generation,
  onReload,
}: {
  generation: number;
  onReload: () => Promise<void>;
}) {
  const { t, ready, localizationError, retryLocalization } = useI18n();
  const [snapshot, setSnapshot] = useState<NativeCalendarContext>();
  const presentation = useNativePresentation();
  const source = presentation?.kind === "calendar" ? presentation.value : undefined;

  const context = useQuery({
    queryKey: ["native-calendar", generation],
    queryFn: ({ signal }) => getNativeCalendarContext(signal),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
    enabled: !source,
  });

  if (
    !snapshot &&
    ready &&
    (source || (context.isSuccess && context.isFetchedAfterMount && !context.isFetching))
  )
    setSnapshot(source ?? context.data);

  return (
    <section className="native-calendar">
      <PageHeader
        title={t("Calendar")}
        actions={
          snapshot ? (
            <NativeCalendarActions
              settings={snapshot.user_settings}
              config={snapshot.config}
              onReload={onReload}
            />
          ) : undefined
        }
      />
      {snapshot ? (
        <CalendarRuntime context={snapshot} />
      ) : (
        <>
          {!context.error && !localizationError ? <LoadingBlock /> : null}
          {context.error || localizationError ? (
            <>
              <ErrorBlock message={(context.error ?? localizationError)!.message} />
              <button
                type="button"
                className="btn"
                onClick={() => {
                  retryLocalization();
                  void context.refetch();
                }}
              >
                {t("Retry")}
              </button>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

const calendarMessage = z.discriminatedUnion("kind", [
  z.object({ channel: z.literal("grocy-native-calendar"), kind: z.literal("ready") }),
  z.object({ channel: z.literal("grocy-native-calendar"), kind: z.literal("error") }),
  z.object({
    channel: z.literal("grocy-native-calendar"),
    kind: z.literal("height"),
    height: z.number().finite().nonnegative(),
  }),
  z.object({
    channel: z.literal("grocy-native-calendar"),
    kind: z.literal("navigate"),
    link: z.string(),
  }),
]);

function CalendarRuntime({ context }: { context: NativeCalendarContext }) {
  const { t } = useI18n();
  const router = useRouter();
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [height, setHeight] = useState(600);
  const [attempt, setAttempt] = useState(0);

  const receive = useEffectEvent((event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow)
      return;
    const result = calendarMessage.safeParse(event.data);

    if (!result.success) return;
    const data = result.data;

    if (data.kind === "ready") setLoaded(true);
    else if (data.kind === "error") setError(true);
    else if (data.kind === "height") setHeight(Math.max(100, data.height));
    else {
      const target = new URL(data.link, window.location.href);

      if (target.origin === window.location.origin)
        void router.navigate({ href: target.pathname + target.search + target.hash });
      else window.location.assign(target.href);
    }
  });

  useEffect(() => {
    const handler = (event: MessageEvent) => receive(event);
    window.addEventListener("message", handler);
    const active = frame.current?.contentWindow;

    const theme = new MutationObserver(() =>
      active?.postMessage(
        {
          channel: "grocy-native-calendar",
          kind: "theme",
          theme: nativeCalendarTheme(),
        },
        window.location.origin,
      ),
    );

    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style", "class"],
    });

    return () => {
      window.removeEventListener("message", handler);
      theme.disconnect();
      active?.postMessage(
        { channel: "grocy-native-calendar", kind: "dispose" },
        window.location.origin,
      );
    };
  }, [attempt]);

  useEffect(() => {
    if (!loaded) return;

    const resize = () =>
      frame.current?.contentWindow?.postMessage(
        { channel: "grocy-native-calendar", kind: "resize", viewportWidth: window.innerWidth },
        window.location.origin,
      );

    window.addEventListener("resize", resize, { once: true });

    return () => window.removeEventListener("resize", resize);
  }, [loaded]);

  return (
    <>
      {!loaded && !error ? <LoadingBlock /> : null}
      {error ? (
        <>
          <ErrorBlock message={t("Could not load calendar.")} />
          <button
            type="button"
            className="btn"
            onClick={() => {
              setError(false);
              setLoaded(false);
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
        title={t("Calendar")}
        src={nativeCalendarDocument()}
        height={height}
        sandbox="allow-scripts allow-same-origin"
        onLoad={() => {
          if (frame.current)
            configureNativeCalendar(
              frame.current,
              context,
              t("Calendar"),
              t("moment_locale"),
              t("fullcalendar_locale"),
            );
        }}
        onError={() => setError(true)}
      />
    </>
  );
}
