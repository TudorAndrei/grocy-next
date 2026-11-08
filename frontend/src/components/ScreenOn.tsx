import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import NoSleep from "nosleep.js";
import { preferenceEnabled, usePreferences } from "@/lib/preferences";
import { queryKeys } from "@/lib/api";
import type { UserSettings } from "@/lib/types";

export function ScreenOn() {
  const { keepScreenOn, keepScreenOnWhenFullscreen } = usePreferences();
  const client = useQueryClient();
  const syncCurrent = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let pending = false;
    let activated = navigator.userActivation?.hasBeenActive ?? false;
    let lock: WakeLockSentinel | undefined;
    let fallback: NoSleep | undefined;

    const wanted = (always?: boolean) => {
      const settings = client.getQueryData<UserSettings>(queryKeys.userSettings);

      return (
        !cancelled &&
        activated &&
        document.visibilityState === "visible" &&
        ((always ?? preferenceEnabled(settings?.keep_screen_on)) ||
          (preferenceEnabled(settings?.keep_screen_on_when_fullscreen_card) &&
            document.body.classList.contains("fullscreen-card")))
      );
    };

    const release = () => {
      const owned = lock;
      lock = undefined;

      if (owned && !owned.released) void owned.release().catch(() => undefined);
      fallback?.disable();
    };

    const sync = (always?: boolean) => {
      if (!wanted(always)) {
        release();

        return;
      }

      if (pending || (lock && !lock.released) || fallback?.isEnabled) return;
      pending = true;

      if ("wakeLock" in navigator) {
        void navigator.wakeLock
          .request("screen")
          .then((acquired) => {
            // A request can finish after the user closes the card or signs out.
            if (!wanted()) return acquired.release();
            lock = acquired;
          })
          .catch(() => undefined)
          .finally(() => {
            pending = false;
          });
      } else {
        fallback ??= new NoSleep();
        void fallback
          .enable()
          .then(() => {
            if (!wanted()) fallback?.disable();
          })
          .catch(() => undefined)
          .finally(() => {
            pending = false;
          });
      }
    };

    const onClick = (event: MouseEvent) => {
      activated = true;
      const target = event.target;

      const always =
        target instanceof HTMLInputElement &&
        target.type === "checkbox" &&
        target.dataset.settingKey === "keep_screen_on"
          ? target.checked
          : undefined;

      sync(always);
    };

    const refresh = () => sync();
    syncCurrent.current = refresh;
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", refresh);
    sync();

    return () => {
      cancelled = true;
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", refresh);

      if (syncCurrent.current === refresh) syncCurrent.current = undefined;

      release();
    };
  }, [client]);

  useEffect(() => {
    syncCurrent.current?.();
  }, [keepScreenOn, keepScreenOnWhenFullscreen]);

  return null;
}
