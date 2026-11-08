import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { currentUserQuery } from "@/hooks/queries";
import { useI18n } from "@/lib/i18n";
import type { JsonObject } from "@/lib/json";
import {
  nativeAccountExternal,
  nativeAccountPictureUrl,
  nativeAccountUserUrl,
  nativeLogoutUrl,
} from "@/lib/native-auth";
import { Icon } from "./Icon";

export function NativeAccountMenu({ config }: { config: JsonObject }) {
  const { t } = useI18n();
  const user = useQuery({ ...currentUserQuery(), enabled: false }).data;
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const keyboard = useRef<"first" | "last" | undefined>(undefined);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    // The rail scrolls on shorter screens; keep the expanded links in view.
    root.current?.scrollIntoView?.({ block: "nearest" });

    const links = root.current?.querySelectorAll<HTMLAnchorElement>("a[href]");

    if (keyboard.current === "first") links?.[0]?.focus();
    else if (keyboard.current === "last") links?.[links.length - 1]?.focus();
    keyboard.current = undefined;

    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };

    const tabAway = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Tab" && !root.current?.contains(document.activeElement)) setOpen(false);
    };

    document.addEventListener("pointerdown", outside);
    document.addEventListener("keyup", tabAway);

    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keyup", tabAway);
    };
  }, [open]);

  if (!user) return null;

  const keydown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();

      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    if (!open) {
      keyboard.current = event.key === "ArrowUp" || event.key === "End" ? "last" : "first";
      setOpen(true);

      return;
    }

    const links = Array.from(root.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? []);
    const selected = links.findIndex((link) => link === document.activeElement);

    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? links.length - 1
          : selected < 0
            ? event.key === "ArrowUp"
              ? links.length - 1
              : 0
            : (selected + (event.key === "ArrowUp" ? -1 : 1) + links.length) % links.length;

    links[next]?.focus();
  };

  const picture = user.picture_file_name;
  const hasPicture = picture !== undefined && picture !== null && picture !== "" && picture !== "0";

  return (
    <div className="native-account" ref={root} onKeyDown={keydown}>
      <button
        ref={trigger}
        type="button"
        className="native-account-trigger"
        aria-label={`${t("User")}: ${user.username}`}
        title={`${t("User")}: ${user.username}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {hasPicture ? (
          <img
            src={nativeAccountPictureUrl(picture, config, window.location.origin)}
            alt=""
            loading="lazy"
          />
        ) : (
          <Icon name="user" />
        )}
        <span>{user.username}</span>
        <Icon name={open ? "up" : "down"} />
      </button>
      {open ? (
        <div id={id} className="native-account-links" onClick={() => setOpen(false)}>
          <a href={nativeLogoutUrl(config, window.location.origin)}>{t("Logout")}</a>
          <a href={nativeAccountUserUrl(user.id, config, window.location.origin)}>
            {t(nativeAccountExternal(config) ? "Edit user" : "Change password")}
          </a>
        </div>
      ) : null}
    </div>
  );
}
