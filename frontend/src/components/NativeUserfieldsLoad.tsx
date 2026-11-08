import { useEffect, useRef, type RefObject } from "react";
import { getCustomObjectValues } from "@/lib/custom-object-form";
import { useDocumentTasks } from "@/lib/document-tasks";
import { getNativeCreateUserfields } from "@/lib/native-userfields-create";
import type { UserfieldsEditorHandle } from "./UserfieldsEditor";

/** The native initial Load is independent of subsequent Save and mutable created IDs. */
export function NativeUserfieldsLoad({
  namespace,
  objectId,
  fieldCount,
  editor,
}: {
  namespace: string;
  objectId: number | string | null;
  fieldCount: number;
  editor: RefObject<UserfieldsEditorHandle | null>;
}) {
  const document = useDocumentTasks();
  const initial = useRef({ namespace, objectId, fieldCount, editor, document });

  useEffect(() => {
    const host = initial.current;

    if (host.fieldCount === 0) return;
    const local = new AbortController();
    const task = host.document.capture();
    const signal = AbortSignal.any([local.signal, task.signal]);

    // A fresh local owner on each setup keeps Strict Mode replay usable.
    const initialize = async () => {
      if (host.objectId === null) {
        const definitions = await getNativeCreateUserfields(host.namespace, signal);
        signal.throwIfAborted();
        host.editor.current?.initializeCreate(definitions);
      } else {
        const values = await getCustomObjectValues(host.namespace, host.objectId, signal);
        signal.throwIfAborted();
        host.editor.current?.load(values);
      }
    };

    void initialize().catch((error: Error) => {
      if (!signal.aborted) console.error(error);
    });

    return () => local.abort();
  }, []);

  return null;
}
