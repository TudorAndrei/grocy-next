import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "@tanstack/react-router";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { Icon } from "./Icon";

type Common = {
  rowId: number;
  productId: number;
  productName: string | null;
  returnTo: string;
  onDialog: (url: string, dialogType: "form" | "table") => void;
  onOverview: () => void;
  onPrint: () => void;
};

type Props = Common &
  (
    | { variant: "entries"; locationId: number; stockId: string; onSpoiled: () => void }
    | { variant: "journal"; can: (permission: string) => boolean }
  );

/** default.blade supplies this once per document, before any partial URI edits. */
export function useNativeStockReturnTo() {
  const router = useRouter();

  const [value] = useState(() => {
    const base = new URL(
      router.buildLocation({ to: "/", search: {} }).publicHref,
      window.location.href,
    ).href;

    return (
      "/" +
      new URL(router.history.location.href, window.location.origin).href
        .split("?")[0]!
        .replace(base, "")
    );
  });

  return value;
}

/** Native row menus live outside the scrolling table; child frames belong to the page. */
export function NativeStockRowMenu(props: Props) {
  const { t } = useI18n();
  const features = useFeatures();
  const router = useRouter();
  const root = router.buildLocation({ to: "/", search: {} }).publicHref.replace(/\/+$/, "");
  const href = (path: string) => root + path;
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const openingKey = useRef<string>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number }>();

  const label = t(
    props.variant === "entries"
      ? "More actions for stock entry %s"
      : "More actions for stock transaction %s",
    String(props.rowId),
  );

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);

    if (restoreFocus) button.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const anchor = button.current?.getBoundingClientRect();
      const popup = menu.current?.getBoundingClientRect();

      if (!anchor || !popup) return;
      const left = props.variant === "journal" ? anchor.right - popup.width : anchor.left;
      setPosition({
        left: Math.max(8, Math.min(left, window.innerWidth - popup.width - 8)),
        top: Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - popup.height - 8)),
      });
    };

    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !button.current?.contains(event.target)
      )
        close(false);
    };

    place();

    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside);

    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open, props.variant, close]);

  useLayoutEffect(() => {
    if (!open || !position || !openingKey.current) return;

    const items = Array.from(
      menu.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"]):not(:disabled)',
      ) ?? [],
    );

    (openingKey.current === "ArrowUp" ? items.at(-1) : items[0])?.focus();
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
      menu.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"]):not(:disabled)',
      ) ?? [],
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

  const permission = (name?: string) => {
    if (props.variant !== "journal" || !name) return {};
    const disabled = !props.can(name);

    return {
      className: `btn btn-ghost ${name === "MASTER_DATA_EDIT" ? "link-return" : "show-as-dialog-link"} permission-${name}${disabled ? " disabled not-allowed" : ""}`,
      "aria-disabled": disabled || undefined,
    };
  };

  const dialog = (event: MouseEvent<HTMLAnchorElement>, type: "form" | "table" = "form") => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    props.onDialog(event.currentTarget.href, type);
  };

  const product = String(props.productId);

  const selected =
    props.variant === "entries" ? `&locationId=${props.locationId}&stockId=${props.stockId}` : "";

  const codeKind = props.variant === "entries" ? "Stock entry" : "Product";

  return (
    <>
      <button
        ref={button}
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
              className="native-stock-row-menu"
              data-variant={props.variant}
              style={{
                left: position?.left ?? 0,
                top: position?.top ?? 0,
                visibility: position ? undefined : "hidden",
              }}
              onKeyDown={keyboard}
              onClick={(event) => {
                if (event.target instanceof Element && event.target.closest('[role="menuitem"]'))
                  close();
              }}
            >
              {features.enabled("SHOPPINGLIST") ? (
                <>
                  <a
                    role="menuitem"
                    className="btn btn-ghost show-as-dialog-link"
                    href={href(
                      `/shoppinglistitem/new?embedded&updateexistingproduct&list=1&product=${product}`,
                    )}
                    {...permission("SHOPPINGLIST_ITEMS_ADD")}
                    onClick={(event) => dialog(event)}
                  >
                    {t("Add to shopping list")}
                  </a>
                  <hr role="separator" />
                </>
              ) : null}
              <a
                role="menuitem"
                className="btn btn-ghost show-as-dialog-link"
                href={href(`/purchase?embedded&product=${product}`)}
                {...permission("STOCK_PURCHASE")}
                onClick={(event) => dialog(event)}
              >
                {t("Purchase")}
              </a>
              <a
                role="menuitem"
                className="btn btn-ghost show-as-dialog-link"
                href={href(`/consume?embedded&product=${product}${selected}`)}
                {...permission("STOCK_CONSUME")}
                onClick={(event) => dialog(event)}
              >
                {t("Consume")}
              </a>
              {features.enabled("STOCK_LOCATION_TRACKING") ? (
                <a
                  role="menuitem"
                  className="btn btn-ghost show-as-dialog-link"
                  href={href(`/transfer?embedded&product=${product}${selected}`)}
                  {...permission("STOCK_TRANSFER")}
                  onClick={(event) => dialog(event)}
                >
                  {t("Transfer")}
                </a>
              ) : null}
              <a
                role="menuitem"
                className="btn btn-ghost show-as-dialog-link"
                href={href(`/inventory?embedded&product=${product}`)}
                {...permission("STOCK_INVENTORY")}
                onClick={(event) => dialog(event)}
              >
                {t("Inventory")}
              </a>
              {props.variant === "entries" ? (
                <a
                  role="menuitem"
                  className="btn btn-ghost stock-consume-button stock-consume-button-spoiled"
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    props.onSpoiled();
                  }}
                >
                  {t("Consume this stock entry as spoiled")}
                </a>
              ) : null}
              {features.enabled("RECIPES") ? (
                <>
                  <hr role="separator" />
                  <a
                    role="menuitem"
                    className="btn btn-ghost"
                    href={href(`/recipes?search=${props.productName ?? ""}`)}
                  >
                    {t("Search for recipes containing this product")}
                  </a>
                </>
              ) : null}
              <hr role="separator" />
              <a
                role="menuitem"
                className="btn btn-ghost productcard-trigger"
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  props.onOverview();
                }}
              >
                {t("Product overview")}
              </a>
              <a
                role="menuitem"
                className="btn btn-ghost show-as-dialog-link"
                href={href(
                  `/${props.variant === "entries" ? "stockjournal" : "stockentries"}?embedded&product=${product}`,
                )}
                data-dialog-type="table"
                onClick={(event) => dialog(event, "table")}
              >
                {t(props.variant === "entries" ? "Stock journal" : "Stock entries")}
              </a>
              <a
                role="menuitem"
                className="btn btn-ghost show-as-dialog-link"
                href={href(
                  `/stockjournal/summary?embedded&${props.variant === "entries" ? "product" : "product_id"}=${product}`,
                )}
                data-dialog-type="table"
                onClick={(event) => dialog(event, "table")}
              >
                {t("Stock journal summary")}
              </a>
              <a
                role="menuitem"
                className="btn btn-ghost link-return"
                href={href(`/product/${product}?returnto=${encodeURIComponent(props.returnTo)}`)}
                {...permission("MASTER_DATA_EDIT")}
              >
                {t("Edit product")}
              </a>
              <hr role="separator" />
              <a
                role="menuitem"
                className="btn btn-ghost"
                href={href(
                  props.variant === "entries"
                    ? `/stockentry/${props.rowId}/grocycode?download=true`
                    : `/product/${product}/grocycode?download=true`,
                )}
              >
                {t("Download %s Grocycode", t(codeKind))}
              </a>
              {features.enabled("LABEL_PRINTER") ? (
                <a
                  role="menuitem"
                  className="btn btn-ghost"
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    props.onPrint();
                  }}
                >
                  {t("Print %s Grocycode on label printer", t(codeKind))}
                </a>
              ) : null}
              {props.variant === "entries" ? (
                <a
                  role="menuitem"
                  className="btn btn-ghost"
                  href={href(`/stockentry/${props.rowId}/label`)}
                  target="_blank"
                >
                  {t("Open stock entry label in new window")}
                </a>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
