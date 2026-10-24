import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useCommandBar } from "./CommandBar";
import { Icon } from "./Icon";
import { SiteNav, useNavCounts, usePathname } from "./SiteNav";
import { Wordmark } from "./Wordmark";

export function AppShell({ children }: { children: ReactNode }) {
  const command = useCommandBar();
  const pathname = usePathname();
  const counts = useNavCounts();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <div className="app-shell">
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
      </aside>
      {menuOpen ? <div className="rail-scrim" onClick={() => setMenuOpen(false)} /> : null}

      <main className="site-main" id="main">
        {children}
      </main>

      <nav className="tabbar" aria-label="Quick">
        <Link to="/" aria-current={pathname === "/" ? "page" : undefined}>
          <Icon name="today" />
          Today
        </Link>
        <Link to="/stock" aria-current={pathname.startsWith("/stock") ? "page" : undefined}>
          <Icon name="stock" />
          Stock
        </Link>
        <button
          type="button"
          className="tabbar-act"
          onClick={() => command.open()}
          aria-label="Quick actions"
        >
          <Icon name="search" />
        </button>
        <Link to="/shopping" aria-current={pathname.startsWith("/shopping") ? "page" : undefined}>
          <Icon name="shopping" />
          List
          {counts.shopping > 0 ? <em data-domain="shopping">{counts.shopping}</em> : null}
        </Link>
        <button type="button" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen}>
          <Icon name="menu" />
          More
          {counts.review > 0 ? <em data-domain="agent">{counts.review}</em> : null}
        </button>
      </nav>
    </div>
  );
}
