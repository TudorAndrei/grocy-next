import { createElement, type ReactNode } from "react";

type EmbeddedUndo =
  | { kind: "stock"; id: string }
  | { kind: "booking"; id: number; productId?: number }
  | { kind: "native-entry-booking" }
  | { kind: "chore"; id: number }
  | { kind: "battery"; id: number };

function receiptUndo(command: string): EmbeddedUndo | undefined {
  const stock = /^UndoStockTransaction\(\s*(['"])([A-Za-z0-9-]+)\1\s*\)\s*;?$/.exec(command);

  if (stock) return { kind: "stock", id: stock[2] };

  // StockEntryEditForm reads result.id on an array, producing this exact broken command.
  if (/^UndoStockBookingEntry\(\s*(['"])undefined\1\s*,\s*(['"])-?\d+\2\s*\)\s*;?$/.test(command))
    return { kind: "native-entry-booking" };

  const booking = /^UndoStockBookingEntry\(([^()]*)\)\s*;?$/.exec(command);

  if (booking) {
    const argumentsList = booking[1].split(",");

    if (argumentsList.length !== 2 && argumentsList.length !== 3) return undefined;

    const ids = argumentsList.map((argument) => {
      const match = /^(['"]?)(\d+)\1$/.exec(argument.trim());

      return match ? Number(match[2]) : NaN;
    });

    if (!ids.every((id) => Number.isSafeInteger(id) && id > 0)) return undefined;

    // Native stockRowId is accepted but unused by UndoStockBookingEntry.
    return { kind: "booking", id: ids[0], productId: ids[2] };
  }

  const household = /^(UndoChoreExecution|UndoChargeCycle)\(\s*(\d+)\s*\)\s*;?$/.exec(command);

  if (!household) return undefined;
  const id = Number(household[2]);

  if (!Number.isSafeInteger(id) || id <= 0) return undefined;

  return { kind: household[1] === "UndoChoreExecution" ? "chore" : "battery", id };
}

/** Turn the legacy receipt into inert content and a typed undo action. */
export function embeddedSuccess(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content
    .querySelectorAll("script,style,iframe,object,embed,svg,math,template")
    .forEach((node) => node.remove());
  let undo: EmbeddedUndo | undefined;

  for (const anchor of template.content.querySelectorAll("a[onclick]")) {
    const action = receiptUndo(anchor.getAttribute("onclick") ?? "");

    if (action) {
      undo ??= action;
      anchor.remove();
    }
  }

  const inline = new Set(["b", "strong", "em", "i", "br", "span", "code", "a"]);

  function content(node: Node, key: string): ReactNode {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;

    if (!(node instanceof Element)) return null;

    const children = Array.from(node.childNodes).map((child, index) =>
      content(child, `${key}-${index}`),
    );

    if (!inline.has(node.localName)) return children;

    if (node.localName === "br") return createElement("br", { key });

    if (node.localName === "a") {
      let target: URL;

      try {
        target = new URL(node.getAttribute("href") ?? "#", window.location.href);
      } catch {
        return children;
      }

      if (target.protocol !== "http:" && target.protocol !== "https:") return children;

      return createElement("a", { key, href: target.href }, children);
    }

    return createElement(node.localName, { key }, children);
  }

  return {
    message: template.content.textContent ?? "",
    content: Array.from(template.content.childNodes).map((node, index) =>
      content(node, String(index)),
    ),
    undo,
  };
}
