import { useI18n } from "@/lib/i18n";
import { createPortal } from "react-dom";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useId,
  useState,
  type ReactNode,
} from "react";
import { useModalDialog } from "@/hooks/useModalDialog";

type Toast = {
  id: number;
  message: string;
  content?: ReactNode;
  tone: "ok" | "error" | "warning" | "info";
  undo?: () => Promise<void | false>;
  details?: string;
};

type Notify = (toast: Omit<Toast, "id" | "tone"> & { tone?: Toast["tone"] }) => void;

const ToastContext = createContext<Notify>(() => {});

export function useNotify(): Notify {
  return useContext(ToastContext);
}

const TOAST_MS = 20000;

export function Toaster({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [details, setDetails] = useState<Array<{ id: number; value: string }>>([]);
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
          <ToastItem
            key={toast.id}
            toast={toast}
            onDone={() => dismiss(toast.id)}
            onDetails={() => {
              const value = toast.details;

              if (value === undefined) return;
              setDetails((current) => [...current, { id: toast.id, value }]);
              dismiss(toast.id);
            }}
          />
        )),
        host,
      )}
      {createPortal(
        details.map((detail) => (
          <ErrorDetailsDialog
            key={detail.id}
            value={detail.value}
            onClose={() => setDetails((current) => current.filter((item) => item.id !== detail.id))}
          />
        )),
        document.body,
      )}
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDone,
  onDetails,
}: {
  toast: Toast;
  onDone: () => void;
  onDetails: () => void;
}) {
  const { t: tr } = useI18n();

  const [undoing, setUndoing] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const finish = useEffectEvent(onDone);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [timeout, setTimeoutMs] = useState(TOAST_MS);

  useEffect(() => {
    if (hovered || focused) return;
    const timer = window.setTimeout(() => finish(), timeout);

    return () => window.clearTimeout(timer);
  }, [hovered, focused, timeout]);

  return (
    <div
      className="toast"
      data-tone={toast.tone}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setTimeoutMs(5000);
      }}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setFocused(false);
        setTimeoutMs(5000);
      }}
    >
      {toast.details !== undefined ? (
        <button type="button" className="toast-details" onClick={onDetails}>
          <span>{toast.message}</span>
          <span>{tr("Click to show technical details")}</span>
        </button>
      ) : (
        <span>{failed ?? toast.content ?? toast.message}</span>
      )}
      {toast.undo && !failed ? (
        <button
          type="button"
          className="toast-undo"
          disabled={undoing}
          onClick={async () => {
            setUndoing(true);

            try {
              const result = await toast.undo?.();

              if (result === false) setUndoing(false);
              else onDone();
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

function ErrorDetailsDialog({ value, onClose }: { value: string; onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const title = useId();
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ok.current?.focus();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog wider"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <h2 id={title}>{t("Error details")}</h2>
      <p className="error-details-text">{value}</p>
      <div className="actions">
        <button ref={ok} type="button" className="btn btn-primary" onClick={onClose}>
          {t("OK")}
        </button>
      </div>
    </dialog>
  );
}
