import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { userSettingsQuery } from "@/hooks/queries";
import { api, queryKeys, request } from "@/lib/api";
import { useFeatures } from "@/lib/features";
import { preferenceEnabled } from "@/lib/preferences";
import { applyTheme, nightModeEnabled } from "@/lib/theme";
import type { UserSettings } from "@/lib/types";
import { automaticBrowserSessionSelected, cookieSessionSelected } from "@/lib/config";
import {
  isNativePreferenceSnapshot,
  nightModePreferenceValues,
  registerNativeNightModeCheck,
  setNativePreferenceCache,
} from "@/lib/native-preference-runtime";

export function NightMode({ authenticated }: { authenticated: boolean }) {
  const client = useQueryClient();
  const settings = useQuery({ ...userSettingsQuery(), enabled: authenticated });
  const mode = String(useFeatures().query.data?.MODE ?? "production");
  const scope = useRef<AbortController>(undefined);
  const nativeRuntime = useRef(false);

  const observed = useRef<{
    authenticated: boolean;
    available: boolean;
    values: (UserSettings[string] | undefined)[];
  }>(undefined);

  const check = useCallback(
    (native: boolean) => {
      const saved = authenticated
        ? client.getQueryData<UserSettings>(queryKeys.userSettings)
        : null;

      if (!saved) {
        applyTheme("system");

        return;
      }

      const enabled = nightModeEnabled(
        saved,
        globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
      );

      // Update the local setting before the request, as the legacy helper does.
      if (enabled !== preferenceEnabled(saved.night_mode_enabled_internal)) {
        if (native) {
          const signal = scope.current?.signal;

          if (!signal || signal.aborted) return;

          setNativePreferenceCache(client, "night_mode_enabled_internal", enabled);
          void request("/api/user/settings/night_mode_enabled_internal", {
            method: "PUT",
            body: JSON.stringify({ value: enabled }),
            signal,
          }).catch((error) => {
            if (!signal.aborted) console.error(error);
          });
        } else {
          client.setQueryData(queryKeys.userSettings, {
            ...saved,
            night_mode_enabled_internal: enabled,
          });
          void api.putUserSettings({ night_mode_enabled_internal: enabled }).catch(() => undefined);
        }
      }

      applyTheme(enabled ? "dark" : "light");
    },
    [authenticated, client],
  );

  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;

    const unregister = registerNativeNightModeCheck(client, () => {
      if (controller.signal.aborted) return;

      nativeRuntime.current = true;
      check(true);
    });

    const interval = window.setInterval(
      () => check(nativeRuntime.current),
      mode === "production" ? 60_000 : 4_000,
    );

    return () => {
      controller.abort();
      unregister();
      window.clearInterval(interval);
    };
  }, [check, client, mode]);

  useEffect(() => {
    const previous = observed.current;
    const available = settings.data !== undefined;
    const values = nightModePreferenceValues(settings.data);

    if (
      previous?.authenticated === authenticated &&
      previous.available === available &&
      values.every((value, index) => Object.is(value, previous.values[index]))
    )
      return;

    observed.current = { authenticated, available, values };

    if (
      authenticated &&
      previous?.authenticated &&
      previous.available &&
      isNativePreferenceSnapshot(client, settings.data)
    ) {
      nativeRuntime.current = true;

      return;
    }

    // Browser bootstrap uses native writes; additional modern Appearance edits stay reactive.
    nativeRuntime.current =
      authenticated &&
      (!previous?.available || previous.authenticated !== authenticated) &&
      (cookieSessionSelected() || automaticBrowserSessionSelected());
    check(nativeRuntime.current);
  }, [authenticated, check, client, settings.data]);

  return null;
}
