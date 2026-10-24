import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { SetupWizard } from "@/components/SetupWizard";
import { api, queryKeys } from "@/lib/api";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const setup = useQuery({
    queryKey: queryKeys.setup,
    queryFn: api.setupStatus,
    staleTime: Infinity,
  });
  if (setup.data?.needs_setup) {
    return <SetupWizard />;
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
