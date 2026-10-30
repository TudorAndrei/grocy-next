import moment from "moment/min/moment-with-locales.js";
import type { JsonValue } from "./json";

export type DateRangePicker = {
  container: ArrayLike<HTMLElement>;
  element: { on: (events: string, handler: () => void) => void };
  show: () => void;
  hide: () => void;
  remove: () => void;
};

type Options = {
  startDate: moment.Moment | string;
  endDate: moment.Moment | string;
  showDropdowns: boolean;
  alwaysShowCalendars: boolean;
  showWeekNumbers: boolean;
  locale: { format: string; firstDay?: JsonValue };
  buttonClasses: string;
  applyButtonClasses: string;
  cancelButtonClasses: string;
  ranges: Record<string, [moment.Moment, moment.Moment]>;
};

type Constructor = new (
  element: HTMLInputElement,
  options: Options,
  callback: (start: moment.Moment, end: moment.Moment) => void,
) => DateRangePicker;

declare global {
  interface Window {
    jQuery?: unknown;
    daterangepicker?: Constructor;
  }
}

let library: Promise<Constructor> | undefined;

function script(filename: string) {
  return new Promise<void>((resolve, reject) => {
    const element = document.createElement("script");
    const base = import.meta.env.BASE_URL.replace(/\/+$/, "");
    element.src = `${base}/vendor/daterangepicker/${filename}`;
    element.onload = () => resolve();
    element.onerror = () => {
      element.remove();
      reject(new Error("Could not load date range calendar."));
    };

    document.head.append(element);
  });
}

export async function loadDateRangePicker() {
  window.moment = moment;

  if (window.daterangepicker) return window.daterangepicker;
  library ??= (async () => {
    if (!window.jQuery) await script("jquery.min.js");
    await script("daterangepicker.js");

    if (!window.daterangepicker) throw new Error("Could not load date range calendar.");

    return window.daterangepicker;
  })().catch((error: Error) => {
    library = undefined;
    throw error;
  });

  return library;
}
