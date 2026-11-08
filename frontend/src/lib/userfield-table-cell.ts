import { nativeTableCell, tableText, tableNumber, tableAttribute } from "./native-table-cell";
import type { UserfieldDefinition } from "./userfields";
import type { JsonObject } from "./json";
import { nativeUserfieldFileDisplay } from "./native-userfield-file";
import { nativeUserfileUrl } from "./native-userfields-clear";
import { nativeUserfieldLink } from "./native-userfield-link";

export function userfieldTableCell(
  field: UserfieldDefinition,
  value: string | null,
  precision: number,
  currency: string,
  config?: JsonObject,
  present = true,
) {
  if (!present) return nativeTableCell("");
  const raw = value ?? "";

  if (field.type === "link" || field.type === "link-with-title") {
    const link = nativeUserfieldLink(field.type, value);

    return nativeTableCell(
      `<a href="${tableAttribute(link.link)}" target="_blank">${tableText(link.title)}</a>`,
    );
  }

  if (field.type === "file" || field.type === "image")
    return userfieldFileCell(field.type, value, config);

  let html = tableText(raw);

  if (field.type === "checkbox")
    html = Number(raw) === 1 ? '<i class="fa-solid fa-check"></i>' : "";
  else if (field.type === "preset-checklist") html = raw.split(",").map(tableText).join("<br>");
  else if (field.type === "number-decimal") html = tableText(tableNumber(raw, 0));
  else if (field.type === "number-currency")
    html = tableText(tableNumber(raw, precision, currency));

  return nativeTableCell(html);
}

function userfieldFileCell(type: "file" | "image", value: string | null, config?: JsonObject) {
  if (!value || value === "0") return nativeTableCell(tableText(value));
  const url = tableAttribute(nativeUserfileUrl(value, config));

  if (type === "file")
    return nativeTableCell(
      `<a href="${url}" target="_blank">${tableText(nativeUserfieldFileDisplay(value))}</a>`,
    );

  const display = tableAttribute(nativeUserfieldFileDisplay(value, "attribute"));

  // Native Chinese-string ordering and RowGroup identity both use the complete cell HTML.
  return nativeTableCell(
    `<a class="show-as-dialog-link" href="${url}?force_serve_as=picture">\n\t\t<img src="${url}?force_serve_as=picture&best_fit_width=32&best_fit_height=32" title="${display}" alt="${display}" loading="lazy">\n\t</a>`,
  );
}

export function nativeUserfieldTableCell(
  field: UserfieldDefinition,
  value: string | null,
  present: boolean,
  precision: number,
  currency: string,
  config?: JsonObject,
) {
  if (!present) return nativeTableCell("");
  const raw = value ?? "";

  if (field.type === "file" || field.type === "image")
    return userfieldFileCell(field.type, value, config);

  const cell = userfieldTableCell(field, value, precision, currency, config);

  if (field.type === "number-decimal" || field.type === "number-currency") {
    const type = field.type === "number-decimal" ? "generic" : "currency";

    return nativeTableCell(
      `<span class="locale-number locale-number-${type}${raw ? " number-parsing-done" : ""}">${cell.html}</span>`,
    );
  }

  return cell;
}
