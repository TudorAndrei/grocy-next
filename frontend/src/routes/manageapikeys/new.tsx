import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { createNativeApiKey } from "@/lib/native-api-keys";
import { useDocumentTasks } from "@/lib/document-tasks";
import { LoadingBlock } from "@/components/LoadingBlock";
import { ErrorBlock } from "@/components/ErrorBlock";

export const Route = createFileRoute("/manageapikeys/new")({
  gcTime: 0,
  component: CreateApiKey,
  errorComponent: ({ error }) => (
    <ErrorBlock message={error instanceof Error ? error.message : String(error)} />
  ),
});

function CreateApiKey() {
  const router = useRouter();
  const [pathname] = useState(() => router.state.location.pathname.replace(/\/+$/, ""));

  const [activation, setActivation] = useState(() => ({
    index: 0,
    search: router.history.location.search,
  }));

  const owner = useRef<AbortController | null>(null);

  const register = useCallback((controller: AbortController) => {
    owner.current = controller;

    return () => {
      if (owner.current === controller) owner.current = null;
    };
  }, []);

  useLayoutEffect(
    () =>
      router.subscribe("onBeforeLoad", ({ toLocation }) => {
        owner.current?.abort();

        if (toLocation.pathname.replace(/\/+$/, "") === pathname)
          setActivation((previous) => ({
            index: previous.index + 1,
            search: toLocation.searchStr,
          }));
      }),
    [router, pathname],
  );

  return (
    <CreateApiKeyActivation key={activation.index} search={activation.search} register={register} />
  );
}

function CreateApiKeyActivation({
  search,
  register,
}: {
  search: string;
  register: (controller: AbortController) => () => void;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const documentTasks = useDocumentTasks();
  const [error, setError] = useState<string>();
  const started = useRef(false);
  const capture = useEffectEvent(() => documentTasks.capture());

  useEffect(() => {
    const controller = new AbortController();
    const unregister = register(controller);
    const document = capture();
    const signal = AbortSignal.any([controller.signal, document.signal]);

    // StrictMode retires its initial setup before this dispatch can write.
    queueMicrotask(() => {
      if (signal.aborted || started.current) return;
      started.current = true;

      void createNativeApiKey(search, signal, client)
        .then(async (id) => {
          if (signal.aborted) return;

          await router.navigate({ to: "/manageapikeys", search: { key: id }, replace: true });
        })
        .catch((failure) => {
          if (!signal.aborted)
            setError(failure instanceof Error ? failure.message : String(failure));
        });
    });

    return () => {
      controller.abort();
      unregister();
    };
  }, [client, router, search, register]);

  return error === undefined ? <LoadingBlock /> : <ErrorBlock message={error} />;
}
