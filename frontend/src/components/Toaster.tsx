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
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

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
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDone={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
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
          {undoing ? "Undoing…" : "Undo"}
        </button>
      ) : null}
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={onDone}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}
