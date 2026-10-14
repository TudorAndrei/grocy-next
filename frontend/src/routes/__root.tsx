import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
