import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { LoadingBlock } from "@/components/LoadingBlock";
import { LoginPage } from "@/components/LoginPage";
import { SetupWizard } from "@/components/SetupWizard";
import { currentUserQuery } from "@/hooks/queries";
import { api, ApiError, queryKeys } from "@/lib/api";
import { CommandProvider } from "@/components/CommandBar";
import { Toaster } from "@/components/Toaster";

export const Route = createRootRoute({
  component: RootLayout,
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

  if (needsSetup) {
    return <SetupWizard />;
  }

  if (user.error instanceof ApiError && user.error.status === 401) {
    return <LoginPage />;
  }

  if (setup.isPending || (needsSetup === false && user.isPending)) {
    return (
      <main id="main-content" className="setup-page">
        <LoadingBlock />
      </main>
    );
  }

  return (
    <Toaster>
      <CommandProvider>
        <AppShell>
          <Outlet />
        </AppShell>
      </CommandProvider>
    </Toaster>
  );
}
