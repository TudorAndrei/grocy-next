import { useI18n } from "@/lib/i18n";
import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { isNativePagePath, useFeatures } from "@/lib/features";
import { usePreferences } from "@/lib/preferences";
import { automaticBrowserSessionSelected, cookieSessionSelected } from "@/lib/config";
import { nativeAccountVisible } from "@/lib/native-auth";
import { nativeQueryFlag, nativeQueryParameterPresent } from "@/lib/native-query-flag";
import { isMasterDataPath, readSidebarCollapsed, writeSidebarCollapsed } from "@/lib/sidebar";
import { useCommandBar } from "./CommandBar";
import { Icon } from "./Icon";
import { SiteNav, useNavCounts, usePathname } from "./SiteNav";
import { Wordmark } from "./Wordmark";
import { NativeAccountMenu } from "./NativeAccountMenu";
import { NativeViewSettings } from "./NativeViewSettings";

const HeaderClock = lazy(() =>
  import("./HeaderClock").then(({ HeaderClock }) => ({ default: HeaderClock })),
);

export function AppShell({ children }: { children: ReactNode }) {
  const { t: tr } = useI18n();

  const command = useCommandBar();
  const router = useRouter();
  const pathname = usePathname();
  const counts = useNavCounts();
  const features = useFeatures();
  const { showClock } = usePreferences();
  const [menuOpen, setMenuOpen] = useState(false);
  const [previousPath, setPreviousPath] = useState(pathname);

  const rawSearch = useLocation({ select: () => router.history.location.search });
  // Native layout is rendered once per document; replaceState only changes the URI.
  const [initialSearch] = useState(rawSearch);
  const shellSearch = isNativePagePath(pathname) ? initialSearch : rawSearch;
  const embedded = nativeQueryParameterPresent(shellSearch, "embedded");
  const browserSession = cookieSessionSelected() || automaticBrowserSessionSelected();
  const [compact, setCompact] = useState(() => !embedded && readSidebarCollapsed());
  const [masterOpen, setMasterOpen] = useState(() => !compact && isMasterDataPath(pathname));
  const initialCompact = useRef(compact);
  const restored = useRef(false);

  useEffect(() => {
    if (embedded) return;

    document.body.classList.toggle("sidenav-toggled", compact);

    return () => document.body.classList.remove("sidenav-toggled");
  }, [compact, embedded]);

  useEffect(() => {
    if (embedded || restored.current) return;
    restored.current = true;

    // The source restores collapsed state through its real toggle once per document.
    if (initialCompact.current) writeSidebarCollapsed(true);
  }, [embedded]);

  const toggleSidebar = () => {
    const collapsed = !compact;
    writeSidebarCollapsed(collapsed);
    setCompact(collapsed);
    setMasterOpen(false);
  };

  const toggleMaster = () => {
    // Persist expansion before the disclosure changes, including a closing click.
    writeSidebarCollapsed(false);
    setCompact(false);
    setMasterOpen((value) => !value);
  };

  if (previousPath !== pathname) {
    setPreviousPath(pathname);
    setMenuOpen(false);
  }

  if (embedded) return <EmbeddedPage search={shellSearch}>{children}</EmbeddedPage>;

  return (
    <div className="app-shell" data-compact={compact ? "true" : "false"}>
      <a className="skip-link" href="#main-content">
        {tr("Skip to content")}
      </a>
      <aside className="site-rail" data-open={menuOpen ? "true" : "false"}>
        <div className="rail-head">
          <Wordmark />
          <button
            type="button"
            className="rail-toggle"
            aria-label={tr(compact ? "Expand sidebar" : "Collapse sidebar")}
            title={tr(compact ? "Expand sidebar" : "Collapse sidebar")}
            aria-expanded={!compact}
            onClick={toggleSidebar}
          >
            <Icon name={compact ? "sidebar-expand" : "sidebar-collapse"} />
          </button>
          <button
            type="button"
            className="rail-close"
            aria-label={tr("Close menu")}
            onClick={() => setMenuOpen(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <button
          type="button"
          className="command-trigger"
          aria-label={tr("Quick actions")}
          title={tr("Quick actions")}
          onClick={() => command.open()}
        >
          <Icon name="search" />
          <span>{tr("Quick actions")}</span>
          <kbd>⌘K</kbd>
        </button>
        <SiteNav
          masterOpen={masterOpen}
          onMasterToggle={toggleMaster}
          onNavigate={() => setMenuOpen(false)}
        />
        {browserSession ? (
          features.query.data && nativeAccountVisible(features.query.data) ? (
            <NativeAccountMenu config={features.query.data} />
          ) : null
        ) : (
          <Link
            className="btn sign-out"
            to="/signout"
            aria-label={tr("Sign out")}
            title={tr("Sign out")}
          >
            <Icon name="logout" />
            <span className="sign-out-label">{tr("Sign out")}</span>
          </Link>
        )}
        <NativeViewSettings />
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

function embeddedDismissal(search: string) {
  try {
    return { close: nativeQueryFlag(search, "embedded"), keyboard: true };
  } catch {
    return { close: false, keyboard: false };
  }
}

function EmbeddedPage({ children, search }: { children: ReactNode; search: string }) {
  const { t } = useI18n();
  const main = useRef<HTMLElement>(null);
  const controls = embeddedDismissal(search);

  const dismiss = () =>
    window.parent.postMessage({ Message: "CloseLastModal", Payload: null }, window.location.origin);

  useEffect(() => {
    if (!controls.keyboard) return;

    const keydown = (event: KeyboardEvent) => {
      // React dialogs in this document own their own Escape cancellation.
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector("dialog[open]")
      )
        window.parent.postMessage(
          { Message: "CloseLastModal", Payload: null },
          window.location.origin,
        );
    };

    document.body.addEventListener("keydown", keydown);

    return () => document.body.removeEventListener("keydown", keydown);
  }, [controls.keyboard]);

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
    <>
      <main ref={main} className="embedded-main" id="main-content">
        {children}
      </main>
      {controls.close ? (
        <button
          type="button"
          className="btn embedded-close"
          aria-label={t("Close")}
          onClick={dismiss}
        >
          <Icon name="close" />
        </button>
      ) : null}
    </>
  );
}
