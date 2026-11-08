import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import {
  createRootRouteWithContext,
  Outlet,
  useLocation,
  useMatches,
  useRouter,
} from "@tanstack/react-router";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { LoadingBlock } from "@/components/LoadingBlock";
import { LoginPage } from "@/components/LoginPage";
import { SetupWizard } from "@/components/SetupWizard";
import { currentUserQuery } from "@/hooks/queries";
import { api, ApiError, queryKeys } from "@/lib/api";
import { CommandProvider } from "@/components/CommandBar";
import { Toaster } from "@/components/Toaster";
import { DocumentTasksProvider } from "@/lib/document-tasks";
import { DatabaseRefresh } from "@/components/DatabaseRefresh";
import { FeatureRoute } from "@/components/FeatureRoute";
import { LocalizationProvider, useI18n } from "@/lib/i18n";
import { isNativePagePath } from "@/lib/features";
import { NativeDocumentReloadProvider } from "@/lib/native-document";
import { ErrorBlock } from "@/components/ErrorBlock";
import { NightMode } from "@/components/NightMode";
import { ScreenOn } from "@/components/ScreenOn";
import { EmbeddedHostMessages } from "@/components/EmbeddedHostMessages";
import { NativePageMetadata } from "@/components/NativePageMetadata";
import { NativeLoginRedirect } from "@/components/NativeLogout";
import { registerGrocyWindow } from "@/lib/embedded-window";
import { startAutomaticApiSession } from "@/lib/config";

export const Route = createRootRouteWithContext<{ queryClient?: QueryClient }>()({
  component: RootProviders,
});

function useRootSession() {
  const setup = useQuery({
    queryKey: queryKeys.setup,
    queryFn: api.setupStatus,
    staleTime: Infinity,
  });

  const needsSetup = setup.data?.needs_setup;

  const user = useQuery({
    ...currentUserQuery(),
    enabled: needsSetup === false,
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
  });

  return { setup, user, needsSetup };
}

function RootProviders() {
  const client = useQueryClient();

  const [activation, setActivation] = useState<{
    client: QueryClient;
    session: ReturnType<typeof startAutomaticApiSession>;
  }>();

  useLayoutEffect(() => {
    const session = startAutomaticApiSession();

    void client.cancelQueries().then(() => {
      if (!session.active()) return;

      // A cached actor from another document cannot bypass identity discovery.
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.setup[0] });
      setActivation({ client, session });
    });

    return session.dispose;
  }, [client]);

  return activation?.client === client && activation.session.active() ? (
    <RootSessionProviders />
  ) : (
    <LoadingBlock />
  );
}

function RootSessionProviders() {
  useEffect(registerGrocyWindow, []);
  const router = useRouter();
  const session = useRootSession();

  const pathname = useLocation({
    select: (location) => location.pathname.replace(/\/+$/, "") || "/",
  });

  // A new URL can precede the committed Outlet. Never let a Login transition
  // temporarily expose the previous protected page after authentication fails.
  const authRoute = useMatches({
    select: (matches) =>
      matches.find((match) => ["/login", "/logout", "/signin", "/signout"].includes(match.routeId))
        ?.routeId,
  });

  const isAuthRoute = authRoute !== undefined;
  const rawSearch = useLocation({ select: () => router.history.location.search });
  const rawPathname = useLocation({ select: () => router.history.location.pathname });
  const [revision, setRevision] = useState(0);
  const [presentedAuthRoute, setPresentedAuthRoute] = useState<string>();
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const authenticated = session.needsSetup === false && session.user.isSuccess;

  const nativePage =
    authenticated && !isAuthRoute && isNativePagePath(pathname)
      ? `${pathname}:${revision}`
      : undefined;

  const localizationEnabled =
    !session.setup.isPending && (session.needsSetup !== false || !session.user.isPending);

  if (authRoute === undefined && presentedAuthRoute !== undefined) setPresentedAuthRoute(undefined);
  else if (
    authRoute !== undefined &&
    localizationEnabled &&
    session.needsSetup === false &&
    presentedAuthRoute !== authRoute
  )
    setPresentedAuthRoute(authRoute);

  // Sign out resets these queries itself. Keep an already presented auth
  // outlet alive through that refresh so its one action cannot restart.
  const keepAuthRoute = authRoute !== undefined && presentedAuthRoute === authRoute;

  if (!localizationEnabled && !keepAuthRoute) return <LoadingBlock />;

  if (
    !keepAuthRoute &&
    session.user.isError &&
    !(session.user.error instanceof ApiError && session.user.error.status === 401)
  ) {
    return (
      <main id="main-content" className="setup-page">
        <ErrorBlock message={session.user.error.message} />
      </main>
    );
  }

  return (
    <NativeDocumentReloadProvider
      reload={reload}
      page={nativePage}
      pathname={nativePage ? pathname : undefined}
    >
      <LocalizationProvider
        nativePage={nativePage}
        enabled={localizationEnabled}
        publicLocale={pathname === "/login"}
        nativePathname={pathname}
        nativeRawPathname={rawPathname}
        nativeSearch={rawSearch}
      >
        <RootLayout
          session={session}
          isAuthRoute={isAuthRoute}
          nativePage={nativePage !== undefined}
          nativeRoute={isNativePagePath(pathname)}
          documentKey={nativePage}
          pagePath={pathname}
          standaloneApi={pathname === "/api"}
        />
      </LocalizationProvider>
    </NativeDocumentReloadProvider>
  );
}

function RootLayout({
  session,
  isAuthRoute,
  nativePage,
  nativeRoute,
  documentKey,
  pagePath,
  standaloneApi,
}: {
  session: ReturnType<typeof useRootSession>;
  isAuthRoute: boolean;
  nativePage: boolean;
  nativeRoute: boolean;
  documentKey?: string;
  pagePath: string;
  standaloneApi: boolean;
}) {
  const { setup, user, needsSetup } = session;
  const { ready, localizationError, retryLocalization, t } = useI18n();
  let content: ReactNode;

  if (needsSetup) {
    content = <SetupWizard />;
  } else if (isAuthRoute) {
    content = <Outlet />;
  } else if (user.error instanceof ApiError && user.error.status === 401) {
    content = nativeRoute ? <NativeLoginRedirect /> : <LoginPage />;
  } else if (setup.isPending || (needsSetup === false && user.isPending)) {
    content = (
      <main id="main-content" className="setup-page">
        <LoadingBlock />
      </main>
    );
  } else if (nativePage && !ready) {
    content = (
      <main id="main-content" className="setup-page">
        {localizationError ? (
          <>
            <ErrorBlock message={localizationError.message} />
            <button type="button" className="btn" onClick={retryLocalization}>
              {t("Retry")}
            </button>
          </>
        ) : (
          <LoadingBlock />
        )}
      </main>
    );
  } else {
    content = (
      <Toaster key={documentKey ?? "modern"}>
        <DocumentTasksProvider identity={documentKey ?? `modern:${pagePath}`}>
          <NativePageMetadata />
          <EmbeddedHostMessages />
          {!standaloneApi ? <DatabaseRefresh native={nativePage} /> : null}
          <ScreenOn />
          <CommandProvider>
            {standaloneApi ? (
              <main id="main-content" className="native-api-main">
                <FeatureRoute />
              </main>
            ) : (
              <AppShell>
                <FeatureRoute />
              </AppShell>
            )}
          </CommandProvider>
        </DocumentTasksProvider>
      </Toaster>
    );
  }

  return (
    <>
      <NightMode authenticated={needsSetup === false && user.isSuccess && (!nativePage || ready)} />
      {content}
    </>
  );
}
