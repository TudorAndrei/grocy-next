import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys, request } from "./api";
import type { UserSettings } from "./types";
import { setNativePreferenceCache } from "./native-preference-runtime";

function sameSetting(first: UserSettings[string] | undefined, second: UserSettings[string]) {
  return first == second;
}

/** Native preference controls assign their page value before independent writes settle. */
export function useNativePreferenceAutosave(initial: UserSettings) {
  const client = useQueryClient();
  const owner = useRef<AbortController>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    owner.current = controller;

    return () => controller.abort();
  }, []);

  return (key: string, value: UserSettings[string], force = false) => {
    const signal = owner.current?.signal;

    if (signal?.aborted) return;

    const current = client.getQueryData<UserSettings>(queryKeys.userSettings) ?? initial;

    if (!force && sameSetting(current[key], value)) return;
    setNativePreferenceCache(client, key, value);
    void request(`/api/user/settings/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
      signal,
    })
      .catch((error) => {
        if (!signal?.aborted) console.error(error);
      })
      .finally(() => {
        for (const queryKey of [
          queryKeys.userSettings,
          ["stock"],
          ["shopping"],
          ["products"],
          ["recipes"],
          ["recipe-overview"],
          ["recipe-view"],
          ...(key.startsWith("calendar_color_")
            ? [["native-calendar"], ["calendar", "events"]]
            : []),
          ...(key === "locale" ? [queryKeys.systemConfig, ["localization"]] : []),
        ])
          void client.invalidateQueries({ queryKey, refetchType: "none" });
      });
  };
}
