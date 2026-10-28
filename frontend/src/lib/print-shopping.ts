import { z } from "zod";
import { unitLabel } from "./format";
import { headerClockText } from "./header-clock";
import { fetchApiDocument } from "./open-document";

const unitSchema = z.object({
  name: z.string(),
  name_plural: z.string().nullable().optional(),
  plural_forms: z.string().nullable().optional(),
  active: z.coerce.number().optional(),
});

let activeFrame: HTMLIFrameElement | undefined;

export async function printShoppingDocument(
  path: string,
  options: {
    locale: string;
    pluralIndex: (count: number) => number;
    amountPrecision: number;
    priceDisplayPrecision: number;
    currency: string;
    beforePrint: () => void;
    returnFocus: HTMLElement | null;
    signal: AbortSignal;
  },
) {
  const html = await (await fetchApiDocument(path, options.signal)).text();
  activeFrame?.remove();
  const frame = document.createElement("iframe");
  activeFrame = frame;
  frame.title = "Shopping list";
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  frame.sandbox.add("allow-same-origin", "allow-modals");
  Object.assign(frame.style, {
    position: "fixed",
    width: "1280px",
    height: "1000px",
    opacity: "0",
    pointerEvents: "none",
  });

  try {
    await new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error("Could not load print document."));
      frame.srcdoc = html;
      document.body.append(frame);
    });
    const doc = frame.contentDocument;
    const target = frame.contentWindow;

    if (!doc || !target) throw new Error("Could not open print document.");

    const table = doc.querySelector<HTMLTableElement>("[data-shopping-table]");

    if (table) {
      const body = table.tBodies[0];
      const rows = Array.from(body.rows);
      rows.sort(
        (a, b) =>
          a.cells[0].innerHTML.trim().localeCompare(b.cells[0].innerHTML.trim()) ||
          a.cells[2].innerHTML.trim().localeCompare(b.cells[2].innerHTML.trim()),
      );
      let previous: string | undefined;

      for (const row of rows) {
        const group = row.cells[2].innerHTML;

        if (table.dataset.grouped === "true" && group !== previous) {
          const heading = doc.createElement("tr");
          heading.className = "dtrg-group dtrg-start dtrg-level-0";
          const cell = heading.insertCell();
          cell.colSpan = row.cells.length;
          cell.innerHTML = group;
          body.append(heading);
          previous = group;
        }

        body.append(row);
      }

      // The native print shadow uses separate scroll headers with intrinsic widths.
      const wrapper = doc.createElement("div");
      wrapper.className = "dataTables_wrapper dt-bootstrap4 no-footer";
      wrapper.innerHTML =
        '<div class="row"><div class="col-sm-12"><div class="dataTables_scroll"><div class="dataTables_scrollHead" style="overflow:hidden;position:relative;border:0;width:100%"><div class="dataTables_scrollHeadInner" style="box-sizing:content-box;width:0;padding-right:0"></div></div><div class="dataTables_scrollBody no-force-overflow-visible" style="position:relative;overflow:auto;width:100%"></div></div></div></div>';
      table.before(wrapper);
      const head = doc.createElement("table");
      head.className = "table table-sm table-striped nowrap dataTable no-footer";
      head.style.cssText = "margin-left:0;width:0";
      const headings = table.tHead;

      if (headings) head.append(headings.cloneNode(true));

      for (const cell of head.querySelectorAll<HTMLElement>("th")) {
        cell.style.width = "0px";
        cell.classList.add("sorting_disabled");
      }

      head.querySelector("th")?.classList.add("sorting_asc");
      headings?.querySelector("th")?.classList.add("sorting_asc");
      wrapper.querySelector(".dataTables_scrollHeadInner")?.append(head);
      wrapper.querySelector(".dataTables_scrollBody")?.append(table);
      table.classList.add("no-footer");
      table.style.width = "0px";

      for (const row of Array.from(headings?.rows ?? [])) {
        row.style.height = "0px";

        for (const cell of Array.from(row.cells)) {
          cell.classList.add("sorting_disabled");
          cell.style.cssText =
            "width:0;padding-top:0;padding-bottom:0;border-top-width:0;border-bottom-width:0;height:0";
          const size = doc.createElement("div");
          size.className = "dataTables_sizing";
          size.style.cssText = "height:0;overflow:hidden";
          size.append(...cell.childNodes);
          cell.append(size);
        }
      }
    }

    for (const element of doc.querySelectorAll<HTMLElement>("[data-number]")) {
      const value = Number.parseFloat(element.textContent ?? "");
      const currency = element.dataset.number === "currency";
      element.textContent = value.toLocaleString(undefined, {
        ...(currency ? { style: "currency", currency: options.currency } : { style: "decimal" }),
        minimumFractionDigits: currency ? options.priceDisplayPrecision : 0,
        maximumFractionDigits: currency
          ? options.priceDisplayPrecision
          : element.dataset.number === "quantity"
            ? options.amountPrecision
            : 0,
      });
    }

    for (const element of doc.querySelectorAll<HTMLElement>("[data-unit]")) {
      const unit = unitSchema.parse(JSON.parse(element.dataset.unit ?? "{}"));
      element.replaceWith(
        doc.createTextNode(
          unitLabel(unit, Number(element.dataset.count), options.pluralIndex, false),
        ),
      );
    }

    doc.body.normalize();
    const stamp = doc.querySelector("[data-print-timestamp]");

    if (stamp) stamp.textContent = headerClockText(new Date(), options.locale).small;
    await doc.fonts.ready;
    await Promise.all(Array.from(doc.images, (image) => image.decode().catch(() => undefined)));
    options.signal.throwIfAborted();
    options.beforePrint();
    const focus = options.returnFocus;
    target.addEventListener(
      "afterprint",
      () => {
        frame.remove();

        if (activeFrame === frame) activeFrame = undefined;

        if (focus?.isConnected) requestAnimationFrame(() => focus.focus());
      },
      { once: true },
    );
    target.focus();
    target.print();
  } catch (error) {
    frame.remove();

    if (activeFrame === frame) activeFrame = undefined;
    throw error;
  }
}
