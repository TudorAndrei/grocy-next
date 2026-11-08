import { useEffect, useRef, useState } from "react";

/** Each opening owns its completion callbacks, including callbacks awaiting reads. */
export function useDialogState<T>() {
  const [state, setState] = useState<{ id: number; value: T }>();
  const nextId = useRef(0);
  const current = useRef<number>(undefined);

  useEffect(
    () => () => {
      current.current = undefined;
    },
    [],
  );

  return {
    state,
    open: (value: T) => {
      const id = ++nextId.current;
      current.current = id;
      setState({ id, value });
    },
    close: (id: number) => {
      if (current.current !== id) return;
      current.current = undefined;
      setState(undefined);
    },
    isCurrent: (id: number) => current.current === id,
  };
}
