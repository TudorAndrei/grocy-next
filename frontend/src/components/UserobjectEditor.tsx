import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { request } from "@/lib/api";
import { getUserobjectsContext, type UserobjectsContext } from "@/lib/custom-data-context";
import { getUserobject, getCustomObjectValues } from "@/lib/custom-object-form";
import { initialUserfields } from "@/lib/userfields";
import { useI18n } from "@/lib/i18n";
import { useDocumentTasks } from "@/lib/document-tasks";
import { saveNativeObjectFields } from "@/lib/native-object-fields";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { UserfieldsEditor, type UserfieldsEditorHandle } from "./UserfieldsEditor";
import { NativeUserfieldsLoad } from "./NativeUserfieldsLoad";

export function UserobjectEditor({
  entityName,
  recordId,
  onSaved,
}: {
  entityName: string;
  recordId: number | null;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const nativeDocument = useDocumentTasks();
  const valid = recordId === null || (Number.isInteger(recordId) && recordId > 0);

  const context = useQuery({
    queryKey: ["custom-data-objects", entityName],
    queryFn: ({ signal }) => getUserobjectsContext(entityName, signal),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
  });

  const [initialContext, setInitialContext] = useState<UserobjectsContext>();

  if (!initialContext && context.isSuccess && !context.isFetching) setInitialContext(context.data);

  const row = useQuery({
    queryKey: ["userobject-editor", recordId],
    queryFn: ({ signal }) =>
      recordId === null ? Promise.resolve(null) : getUserobject(recordId, signal),
    enabled: valid,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const namespace = "userentity-" + entityName;

  const values = useQuery({
    queryKey: ["userobject-editor-values", namespace, recordId],
    queryFn: ({ signal }) =>
      getCustomObjectValues(
        namespace,
        recordId!,
        AbortSignal.any([signal, nativeDocument.capture().signal]),
      ),
    enabled:
      recordId !== null &&
      valid &&
      row.isSuccess &&
      initialContext !== undefined &&
      initialContext.fields.length > 0,
    retry: false,
    refetchOnMount: "always",
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const error = context.error || row.error;

  const ready = initialContext !== undefined && row.isSuccess;

  const title = initialContext
    ? t(recordId === null ? "Create %s" : "Edit %s", initialContext.userentity.caption)
    : t("Userobjects");

  return (
    <>
      <PageHeader title={title} />
      {!valid ? <ErrorBlock message={t("Object not found")} /> : null}
      {error ? (
        <>
          <ErrorBlock message={error.message} />
          <button
            type="button"
            className="btn"
            onClick={() => {
              void context.refetch();

              if (valid) void row.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {valid && !ready && !error ? <LoadingBlock /> : null}
      {ready && initialContext ? (
        <UserobjectFields
          recordId={recordId}
          context={initialContext}
          values={values.isFetching ? undefined : values.data}
          valuesError={values.isFetching ? null : values.error}
          title={title}
          onSaved={onSaved}
        />
      ) : null}
    </>
  );
}

function UserobjectFields({
  recordId,
  context,
  values,
  valuesError,
  title,
  onSaved,
}: {
  recordId: number | null;
  context: UserobjectsContext;
  values: Record<string, string | null> | undefined;
  valuesError: Error | null;
  title: string;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const nativeDocument = useDocumentTasks();
  const namespace = "userentity-" + context.userentity.name;

  const [edits, setEdits] = useState(() => initialUserfields(context.fields, {}, false));

  const [busy, setBusy] = useState(false);
  const scope = useRef<AbortController>(undefined);
  const form = useRef<HTMLFormElement>(null);
  const userfields = useRef<UserfieldsEditorHandle>(null);
  const loadAttempted = useRef(false);
  const loadOwner = useRef<AbortSignal>(undefined);
  const loadDocument = useRef(nativeDocument);
  useEffect(() => {
    if (recordId === null) return;

    // Strict Mode replays the same provider with a fresh signal; a replacement document retires Load.
    if (
      !loadOwner.current ||
      (loadOwner.current.aborted && loadDocument.current === nativeDocument)
    ) {
      loadOwner.current = nativeDocument.capture().signal;
      loadDocument.current = nativeDocument;
    }

    if (loadOwner.current.aborted || loadAttempted.current || (!values && !valuesError)) return;
    loadAttempted.current = true;

    if (valuesError) {
      console.error(valuesError);

      return;
    }

    try {
      if (values) userfields.current?.load(values);
    } catch (error) {
      console.error(error);
    }
  }, [values, valuesError, recordId, nativeDocument]);
  const saving = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;

    const timer = window.setTimeout(
      () => form.current?.querySelector<HTMLElement>("input,textarea,select")?.focus(),
      500,
    );

    return () => {
      controller.abort();
      window.clearTimeout(timer);
      document.body.classList.remove("cursor-busy");
    };
  }, []);
  useEffect(() => {
    document.body.classList.toggle("cursor-busy", busy);

    return () => document.body.classList.remove("cursor-busy");
  }, [busy]);

  const invalidate = () => {
    for (const queryKey of [
      ["custom-data-entities"],
      ["custom-data-catalog"],
      ["custom-data-objects"],
      ["userentities"],
      ["objects", "userentities"],
      ["objects", "userobjects"],
      ["userobject-editor"],
      ["userobject-editor-values", namespace],
    ])
      void client.invalidateQueries({ queryKey, refetchType: "none" });
  };

  const submitNative = async () => {
    const owner = scope.current;

    if (!owner || saving.current) return;
    const task = nativeDocument.capture();
    const signal = AbortSignal.any([task.signal, owner.signal]);
    signal.throwIfAborted();
    saving.current = true;
    setBusy(true);
    let id: number | string;

    try {
      const result = await request(
        recordId === null ? "/api/objects/userobjects" : `/api/objects/userobjects/${recordId}`,
        {
          method: recordId === null ? "POST" : "PUT",
          body: JSON.stringify({ userentity_id: context.userentity.id }),
          signal,
        },
      );

      signal.throwIfAborted();
      id =
        recordId ??
        z.object({ created_object_id: z.union([z.string(), z.number()]) }).parse(result)
          .created_object_id;
      z.coerce.number().int().parse(id);
    } catch (error) {
      if (!signal.aborted && error instanceof Error) {
        saving.current = false;
        setBusy(false);
        task.genericError("Error while saving, probably this item already exists", error);
      }

      return;
    } finally {
      invalidate();
    }

    try {
      await saveNativeObjectFields({
        namespace,
        id,
        fields: context.fields,
        readEdits: () => userfields.current?.snapshot() ?? edits,
        fileError: (error) =>
          task.genericError("Error while saving, probably this item already exists", error),
        signal,
        settled: invalidate,
      });
    } catch {
      // Native metadata failure has no outer error callback; file errors report above.
      return;
    }

    if (!signal.aborted) await onSaved();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      !busy &&
      !document.querySelector(".combobox-menu-visible") &&
      event.currentTarget.reportValidity()
    )
      void submitNative();
  };

  return (
    <form
      ref={form}
      className="move-form household-editor userobject-editor"
      aria-label={title}
      onSubmit={submit}
    >
      <UserfieldsEditor
        ref={userfields}
        nativeFiles
        nativeDirty
        nativeLoadPending
        fields={context.fields}
        values={edits}
        creating={recordId === null}
        disabled={busy}
        onChange={(name, edit) => setEdits((current) => ({ ...current, [name]: edit }))}
      />
      {recordId === null ? (
        <NativeUserfieldsLoad
          namespace={namespace}
          objectId={null}
          fieldCount={context.fields.length}
          editor={userfields}
        />
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {t("Save")}
      </button>
    </form>
  );
}
