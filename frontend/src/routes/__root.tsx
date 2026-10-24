import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { CommandProvider } from "@/components/CommandBar";
import { Toaster } from "@/components/Toaster";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
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
