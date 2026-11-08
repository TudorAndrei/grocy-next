import { useEffect, useRef } from "react";
import { useFeatures } from "@/lib/features";
import { printNativeLabel } from "@/lib/printing";
import { useGenericError } from "./useGenericError";

/** Native row print actions stay independent of other actions in their document. */
export function useNativeLabelPrint(): (path: string) => void {
  const features = useFeatures();
  const genericError = useGenericError();
  const owner = useRef<AbortController>(undefined);

  useEffect(() => {
    const scope = new AbortController();
    owner.current = scope;

    return () => scope.abort();
  }, []);

  return (path) => {
    const signal = owner.current?.signal;

    if (!signal || signal.aborted) return;

    void printNativeLabel(
      path,
      features.query.data ?? {},
      () => genericError("Error while executing WebHook"),
      signal,
    );
  };
}
