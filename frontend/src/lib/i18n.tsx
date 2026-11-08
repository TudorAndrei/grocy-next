import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, queryKeys } from "./api";
import { createTranslations, englishTranslations, type Localization } from "./localization";
import { NativePresentationProvider, readNativeDocument } from "./native-document";

type I18nValue = typeof englishTranslations & {
  locale: string;
  direction: string;
  languages: string[];
  ready: boolean;
  localizationError: Error | null;
  retryLocalization: () => void;
};

const I18nContext = createContext<I18nValue>({
  ...englishTranslations,
  locale: "en",
  direction: "ltr",
  languages: new Array<string>(),
  ready: true,
  localizationError: null,
  retryLocalization: () => {},
});

export function useI18n() {
  return useContext(I18nContext);
}

export function LocalizationProvider({
  children,
  nativePage,
  enabled = true,
  publicLocale = false,
  nativePathname = "",
  nativeRawPathname,
  nativeSearch = "",
}: {
  children: ReactNode;
  nativePage?: string;
  enabled?: boolean;
  publicLocale?: boolean;
  nativePathname?: string;
  nativeRawPathname?: string;
  nativeSearch?: string;
}) {
  const client = useQueryClient();

  const configuration = useQuery({
    queryKey: queryKeys.systemConfig,
    queryFn: api.getSystemConfig,
    enabled: enabled && nativePage === undefined && !publicLocale,
  });

  const locale = publicLocale ? undefined : configuration.data?.LOCALE;
  const [attempt, setAttempt] = useState(0);

  const [session, setSession] = useState<{
    page?: string;
    catalog?: Localization;
    error?: Error;
    presentation?: Awaited<ReturnType<typeof readNativeDocument>>["presentation"];
  }>({
    page: nativePage,
  });

  const previousPage = useRef<string>(undefined);
  const [lastCatalog, setLastCatalog] = useState<Localization>();

  if (session.page !== nativePage) setSession({ page: nativePage });

  const prepare = useEffectEvent((signal: AbortSignal) =>
    readNativeDocument(client, signal, {
      pathname: nativePathname,
      rawPathname: nativeRawPathname,
      search: nativeSearch,
    }),
  );

  useEffect(() => {
    const previous = previousPage.current;
    previousPage.current = nativePage;

    if (!enabled) return;

    if (nativePage === undefined) {
      // The existing language-settings exit also refreshes additional modern destinations.
      if (previous?.startsWith("/usersettings:")) {
        void client.refetchQueries({
          queryKey: queryKeys.systemConfig,
          exact: true,
          type: "active",
        });
        void client.refetchQueries({
          queryKey: queryKeys.userSettings,
          exact: true,
          type: "active",
        });
      }

      return;
    }

    const owner = new AbortController();
    void prepare(owner.signal)
      .then((snapshot) => {
        if (owner.signal.aborted) return;
        client.setQueryData(queryKeys.systemConfig, snapshot.config);
        client.setQueryData(queryKeys.userSettings, snapshot.settings);
        client.setQueryData(queryKeys.currentUser, snapshot.user);
        client.setQueryData(["user-permissions"], snapshot.grants);
        client.setQueryData(queryKeys.localization(snapshot.config.LOCALE), snapshot.catalog);
        setLastCatalog(snapshot.catalog);
        setSession({
          page: nativePage,
          catalog: snapshot.catalog,
          presentation: snapshot.presentation,
        });
      })
      .catch((error) => {
        if (owner.signal.aborted) return;

        if (error instanceof ApiError && error.status === 401) {
          void client
            .fetchQuery({
              queryKey: queryKeys.currentUser,
              retry: false,
              staleTime: 0,
              queryFn: async () => {
                throw error;
              },
            })
            .catch(() => {});
        } else
          setSession({
            page: nativePage,
            error: error instanceof Error ? error : new Error(String(error)),
          });
      });

    return () => owner.abort();
  }, [nativePage, enabled, attempt, client]);

  const query = useQuery({
    queryKey: publicLocale ? ["localization", "public-login"] : queryKeys.localization(locale),
    queryFn: () => api.getLocalization(locale),
    enabled: enabled && nativePage === undefined,
    staleTime: publicLocale ? 0 : Infinity,
    retry: false,
    placeholderData: (previous) => (publicLocale ? undefined : previous),
  });

  const current = session.page === nativePage ? session : undefined;

  const data =
    nativePage !== undefined ? (current?.catalog ?? lastCatalog ?? query.data) : query.data;

  const ready =
    enabled &&
    (nativePage !== undefined
      ? current?.catalog !== undefined
      : !query.isPending && !query.isPlaceholderData);

  const localizationError = nativePage !== undefined ? (current?.error ?? null) : query.error;
  const { refetch: retryCatalog } = query;

  const value = useMemo(
    () => ({
      ...(data ? createTranslations(data.catalog) : englishTranslations),
      locale: data?.locale ?? "en",
      direction: data?.direction ?? "ltr",
      languages: data?.languages ?? [],
      ready,
      localizationError,
      retryLocalization: () => {
        if (nativePage !== undefined && !current?.catalog) setAttempt((value) => value + 1);
        else void retryCatalog();
      },
    }),
    [data, ready, localizationError, retryCatalog, nativePage, current?.catalog],
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

  return (
    <I18nContext.Provider value={value}>
      <NativePresentationProvider value={current?.presentation}>
        {children}
      </NativePresentationProvider>
    </I18nContext.Provider>
  );
}
