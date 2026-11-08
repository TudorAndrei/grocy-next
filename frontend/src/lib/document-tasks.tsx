import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useGenericError, type GenericException } from "@/hooks/useGenericError";

type DocumentTask = {
  signal: AbortSignal;
  genericError: (message: string, error?: GenericException) => void;
};

type DocumentTasks = { capture: () => DocumentTask };

type DocumentOwner = {
  token: { identity: string };
  controller: AbortController;
};

const Tasks = createContext<DocumentTasks | undefined>(undefined);

/** Retire one document's jobs without replacing the descendants' React state. */
export function DocumentTasksProvider({
  identity,
  children,
}: {
  identity: string;
  children: ReactNode;
}) {
  const report = useGenericError();
  const token = useMemo(() => ({ identity }), [identity]);
  const current = useRef<DocumentOwner | undefined>(undefined);

  useLayoutEffect(() => {
    // Strict Mode replays setup after cleanup, so each setup needs a fresh signal.
    const owner = { token, controller: new AbortController() };
    current.current = owner;

    return () => {
      owner.controller.abort();

      if (current.current === owner) current.current = undefined;
    };
  }, [token]);

  const capture = useCallback((): DocumentTask => {
    const owner = current.current;

    if (!owner || owner.token !== token || owner.controller.signal.aborted)
      throw new Error("Document task scope is not active");
    const signal = owner.controller.signal;

    return {
      signal,
      genericError: (message, error) => {
        if (!signal.aborted) report(message, error);
      },
    };
  }, [token, report]);

  const value = useMemo(() => ({ capture }), [capture]);

  return <Tasks.Provider value={value}>{children}</Tasks.Provider>;
}

export function useDocumentTasks() {
  const tasks = useContext(Tasks);

  if (!tasks) throw new Error("useDocumentTasks requires DocumentTasksProvider");

  return tasks;
}
