import type { ReactNode } from "react";
import { SiteNav } from "./SiteNav";
import { Wordmark } from "./Wordmark";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <Wordmark />
        <SiteNav />
      </header>
      <main id="main-content">{children}</main>
    </div>
  );
}
