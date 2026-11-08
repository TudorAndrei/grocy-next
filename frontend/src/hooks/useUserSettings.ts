import { useQuery } from "@tanstack/react-query";
import { userSettingsQuery } from "./queries";
import { api } from "@/lib/api";
import { useNativeProductDocument } from "@/lib/native-product-document";
import type { UserSettings } from "@/lib/types";

/** Preserve native document settings while modern consumers keep the live shared query. */
export function useUserSettings(enabled = true) {
  const document = useNativeProductDocument();

  return useQuery<UserSettings>(
    document
      ? {
          queryKey: ["native-product-document", document.scope, "settings"],
          queryFn: () => document.context.user_settings,
          initialData: document.context.user_settings,
          enabled: false,
          gcTime: 0,
        }
      : { queryKey: userSettingsQuery().queryKey, queryFn: api.getUserSettings, enabled },
  );
}
