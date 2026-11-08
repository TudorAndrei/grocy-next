import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "@tanstack/react-router";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { Icon } from "./Icon";
import { RecipeMealPlanAction } from "./RecipeMealPlan";

/** The overview owns dispatched actions; this menu only owns its presentation. */
export function NativeRecipeTableRowActions({
  recipe,
  onDelete,
  onCopy,
  onPrint,
}: {
  recipe: { id: number; name: string };
  onDelete: () => void;
  onCopy: () => void;
  onPrint: () => void;
}) {
  const { t } = useI18n();
  const features = useFeatures();
  const router = useRouter();
  const root = router.buildLocation({ to: "/", search: {} }).publicHref.replace(/\/+$/, "");
  const label = t("More actions for recipe %s", recipe.name);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const openingKey = useRef<string>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number }>();

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);

    if (restoreFocus) trigger.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const popup = menu.current?.getBoundingClientRect();

      if (!anchor || !popup) return;
      setPosition({
        left: Math.max(
          8,
          Math.min(anchor.right - popup.width, window.innerWidth - popup.width - 8),
        ),
        top: Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - popup.height - 8)),
      });
    };

    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        close(false);
    };

    const tab = (event: globalThis.KeyboardEvent) => {
      if (
        event.key === "Tab" &&
        !menu.current?.contains(document.activeElement) &&
        !trigger.current?.contains(document.activeElement)
      )
        close(false);
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keyup", tab);

    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keyup", tab);
    };
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open || !position || !openingKey.current) return;
    const items = menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');

    (openingKey.current === "ArrowUp" ? items?.[items.length - 1] : items?.[0])?.focus();
    openingKey.current = undefined;
  }, [open, position]);

  const keyboard = (event: KeyboardEvent) => {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        openingKey.current = event.key;
        setOpen(true);
      }

      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();

      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();

    const items = Array.from(
      menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );

    const current = items.findIndex((item) => item === document.activeElement);

    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? Math.min(current + 1, items.length - 1)
            : Math.max(current - 1, 0);

    items[next]?.focus();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="btn btn-ghost btn-sm"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={keyboard}
      >
        <Icon name="more" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menu}
              id={id}
              role="menu"
              aria-label={label}
              className="native-recipe-row-menu hide-on-fullscreen-card hide-when-embedded"
              style={{
                left: position?.left ?? 8,
                top: position?.top ?? 8,
                visibility: position ? "visible" : "hidden",
              }}
              onKeyDown={keyboard}
              onClick={(event) => {
                event.stopPropagation();

                if (event.target instanceof Element && event.target.closest('[role="menuitem"]'))
                  close();
              }}
            >
              <RecipeMealPlanAction id={recipe.id} name={recipe.name} nativeMenuItem />
              <button type="button" className="btn btn-ghost" role="menuitem" onClick={onDelete}>
                {t("Delete this item")}
              </button>
              <button type="button" className="btn btn-ghost" role="menuitem" onClick={onCopy}>
                {t("Copy recipe")}
              </button>
              <hr role="separator" />
              <a
                className="btn btn-ghost"
                role="menuitem"
                href={`${root}/recipe/${recipe.id}/grocycode?download=true`}
              >
                {t("Download %s Grocycode", t("Recipe"))}
              </a>
              {features.enabled("LABEL_PRINTER") ? (
                <a
                  className="btn btn-ghost recipe-grocycode-label-print"
                  role="menuitem"
                  data-recipe-id={recipe.id}
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    onPrint();
                  }}
                >
                  {t("Print %s Grocycode on label printer", t("Recipe"))}
                </a>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
