import { contextualDateText } from "./header-clock";

type CellText = { html: string; search: string };

export type NativeTableCell = CellText &
  ({ kind: "text" | "html"; order: string } | { kind: "number"; order: number });

export type NativeTableRow = Record<string, NativeTableCell>;

const newlines = /[\r\n\u2028]/g;
const tags = /<.*?>/g;

function fragment(html: string) {
  // A template is inert: reference cell markup must never load or execute content.
  const template = document.createElement("template");
  template.innerHTML = html;

  return template;
}

export function tableText(value: string | number | null): string {
  const span = document.createElement("span");
  span.textContent = String(value ?? "");

  return span.innerHTML;
}

export function tableAttribute(value: string): string {
  return tableText(value).replaceAll('"', "&quot;");
}

export const tableLine = "\n\t\t\t\t\t\t";

export function tableTime(
  timestamp: string | null,
  relative: string,
  id?: string,
  omitEmpty = false,
): string {
  return `<time${id ? ` id="${id}"` : ""} class="timeago timeago-contextual"${timestamp || !omitEmpty ? ` datetime="${tableAttribute(timestamp ?? "")}"` : ""}>${tableText(relative)}</time>`;
}

export function tableDate(
  source: string | null,
  now: Date,
  locale: string,
  translate: (message: string) => string,
  options: { id?: string; dateOnly?: boolean; plain?: boolean } = {},
) {
  const timestamp = source && options.dateOnly ? `${source} 23:59:59` : source;
  const context = contextualDateText(timestamp, now, locale, translate);
  const date = options.plain || context.date === timestamp ? (source ?? "") : context.date;
  const html = `${options.plain ? tableText(date) : `<span${options.id ? ` id="${options.id}"` : ""}>${tableText(date)}</span>`}${tableLine}${tableTime(timestamp, context.relative, options.id ? `${options.id}-timeago` : undefined, options.dateOnly)}`;

  return { date, relative: context.relative, timestamp, html };
}

export function quantityCell(amount: string, unit: string): NativeTableCell {
  return nativeTableCell(
    `<span class="locale-number locale-number-quantity-amount number-parsing-done">${tableText(amount)}</span> ${tableText(unit)}`,
  );
}

export function tablePlainText(html: string): string {
  return fragment(html).content.textContent ?? "";
}

export function nativeTableCell(html: string, kind: "text" | "html" = "text"): NativeTableCell {
  const content = fragment(html).innerHTML.trim();
  let search = kind === "html" ? content.replace(newlines, " ").replace(tags, "") : content;

  // The pinned engine only decodes HTML when a cell contains an entity.
  if (search.includes("&")) search = tablePlainText(search);

  return {
    kind,
    html: content,
    search: search.replace(newlines, ""),
    order: kind === "html" ? content.replace(tags, "").toLowerCase() : content,
  };
}

export function nativeNumberCell(html: string, order: number): NativeTableCell {
  return { ...nativeTableCell(html), kind: "number", order };
}

export function compareNativeCells(left: NativeTableCell, right: NativeTableCell): number {
  if (left.kind === "number" && right.kind === "number")
    return left.order < right.order ? -1 : left.order > right.order ? 1 : 0;
  const first = left.kind === "number" ? String(left.order) : left.order;
  const second = right.kind === "number" ? String(right.order) : right.order;

  return left.kind === "text"
    ? first.localeCompare(second)
    : first < second
      ? -1
      : first > second
        ? 1
        : 0;
}

export function tableNumber(value: string, places: number, currency?: string): string {
  if (!value) return "";

  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: currency ? places : 0,
    maximumFractionDigits: places,
  };

  if (currency) {
    options.style = "currency";
    options.currency = currency;
  }

  return Number.parseFloat(value).toLocaleString(undefined, options);
}
