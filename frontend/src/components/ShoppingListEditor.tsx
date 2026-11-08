import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { request } from "@/lib/api";
import {
  getShoppingListForm,
  invalidateShoppingListForms,
  type ShoppingListFormContext,
} from "@/lib/shopping-list-form";
import { initialUserfields } from "@/lib/userfields";
import { saveNativeObjectFields } from "@/lib/native-object-fields";
import { useDocumentTasks } from "@/lib/document-tasks";
import { useI18n } from "@/lib/i18n";
import { PageHeader } from "./PageHeader";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";
import { UserfieldsEditor, type UserfieldsEditorHandle } from "./UserfieldsEditor";
import { NativeUserfieldsLoad } from "./NativeUserfieldsLoad";

export function ShoppingListEditor({
  recordId,
  onSaved,
}: {
  recordId: number | null;
  onSaved: (id: string | number) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const valid = recordId === null || (Number.isInteger(recordId) && recordId > 0);

  const context = useQuery({
    queryKey: ["shopping-list-editor", recordId ?? undefined],
    queryFn: ({ signal }) => getShoppingListForm(recordId, signal),
    enabled: valid,
    retry: false,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const [initialContext, setInitialContext] = useState<ShoppingListFormContext>();

  if (!initialContext && context.isSuccess && !context.isFetching) setInitialContext(context.data);
  const title = recordId === null ? "Create shopping list" : "Edit shopping list";

  return (
    <>
      <PageHeader title={t(title)} />
      {!valid ? <ErrorBlock message={t("Object not found")} /> : null}
      {context.error ? (
        <>
          <ErrorBlock message={context.error.message} />
          <button className="btn" type="button" onClick={() => void context.refetch()}>
            {t("Retry")}
          </button>
        </>
      ) : null}
      {valid && !initialContext && !context.error ? <LoadingBlock /> : null}
      {valid && initialContext ? (
        <ListFields recordId={recordId} data={initialContext} title={title} onSaved={onSaved} />
      ) : null}
    </>
  );
}

function ListFields({
  recordId,
  data,
  title,
  onSaved,
}: {
  recordId: number | null;
  data: ShoppingListFormContext;
  title: string;
  onSaved: (id: string | number) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const nativeDocument = useDocumentTasks();
  const client = useQueryClient();
  const [name, setName] = useState(data.list?.name ?? "");

  const [edits, setEdits] = useState(() => initialUserfields(data.fields, {}, false));

  const [busy, setBusy] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const userfields = useRef<UserfieldsEditorHandle>(null);
  const saving = useRef(false);
  const scope = useRef<AbortController>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    const timer = window.setTimeout(() => nameInput.current?.focus(), 500);

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

  const save = async () => {
    const owner = scope.current;

    if (!owner || saving.current) return;
    const task = nativeDocument.capture();
    const signal = AbortSignal.any([task.signal, owner.signal]);
    signal.throwIfAborted();
    // serializeJSON reads Name before either primary or field callbacks run.
    const capturedName = nameInput.current?.value ?? name;
    saving.current = true;
    setBusy(true);
    document.body.classList.add("cursor-busy");

    const settled = () => {
      void invalidateShoppingListForms(client);
    };

    const writeName = async () => {
      signal.throwIfAborted();

      try {
        const response = await request(
          recordId === null
            ? "/api/objects/shopping_lists"
            : `/api/objects/shopping_lists/${recordId}`,
          {
            method: recordId === null ? "POST" : "PUT",
            body: JSON.stringify({ name: capturedName }),
            signal,
          },
        );

        signal.throwIfAborted();

        return (
          recordId ??
          z.object({ created_object_id: z.union([z.string(), z.number()]) }).parse(response)
            .created_object_id
        );
      } catch (error) {
        if (!signal.aborted) {
          saving.current = false;
          setBusy(false);
          task.genericError(
            "Error while saving, probably this item already exists",
            error instanceof Error ? error : undefined,
          );
        }

        throw error;
      } finally {
        settled();
      }
    };

    const saveFields = async (id: number | string) => {
      await saveNativeObjectFields({
        namespace: "shopping_lists",
        id,
        fields: data.fields,
        readEdits: () => userfields.current?.snapshot() ?? edits,
        fileError: (error) =>
          task.genericError("Error while saving, probably this item already exists", error),
        signal,
        settled,
      });
      signal.throwIfAborted();
    };

    try {
      let id: number | string;

      if (recordId === null) {
        id = await writeName();
        await saveFields(id);
      } else {
        await saveFields(recordId);
        id = await writeName();
      }

      if (!signal.aborted) await onSaved(id);
    } catch {
      // Only primary errors unlock. Metadata is silent; file errors report above.
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      !busy &&
      !document.querySelector(".combobox-menu-visible") &&
      event.currentTarget.reportValidity()
    )
      void save();
  };

  return (
    <form
      className="move-form household-editor"
      aria-label={t(title)}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          event.key !== "Enter" ||
          !(event.target instanceof HTMLInputElement)
        )
          return;
        event.preventDefault();

        if (
          !document.querySelector(".combobox-menu-visible") &&
          event.currentTarget.reportValidity()
        )
          void save();
      }}
    >
      <fieldset disabled={busy}>
        <label className="field">
          {t("Name")}
          <input
            ref={nameInput}
            name="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      </fieldset>
      <UserfieldsEditor
        ref={userfields}
        nativeFiles
        nativeDirty
        nativeLoadPending
        fields={data.fields}
        values={edits}
        creating={recordId === null}
        disabled={busy}
        onChange={(key, edit) => setEdits((current) => ({ ...current, [key]: edit }))}
      />
      <NativeUserfieldsLoad
        namespace="shopping_lists"
        objectId={recordId}
        fieldCount={data.fields.length}
        editor={userfields}
      />
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {t("Save")}
      </button>
    </form>
  );
}
