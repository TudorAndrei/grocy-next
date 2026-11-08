import { z } from "zod";
import { request } from "./api";

const nativeCalendarContext = z.object({
  events: z.array(z.record(z.string(), z.json())),
  user_settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  config: z.record(z.string(), z.json()),
  locale: z.string(),
});

export type NativeCalendarContext = z.infer<typeof nativeCalendarContext>;

export async function getNativeCalendarContext(signal?: AbortSignal) {
  return nativeCalendarContext.parse(await request("/api/v2/calendar/context", { signal }));
}

export function nativeCalendarDocument() {
  return `${import.meta.env.BASE_URL.replace(/\/+$/, "")}/vendor/fullcalendar/index.html`;
}

export function nativeCalendarTheme() {
  const dark = document.documentElement.dataset.theme === "dark";
  const styles = getComputedStyle(document.documentElement);

  const defaults = dark
    ? {
        "--surface": "#333131",
        "--ink": "#c1c1c1",
        "--line": "#666666",
        "--surface-sunk": "#292b2a",
      }
    : {
        "--surface": "#ffffff",
        "--ink": "#212529",
        "--line": "#dee2e6",
        "--surface-sunk": "#f8f9fa",
      };

  return {
    mode: dark ? "dark" : "light",
    tokens: Object.fromEntries(
      Object.entries(defaults).map(([name, fallback]) => [
        name,
        styles.getPropertyValue(name).trim() || fallback,
      ]),
    ),
  };
}

export function configureNativeCalendar(
  frame: HTMLIFrameElement,
  context: NativeCalendarContext,
  title: string,
  momentLocale: string,
  calendarLocale: string,
) {
  frame.contentWindow?.postMessage(
    {
      channel: "grocy-native-calendar",
      kind: "configure",
      events: context.events,
      config: context.config,
      locale: context.locale,
      momentLocale,
      calendarLocale,
      title,
      viewportWidth: window.innerWidth,
      theme: nativeCalendarTheme(),
    },
    window.location.origin,
  );
}
