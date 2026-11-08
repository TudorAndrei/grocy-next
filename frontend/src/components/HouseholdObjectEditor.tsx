import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { useDocumentTasks } from "@/lib/document-tasks";
import { saveNativeHouseholdObject, type NativeHouseholdEntity } from "@/lib/native-household-save";
import { request } from "@/lib/api";
import { getCustomObjectValues } from "@/lib/custom-object-form";
import type { JsonObject } from "@/lib/json";
import { useI18n } from "@/lib/i18n";
import { initialUserfields, userfieldsQuery, type UserfieldDefinition } from "@/lib/userfields";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { UserfieldsEditor, type UserfieldsEditorHandle } from "./UserfieldsEditor";
import { NativeUserfieldsLoad } from "./NativeUserfieldsLoad";

type Props = {
  entity: NativeHouseholdEntity;
  nativeDocument: ReturnType<typeof useDocumentTasks>;
  recordId: number | null;
  title: string;
  defaults: (record: JsonObject | null) => Record<string, string>;
  fields: (
    values: Record<string, string>,
    change: (key: string, value: string) => void,
    initialRecord: JsonObject | null,
  ) => ReactNode;
  addAnother?: boolean;
  onSaved: (id: number, addAnother: boolean) => Promise<void> | void;
};

export function HouseholdObjectEditor(props: Props) {
  const { t } = useI18n();

  const validId =
    props.recordId === null || (Number.isInteger(props.recordId) && props.recordId > 0);

  const definitions = useQuery(userfieldsQuery);
  const fields = definitions.data?.filter((field) => field.entity === props.entity) ?? [];

  const row = useQuery({
    queryKey: ["household-object-editor", props.entity, props.recordId],
    queryFn: ({ signal }) =>
      props.recordId === null
        ? Promise.resolve(null)
        : request<JsonObject>(`/api/objects/${props.entity}/${props.recordId}`, { signal }),
    enabled: validId,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const custom = useQuery({
    queryKey: ["household-object-userfields", props.entity, props.recordId],
    queryFn: ({ signal }) =>
      getCustomObjectValues(
        props.entity,
        props.recordId!,
        AbortSignal.any([signal, props.nativeDocument.capture().signal]),
      ),
    enabled:
      validId &&
      row.isSuccess &&
      props.recordId !== null &&
      definitions.isSuccess &&
      fields.length > 0,
    retry: false,
    refetchOnMount: "always",
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const error = row.error || definitions.error;
  const ready = row.isSuccess && definitions.isSuccess;

  return (
    <>
      <PageHeader title={t(props.title)} />
      {!validId ? <ErrorBlock message={t("Object not found")} /> : null}
      {error ? (
        <>
          <ErrorBlock message={error.message} />
          <button
            type="button"
            className="btn"
            onClick={() => {
              void row.refetch();
              void definitions.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {validId && !ready && !error ? <LoadingBlock /> : null}
      {ready ? (
        <ObjectFields
          {...props}
          definitions={fields}
          record={row.data}
          custom={custom.isFetching ? undefined : custom.data}
          customError={custom.isFetching ? null : custom.error}
        />
      ) : null}
    </>
  );
}

function ObjectFields({
  definitions,
  record,
  custom,
  customError,
  ...props
}: Props & {
  definitions: UserfieldDefinition[];
  record: JsonObject | null;
  custom: Record<string, string | null> | undefined;
  customError: Error | null;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const userfields = useRef<UserfieldsEditorHandle>(null);
  const loadAttempted = useRef(false);
  const loadOwner = useRef<AbortSignal>(undefined);
  const loadDocument = useRef(props.nativeDocument);
  useEffect(() => {
    if (props.recordId === null) return;

    // Strict Mode replays the same provider with a fresh signal; a replacement document retires Load.
    if (
      !loadOwner.current ||
      (loadOwner.current.aborted && loadDocument.current === props.nativeDocument)
    ) {
      loadOwner.current = props.nativeDocument.capture().signal;
      loadDocument.current = props.nativeDocument;
    }

    if (loadOwner.current.aborted || loadAttempted.current || (!custom && !customError)) return;
    loadAttempted.current = true;

    if (customError) {
      console.error(customError);

      return;
    }

    try {
      if (custom) userfields.current?.load(custom);
    } catch (error) {
      console.error(error);
    }
  }, [custom, customError, props.recordId, props.nativeDocument]);
  const primaryFields = useRef<HTMLFieldSetElement>(null);
  const [nativeBusy, setNativeBusy] = useState(false);
  const nativeSaving = useRef(false);
  const [values, setValues] = useState(() => props.defaults(record));

  const [edits, setEdits] = useState(() => initialUserfields(definitions, {}, false));

  const fieldController = useRef<AbortController>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    fieldController.current = controller;

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("cursor-busy", nativeBusy);

    return () => document.body.classList.remove("cursor-busy");
  }, [props.nativeDocument, nativeBusy]);

  const submitNative = async (another: boolean) => {
    const scope = fieldController.current;

    if (!scope || nativeSaving.current) return;
    const task = props.nativeDocument.capture();
    const signal = AbortSignal.any([task.signal, scope.signal]);
    signal.throwIfAborted();
    nativeSaving.current = true;
    setNativeBusy(true);
    document.body.classList.add("cursor-busy");

    // Native serializeArray reads the live primary controls. Textareas use CRLF,
    // while custom metadata retains the value read by its own field handler.
    const body: JsonObject = { ...values };

    for (const control of primaryFields.current?.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("input[name], textarea[name], select[name]") ?? []) {
      if (!Object.hasOwn(body, control.name)) continue;
      body[control.name] =
        control instanceof HTMLTextAreaElement
          ? control.value.replace(/\r?\n/g, "\r\n")
          : control instanceof HTMLInputElement && control.type === "checkbox"
            ? control.checked
              ? "1"
              : "0"
            : control.value;
    }

    const identity = await saveNativeHouseholdObject({
      client,
      entity: props.entity,
      recordId: props.recordId,
      body,
      fields: definitions,
      readEdits: () => userfields.current?.snapshot() ?? edits,
      primaryError: (error) => {
        nativeSaving.current = false;
        setNativeBusy(false);
        task.genericError("Error while saving, probably this item already exists", error);
      },
      fileError: (error) =>
        task.genericError("Error while saving, probably this item already exists", error),
      signal,
    });

    if (identity !== undefined && !signal.aborted) await props.onSaved(identity.id, another);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const button = event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : null;

    if (!document.querySelector(".combobox-menu-visible") && event.currentTarget.reportValidity()) {
      const another = button instanceof HTMLButtonElement && button.value === "another";
      void submitNative(another);
    }
  };

  return (
    <form
      className="move-form household-editor"
      aria-label={t(props.title)}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
        event.preventDefault();

        if (
          !document.querySelector(".combobox-menu-visible") &&
          event.currentTarget.reportValidity()
        )
          void submitNative(false);
      }}
    >
      <fieldset ref={primaryFields} disabled={nativeBusy}>
        {props.fields(
          values,
          (key, value) => setValues((current) => ({ ...current, [key]: value })),
          record,
        )}
      </fieldset>
      <UserfieldsEditor
        ref={userfields}
        nativeFiles
        nativeDirty
        nativeLoadPending
        fields={definitions}
        values={edits}
        creating={props.recordId === null}
        disabled={nativeBusy}
        onChange={(name, edit) => setEdits((current) => ({ ...current, [name]: edit }))}
      />
      {props.recordId === null ? (
        <NativeUserfieldsLoad
          namespace={props.entity}
          objectId={null}
          fieldCount={definitions.length}
          editor={userfields}
        />
      ) : null}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={nativeBusy}>
          {t(props.addAnother ? "Save & close" : "Save")}
        </button>
        {props.addAnother ? (
          <button type="submit" value="another" className="btn" disabled={nativeBusy}>
            {t("Save & add another task")}
          </button>
        ) : null}
      </div>
    </form>
  );
}
