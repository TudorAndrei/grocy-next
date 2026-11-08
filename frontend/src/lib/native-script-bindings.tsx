import { createContext, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { nativeClearFileValue } from "./native-userfields-clear";

type Bindings = {
  clearDate: () => void;
  fileValue: () => string;
};

type Publication = { owner: symbol; original: PropertyDescriptor | undefined };

// A physical native document owns its accidental global until document replacement.
let publication: Publication | undefined;

function restore(descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(globalThis, "value", descriptor);
  else Reflect.deleteProperty(globalThis, "value");
}

const Context = createContext<Bindings | null>(null);

/** Keep native date/file callbacks in their physical or logical child document. */
export function NativeScriptBindingsProvider({
  physical,
  children,
}: {
  physical: boolean;
  children: ReactNode;
}) {
  const state = useRef<{ owner: symbol; localPublished: boolean }>(undefined);

  const scope = useMemo(() => {
    const owner = Symbol("native-date-value");

    const bindings: Bindings = {
      clearDate: () => {
        const current = state.current;

        if (current?.owner !== owner) return;

        if (physical) {
          if (publication?.owner !== owner)
            publication = { owner, original: Object.getOwnPropertyDescriptor(globalThis, "value") };
          // The pinned sloppy-mode Clear assigns value = "", including when absent.
          Reflect.set(globalThis, "value", "");
        } else current.localPublished = true;
      },
      fileValue: () => {
        if (physical) return String(nativeClearFileValue());

        if (state.current?.owner === owner && state.current.localPublished) return "";

        if (!publication) return String(nativeClearFileValue());
        // An inline child's unbound lookup cannot inherit its parent's date publication.
        const current = Object.getOwnPropertyDescriptor(globalThis, "value");

        try {
          restore(publication.original);

          return String(nativeClearFileValue());
        } finally {
          restore(current);
        }
      },
    };

    return {
      bindings,
      activate: () => {
        state.current = { owner, localPublished: false };
      },
      retire: () => {
        if (state.current?.owner === owner) state.current = undefined;

        if (publication?.owner === owner) {
          restore(publication.original);
          publication = undefined;
        }
      },
    };
  }, [physical]);

  useLayoutEffect(() => {
    scope.activate();

    return scope.retire;
  }, [scope]);

  return <Context.Provider value={scope.bindings}>{children}</Context.Provider>;
}

export function useNativeScriptBindings() {
  return useContext(Context);
}
