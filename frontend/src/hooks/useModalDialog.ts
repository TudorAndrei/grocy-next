import { useEffect, useRef } from "react";

const locks = new WeakMap<
  Document,
  { owners: Set<symbol>; overflow: string; wasFullscreen: boolean }
>();

function focusedControl(document: Document): Element | null {
  const current = document.activeElement;

  const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe")).find(
    (frame) => frame === current,
  );

  try {
    return frame?.contentDocument ? (focusedControl(frame.contentDocument) ?? current) : current;
  } catch {
    return current;
  }
}

export function useModalDialog(open = true) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;

    const element = dialog.current;
    const previousFocus = focusedControl(document);
    const owner = Symbol("modal");
    let lock = locks.get(document);

    if (!lock) {
      lock = {
        owners: new Set(),
        overflow: document.body.style.overflow,
        wasFullscreen: document.body.classList.contains("fullscreen-card"),
      };
      locks.set(document, lock);
    }

    lock.owners.add(owner);
    element?.showModal();
    document.body.style.overflow = "hidden";

    return () => {
      element?.close();

      const current = locks.get(document);
      current?.owners.delete(owner);

      if (current && current.owners.size === 0) {
        // An unmounted full-screen card has already restored its own page lock.
        if (!current.wasFullscreen || document.body.classList.contains("fullscreen-card"))
          document.body.style.overflow = current.overflow;
        locks.delete(document);
      }

      const view = previousFocus?.ownerDocument.defaultView;

      if (view && previousFocus instanceof view.window.HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, [open]);

  return dialog;
}
