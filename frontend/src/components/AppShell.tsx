import type { ReactNode } from "react";
import { SiteNav } from "./SiteNav";
import { Wordmark } from "./Wordmark";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="site-header">
        <Wordmark />
        <SiteNav />
      </header>
      <main>{children}</main>
    </div>
  );
}
