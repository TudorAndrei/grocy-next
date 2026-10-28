import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useI18n } from "@/lib/i18n";
import { Icon } from "./Icon";

const FullscreenContext = createContext({ expanded: false, toggle: () => {} });

export function FullscreenToggle() {
  const { expanded, toggle } = useContext(FullscreenContext);
  const { t } = useI18n();

  return (
    <button type="button" className="btn btn-ghost" aria-pressed={expanded} onClick={toggle}>
      <Icon name={expanded ? "close" : "expand"} />
      {t(expanded ? "Leave fullscreen" : "Expand to fullscreen")}
    </button>
  );
}

export function FullscreenCard({
  label,
  children,
  hash = false,
}: {
  label: string;
  children: ReactNode;
  hash?: boolean;
}) {
  const [expanded, setExpanded] = useState(() => hash && window.location.hash === "#fullscreen");
  const root = useRef<HTMLElement>(null);

  const change = useCallback(
    (value: boolean) => {
      setExpanded(value);

      if (hash) {
        if (value) {
          window.location.hash = "fullscreen";

          return;
        }

        const url = new URL(window.location.href);
        url.hash = "";
        window.history.replaceState(window.history.state, "", url);
      }
    },
    [hash],
  );

  useEffect(() => {
    if (!hash) return;
    const onHashChange = () => setExpanded(window.location.hash === "#fullscreen");
    window.addEventListener("hashchange", onHashChange);

    return () => window.removeEventListener("hashchange", onHashChange);
  }, [hash]);

  useEffect(() => {
    const card = root.current;

    if (!expanded || !card) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const hidden: Array<{ element: HTMLElement; inert: boolean }> = [];
    let branch: HTMLElement = card;

    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling instanceof HTMLElement && sibling !== branch) {
          hidden.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }

      branch = branch.parentElement;

      if (branch === document.body) break;
    }

    document.body.style.overflow = "hidden";
    document.body.classList.add("fullscreen-card");
    card.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        change(false);

        return;
      }

      if (event.key !== "Tab") return;

      const controls = [
        ...card!.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, iframe, object, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => !element.closest("[hidden], [inert]"));

      const first = controls[0];
      const last = controls.at(-1);

      if (!first || !last) {
        event.preventDefault();
        card!.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === card)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === card)
      ) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      document.body.classList.remove("fullscreen-card");

      for (const { element, inert } of hidden) element.inert = inert;

      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [expanded, change]);

  return (
    <FullscreenContext.Provider value={{ expanded, toggle: () => change(!expanded) }}>
      <section
        ref={root}
        className="fullscreen-surface"
        data-expanded={expanded || undefined}
        aria-label={label}
        role={expanded ? "dialog" : undefined}
        aria-modal={expanded || undefined}
        tabIndex={expanded ? -1 : undefined}
      >
        {children}
      </section>
    </FullscreenContext.Provider>
  );
}
