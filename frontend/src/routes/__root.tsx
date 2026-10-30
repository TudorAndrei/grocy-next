import type { ReactNode } from "react";
import { createRootRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { LoadingBlock } from "@/components/LoadingBlock";
import { LoginPage } from "@/components/LoginPage";
import { SetupWizard } from "@/components/SetupWizard";
import { currentUserQuery } from "@/hooks/queries";
import { api, ApiError, queryKeys } from "@/lib/api";
import { CommandProvider } from "@/components/CommandBar";
import { Toaster } from "@/components/Toaster";
import { DatabaseRefresh } from "@/components/DatabaseRefresh";
import { FeatureRoute } from "@/components/FeatureRoute";
import { LocalizationProvider } from "@/lib/i18n";
import { NightMode } from "@/components/NightMode";
import { ScreenOn } from "@/components/ScreenOn";

export const Route = createRootRoute({
  component: () => (
    <LocalizationProvider>
      <RootLayout />
    </LocalizationProvider>
  ),
});

function RootLayout() {
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

  let content: ReactNode;

  if (needsSetup) {
    content = <SetupWizard />;
  } else if (user.error instanceof ApiError && user.error.status === 401) {
    content = <LoginPage />;
  } else if (setup.isPending || (needsSetup === false && user.isPending)) {
    content = (
      <main id="main-content" className="setup-page">
        <LoadingBlock />
      </main>
    );
  } else {
    content = (
      <Toaster>
        <DatabaseRefresh />
        <ScreenOn />
        <CommandProvider>
          <AppShell>
            <FeatureRoute />
          </AppShell>
        </CommandProvider>
      </Toaster>
    );
  }

  return (
    <>
      <NightMode authenticated={needsSetup === false && user.isSuccess} />
      {content}
    </>
  );
}
