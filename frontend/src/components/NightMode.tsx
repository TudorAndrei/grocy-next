import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { userSettingsQuery } from "@/hooks/queries";
import { api, queryKeys } from "@/lib/api";
import { useFeatures } from "@/lib/features";
import { preferenceEnabled } from "@/lib/preferences";
import { applyTheme, nightModeEnabled } from "@/lib/theme";
import type { UserSettings } from "@/lib/types";

export function NightMode({ authenticated }: { authenticated: boolean }) {
  const client = useQueryClient();
  const settings = useQuery({ ...userSettingsQuery(), enabled: authenticated });
  const mode = String(useFeatures().query.data?.MODE ?? "production");

  useEffect(() => {
    function check() {
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

      applyTheme(enabled ? "dark" : "light");

      if (enabled === preferenceEnabled(saved.night_mode_enabled_internal)) return;

      // Update the local setting before the request, as the legacy helper does.
      client.setQueryData(queryKeys.userSettings, {
        ...saved,
        night_mode_enabled_internal: enabled,
      });
      void api.putUserSettings({ night_mode_enabled_internal: enabled }).catch(() => undefined);
    }

    check();
    const interval = window.setInterval(check, mode === "production" ? 60_000 : 4_000);

    return () => window.clearInterval(interval);
  }, [authenticated, client, settings.data, mode]);

  return null;
}
