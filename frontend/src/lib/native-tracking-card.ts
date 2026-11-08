import { useCallback, useEffect, useId, useRef } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, request } from "./api";
import { useDocumentTasks } from "./document-tasks";
import {
  decodeTrackingDetails,
  type TrackingDetails,
  type TrackingKind,
} from "./household-tracking";
import type { JsonValue } from "./json";

/** Native Card callbacks share one display, independent of the current selection. */
export function useNativeTrackingCard(kind: TrackingKind) {
  const client = useQueryClient();
  const documentTasks = useDocumentTasks();
  const local = useRef<AbortController>(undefined);
  const id = useId();
  const queryKey = ["tracking-card", kind, "document", id];

  const { data: card, dataUpdatedAt: refreshedAt } = useQuery<TrackingDetails>({
    queryKey,
    queryFn: skipToken,
    enabled: false,
  });

  useEffect(() => {
    const owner = new AbortController();
    local.current = owner;

    return () => {
      owner.abort();

      if (local.current === owner) local.current = undefined;
    };
  }, []);

  const refresh = useCallback(
    (rawId: string) => {
      const owner = local.current;

      if (!owner || owner.signal.aborted) return;
      const task = documentTasks.capture();
      const signal = AbortSignal.any([owner.signal, task.signal]);

      // A direct request preserves repeated IDs, empty paths and reverse replies.
      void request<JsonValue>(`/api/${kind === "chore" ? "chores" : "batteries"}/${rawId}`, {
        signal,
      }).then(
        (response) => {
          if (signal.aborted) return;

          // Native XHR success callback failures reach the browser error channel.
          window.queueMicrotask(() => {
            if (signal.aborted) return;
            const details = decodeTrackingDetails(kind, response);

            client.setQueryData(["tracking-card", kind, "document", id], details);
          });
        },
        (error: Error) => {
          // Success-callback decode errors are outside this transport handler.
          if (signal.aborted) return;

          if (error instanceof ApiError && (error.status === 200 || error.status === 204)) {
            window.queueMicrotask(() => {
              if (!signal.aborted) throw error;
            });
          } else console.error(error);
        },
      );
    },
    [client, documentTasks, id, kind],
  );

  return { card, refresh, refreshedAt };
}
