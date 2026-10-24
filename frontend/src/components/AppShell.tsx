import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { forgetKey } from "@/lib/session";
import { SiteNav } from "./SiteNav";
import { Wordmark } from "./Wordmark";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const queryClient = useQueryClient();
  const signOut = async () => {
    // Forget the key even when the server cannot revoke it.
    await api.logout().catch(() => undefined);
    await forgetKey(queryClient);
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="site-rail">
        <Wordmark />
        <SiteNav />
        <button type="button" className="btn sign-out" onClick={signOut}>
          Sign out
        </button>
      </aside>
      <main id="main-content" className="site-main">
        {children}
      </main>
    </div>
  );
}
