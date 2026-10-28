import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "./api";
import { useFeatures } from "./features";
import { createTranslations, englishTranslations } from "./localization";

const I18nContext = createContext({
  ...englishTranslations,
  locale: "en",
  direction: "ltr",
  languages: new Array<string>(),
});

export function useI18n() {
  return useContext(I18nContext);
}

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const config = useFeatures().query.data;
  const locale = config?.LOCALE;

  const query = useQuery({
    queryKey: queryKeys.localization(locale),
    queryFn: () => api.getLocalization(locale),
    staleTime: Infinity,
    retry: false,
    placeholderData: (previous) => previous,
  });

  const data = query.data;

  const value = useMemo(
    () => ({
      ...(data ? createTranslations(data.catalog) : englishTranslations),
      locale: data?.locale ?? "en",
      direction: data?.direction ?? "ltr",
      languages: data?.languages ?? [],
    }),
    [data],
  );

  useEffect(() => {
    const html = document.documentElement;
    const previousLanguage = html.lang;
    const previousDirection = html.dir;
    html.lang = value.locale.replaceAll("_", "-");
    html.dir = value.direction;

    return () => {
      html.lang = previousLanguage;
      html.dir = previousDirection;
    };
  }, [value.locale, value.direction]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
