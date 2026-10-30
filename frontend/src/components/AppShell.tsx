import { useI18n } from "@/lib/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useFeatures } from "@/lib/features";
import { usePreferences } from "@/lib/preferences";
import { forgetKey } from "@/lib/session";
import { useCommandBar } from "./CommandBar";
import { Icon } from "./Icon";
import { SiteNav, useNavCounts, usePathname } from "./SiteNav";
import { Wordmark } from "./Wordmark";

const HeaderClock = lazy(() =>
  import("./HeaderClock").then(({ HeaderClock }) => ({ default: HeaderClock })),
);

export function AppShell({ children }: { children: ReactNode }) {
  const { t: tr } = useI18n();

  const command = useCommandBar();
  const pathname = usePathname();
  const counts = useNavCounts();
  const features = useFeatures();
  const { showClock } = usePreferences();
  const [menuOpen, setMenuOpen] = useState(false);
  const [previousPath, setPreviousPath] = useState(pathname);
  const queryClient = useQueryClient();

  const embedded = useLocation({
    select: (location) => Object.hasOwn(location.search, "embedded"),
  });

  if (previousPath !== pathname) {
    setPreviousPath(pathname);
    setMenuOpen(false);
  }

  const signOut = async () => {
    // Forget the key even when the server cannot revoke it.
    await api.logout().catch(() => undefined);
    await forgetKey(queryClient);
  };

  if (embedded) return <EmbeddedPage>{children}</EmbeddedPage>;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {tr("Skip to content")}
      </a>
      <aside className="site-rail" data-open={menuOpen ? "true" : "false"}>
        <div className="rail-head">
          <Wordmark />
          <button
            type="button"
            className="rail-close"
            aria-label={tr("Close menu")}
            onClick={() => setMenuOpen(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <button type="button" className="command-trigger" onClick={() => command.open()}>
          <Icon name="search" />
          <span>{tr("Quick actions")}</span>
          <kbd>⌘K</kbd>
        </button>
        <SiteNav onNavigate={() => setMenuOpen(false)} />
        <button type="button" className="btn sign-out" onClick={signOut}>
          {tr("Sign out")}
        </button>
      </aside>
      {menuOpen ? <div className="rail-scrim" onClick={() => setMenuOpen(false)} /> : null}

      <main className="site-main" id="main-content">
        {showClock ? (
          <Suspense fallback={null}>
            <HeaderClock />
          </Suspense>
        ) : null}
        {children}
      </main>

      <nav className="tabbar" aria-label={tr("Quick")}>
        <Link to="/today" aria-current={pathname === "/today" ? "page" : undefined}>
          <Icon name="today" />
          {tr("Today")}
        </Link>
        {features.enabled("STOCK") ? (
          <Link to="/stock" aria-current={pathname.startsWith("/stock") ? "page" : undefined}>
            <Icon name="stock" />
            {tr("Stock")}
          </Link>
        ) : null}
        <button
          type="button"
          className="tabbar-act"
          onClick={() => command.open()}
          aria-label={tr("Quick actions")}
        >
          <Icon name="search" />
        </button>
        {features.enabled("SHOPPINGLIST") ? (
          <Link to="/shopping" aria-current={pathname.startsWith("/shopping") ? "page" : undefined}>
            <Icon name="shopping" />
            {tr("List")}
            {counts.shopping > 0 ? <em data-domain="shopping">{counts.shopping}</em> : null}
          </Link>
        ) : null}
        <button type="button" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen}>
          <Icon name="menu" />
          {tr("More")}
          {counts.review > 0 ? <em data-domain="agent">{counts.review}</em> : null}
        </button>
      </nav>
    </div>
  );
}

function EmbeddedPage({ children }: { children: ReactNode }) {
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const resize = () =>
      window.parent.postMessage(
        { Message: "ResizeResponsiveEmbeds", Payload: null },
        window.location.origin,
      );

    resize();

    if (typeof ResizeObserver === "undefined" || !main.current) return;

    const observer = new ResizeObserver(resize);
    observer.observe(main.current);

    return () => observer.disconnect();
  }, []);

  return (
    <main ref={main} className="embedded-main" id="main-content">
      {children}
    </main>
  );
}
