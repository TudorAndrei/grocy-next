import { useCallback, useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./api";
import type { UserSettings } from "./types";

const nightSettings = [
  "night_mode",
  "night_mode_enabled_internal",
  "auto_night_mode_enabled",
  "auto_night_mode_time_range_from",
  "auto_night_mode_time_range_to",
  "auto_night_mode_time_range_goes_over_midnight",
] as const;

export function nightModePreferenceValues(settings: UserSettings | undefined) {
  return nightSettings.map((key) => settings?.[key]);
}

const nativeSnapshots = new WeakMap<QueryClient, ReturnType<typeof nightModePreferenceValues>>();
const nightChecks = new WeakMap<QueryClient, () => void>();

/** Source controls change page settings without running the night timer. */
export function setNativePreferenceCache(
  client: QueryClient,
  key: string,
  value: UserSettings[string],
) {
  const settings = client.setQueryData<UserSettings>(queryKeys.userSettings, (current) => ({
    ...current,
    [key]: value,
  }));

  if (settings) nativeSnapshots.set(client, nightModePreferenceValues(settings));
}

export function isNativePreferenceSnapshot(
  client: QueryClient,
  settings: UserSettings | undefined,
) {
  const native = nativeSnapshots.get(client);
  const values = nightModePreferenceValues(settings);

  const matches =
    settings !== undefined &&
    native !== undefined &&
    values.every((value, index) => Object.is(value, native[index]));

  // Unrelated spread updates retain origin; actual modern night changes retire it.
  if (!matches) nativeSnapshots.delete(client);

  return matches;
}

/** The global NightMode component remains the sole checker and interval owner. */
export function registerNativeNightModeCheck(client: QueryClient, check: () => void) {
  nightChecks.set(client, check);

  return () => {
    if (nightChecks.get(client) === check) nightChecks.delete(client);
  };
}

export function useNativeNightModeCheck() {
  const client = useQueryClient();
  const active = useRef(true);

  useEffect(() => {
    active.current = true;

    return () => {
      active.current = false;
    };
  }, []);

  return useCallback(() => {
    if (active.current) nightChecks.get(client)?.();
  }, [client]);
}
