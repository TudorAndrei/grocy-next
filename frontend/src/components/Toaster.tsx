import { useI18n } from "@/lib/i18n";
import { createPortal } from "react-dom";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Toast = {
  id: number;
  message: string;
  tone: "ok" | "error";
  undo?: () => Promise<void>;
};

type Notify = (toast: Omit<Toast, "id" | "tone"> & { tone?: Toast["tone"] }) => void;

const ToastContext = createContext<Notify>(() => {});

export function useNotify(): Notify {
  return useContext(ToastContext);
}

const TOAST_MS = 6000;

export function Toaster({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const [host] = useState(() => {
    const element = document.createElement("div");
    element.className = "toasts";
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");

    return element;
  });

  useEffect(() => {
    host.setAttribute("aria-label", t("Notifications"));
  }, [host, t]);

  useEffect(() => {
    const move = () => {
      const target = Array.from(document.querySelectorAll("dialog[open]")).at(-1) ?? document.body;

      if (host.parentElement === target) return;

      const focused =
        host.contains(document.activeElement) && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;

      // Move the same host. Portal identity, timers, and pending Undo state stay intact.
      target.appendChild(host);
      focused?.focus();
    };

    move();
    const observer = new MutationObserver(move);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });

    return () => {
      observer.disconnect();
      host.remove();
    };
  }, [host]);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback<Notify>((toast) => {
    const id = nextId.current++;
    setToasts((all) => [...all.slice(-2), { tone: "ok", ...toast, id }]);
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      {createPortal(
        toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDone={() => dismiss(toast.id)} />
        )),
        host,
      )}
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const { t: tr } = useI18n();

  const [undoing, setUndoing] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const finish = useEffectEvent(onDone);

  useEffect(() => {
    const timer = window.setTimeout(() => finish(), TOAST_MS);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="toast" data-tone={toast.tone}>
      <span>{failed ?? toast.message}</span>
      {toast.undo && !failed ? (
        <button
          type="button"
          className="toast-undo"
          disabled={undoing}
          onClick={async () => {
            setUndoing(true);

            try {
              await toast.undo?.();
              onDone();
            } catch (err) {
              setFailed(err instanceof Error ? err.message : "Undo failed.");
            }
          }}
        >
          {undoing ? tr("Undoing…") : tr("Undo")}
        </button>
      ) : null}
      <button type="button" className="toast-close" aria-label={tr("Dismiss")} onClick={onDone}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}
