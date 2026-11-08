import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

export function HouseholdRowMenu({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const keyboard = useRef(false);
  const [open, setOpen] = useState(false);

  const supportsPopover =
    typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;

  useLayoutEffect(() => {
    const panel = menu.current;
    const trigger = button.current;

    if (!open || !panel || !trigger) return;
    // The top layer escapes table scrolling clips without moving the menu's DOM owner.
    panel.showPopover?.();

    const place = () => {
      const anchor = trigger.getBoundingClientRect();
      const bounds = panel.getBoundingClientRect();
      const width = document.documentElement.clientWidth || window.innerWidth;
      const height = window.innerHeight;
      const rtl = getComputedStyle(trigger).direction === "rtl";

      const aligned = rtl ? anchor.left : anchor.right - bounds.width;
      const left = Math.max(8, Math.min(aligned, width - bounds.width - 8));

      const below = anchor.bottom + 4;

      const top =
        below + bounds.height <= height - 8 ? below : Math.max(8, anchor.top - bounds.height - 4);

      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    observer?.observe(panel);

    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      observer?.disconnect();

      if (panel.hidePopover && panel.matches(":popover-open")) panel.hidePopover();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    if (keyboard.current) {
      keyboard.current = false;
      root.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    }

    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };

    document.addEventListener("pointerdown", outside);

    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return (
    <div
      className="household-row-menu"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }

        if (!open || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();

        const items = Array.from(
          root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [],
        );

        const selected = items.findIndex((item) => item === document.activeElement);

        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : event.key === "ArrowDown"
                ? (selected + 1) % items.length
                : (selected - 1 + items.length) % items.length;

        items[next]?.focus();
      }}
    >
      <button
        ref={button}
        type="button"
        className="btn btn-ghost btn-sm"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            event.stopPropagation();
            keyboard.current = true;
            setOpen(true);
          }
        }}
      >
        <Icon name="more" />
      </button>
      {open ? (
        <div
          ref={menu}
          id={id}
          role="menu"
          popover={supportsPopover ? "manual" : undefined}
          aria-label={label}
          className="household-row-menu-items"
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest('[role="menuitem"]')) {
              setOpen(false);
              button.current?.focus();
            }
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
