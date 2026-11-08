import type moment from "moment";

export type PickerEvent = { type: string; currentTarget: HTMLElement };
export type NativeDateTimeHandle = {
  GetValue: () => string;
  SetValue: (value: string) => void;
  ChangeFormat: (format: "YYYY-MM-DD" | "YYYY-MM-DD HH:mm:ss") => void;
  Clear: () => void;
};
export type Collection = {
  [index: number]: HTMLElement | undefined;
  length: number;
  find: (selector: string) => Collection;
  first: () => Collection;
  attr: (name: string) => string | undefined;
  data: (name: string) => object | undefined;
  on: (events: string, handler: (event: PickerEvent) => void) => Collection;
  off: (events?: string) => Collection;
  datetimepicker: (method: string) => Collection;
};
export type Selector = string | Element | Document | Window | Collection | undefined;
export type JQuery = {
  (selector?: Selector): Collection;
  fn: { hasAttr?: (this: Collection, name: string) => boolean };
  isNumeric: (value: string) => boolean;
};
export type GrocyDateHost = {
  Components: { DateTimePicker?: NativeDateTimeHandle; DateTimePicker2?: NativeDateTimeHandle };
  CalendarShowWeekNumbers: boolean;
};
export function createJQuery(window: Window): JQuery;
export function createMoment(): typeof moment;
export function installBootstrap(jQuery: JQuery, window: Window, document: Document): void;
export function installTempus(
  jQuery: JQuery,
  moment: typeof moment,
  window: Window,
  document: Document | HTMLElement,
): void;
export function installDateTimePicker2(
  selector: JQuery,
  moment: typeof moment,
  host: GrocyDateHost,
  refreshContext: () => void,
  publishClearValue?: () => void,
): void;
export function installDateTimePicker1(
  selector: JQuery,
  moment: typeof moment,
  host: GrocyDateHost,
  refreshContext: (selector?: string) => void,
  publishClearValue?: () => void,
): void;
