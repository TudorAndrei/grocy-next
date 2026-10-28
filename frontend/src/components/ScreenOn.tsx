import { useEffect } from "react";
import NoSleep from "nosleep.js";
import { usePreferences } from "@/lib/preferences";

export function ScreenOn() {
  const { keepScreenOn, keepScreenOnWhenFullscreen } = usePreferences();

  useEffect(() => {
    if (!keepScreenOn && !keepScreenOnWhenFullscreen) return;
    let cancelled = false;
    let pending = false;
    let activated = navigator.userActivation?.hasBeenActive ?? false;
    let lock: WakeLockSentinel | undefined;
    let fallback: NoSleep | undefined;

    const wanted = () =>
      !cancelled &&
      activated &&
      document.visibilityState === "visible" &&
      (keepScreenOn || document.body.classList.contains("fullscreen-card"));

    const release = () => {
      const owned = lock;
      lock = undefined;

      if (owned && !owned.released) void owned.release().catch(() => undefined);
      fallback?.disable();
    };

    const sync = () => {
      if (!wanted()) {
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

    const onClick = () => {
      activated = true;
      sync();
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("click", onClick);
    document.addEventListener("visibilitychange", sync);
    sync();

    return () => {
      cancelled = true;
      observer.disconnect();
      document.removeEventListener("click", onClick);
      document.removeEventListener("visibilitychange", sync);
      release();
    };
  }, [keepScreenOn, keepScreenOnWhenFullscreen]);

  return null;
}
