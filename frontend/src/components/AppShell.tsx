import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useFeatures } from "@/lib/features";
import { forgetKey } from "@/lib/session";
import { useCommandBar } from "./CommandBar";
import { Icon } from "./Icon";
import { SiteNav, useNavCounts, usePathname } from "./SiteNav";
import { Wordmark } from "./Wordmark";

export function AppShell({ children }: { children: ReactNode }) {
  const command = useCommandBar();
  const pathname = usePathname();
  const counts = useNavCounts();
  const features = useFeatures();
  const [menuOpen, setMenuOpen] = useState(false);
  const [previousPath, setPreviousPath] = useState(pathname);
  const queryClient = useQueryClient();

  if (previousPath !== pathname) {
    setPreviousPath(pathname);
    setMenuOpen(false);
  }

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
      <aside className="site-rail" data-open={menuOpen ? "true" : "false"}>
        <div className="rail-head">
          <Wordmark />
          <button
            type="button"
            className="rail-close"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <button type="button" className="command-trigger" onClick={() => command.open()}>
          <Icon name="search" />
          <span>Quick actions</span>
          <kbd>⌘K</kbd>
        </button>
        <SiteNav onNavigate={() => setMenuOpen(false)} />
        <button type="button" className="btn sign-out" onClick={signOut}>
          Sign out
        </button>
      </aside>
      {menuOpen ? <div className="rail-scrim" onClick={() => setMenuOpen(false)} /> : null}

      <main className="site-main" id="main-content">
        {children}
      </main>

      <nav className="tabbar" aria-label="Quick">
        <Link to="/today" aria-current={pathname === "/today" ? "page" : undefined}>
          <Icon name="today" />
          Today
        </Link>
        {features.enabled("STOCK") ? (
          <Link to="/stock" aria-current={pathname.startsWith("/stock") ? "page" : undefined}>
            <Icon name="stock" />
            Stock
          </Link>
        ) : null}
        <button
          type="button"
          className="tabbar-act"
          onClick={() => command.open()}
          aria-label="Quick actions"
        >
          <Icon name="search" />
        </button>
        {features.enabled("SHOPPINGLIST") ? (
          <Link to="/shopping" aria-current={pathname.startsWith("/shopping") ? "page" : undefined}>
            <Icon name="shopping" />
            List
            {counts.shopping > 0 ? <em data-domain="shopping">{counts.shopping}</em> : null}
          </Link>
        ) : null}
        <button type="button" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen}>
          <Icon name="menu" />
          More
          {counts.review > 0 ? <em data-domain="agent">{counts.review}</em> : null}
        </button>
      </nav>
    </div>
  );
}
