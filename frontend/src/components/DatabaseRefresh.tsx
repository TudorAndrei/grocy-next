import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { usePreferences } from "@/lib/preferences";

export function DatabaseRefresh() {
  const { autoReload } = usePreferences();
  const client = useQueryClient();

  useEffect(() => {
    if (!autoReload) return;

    const refresh = () => {
      if (document.visibilityState === "visible") {
        void client.refetchQueries({ type: "active" });
      }
    };

    const timer = window.setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [autoReload, client]);

  return null;
}
