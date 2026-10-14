import type { ReactNode } from "react";
import { SiteNav } from "./SiteNav";
import { Wordmark } from "./Wordmark";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="site-rail">
        <Wordmark />
        <SiteNav />
      </aside>
      <main className="site-main">{children}</main>
    </div>
  );
}
