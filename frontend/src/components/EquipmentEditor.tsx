import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, filePath, queryKeys, request } from "@/lib/api";
import type { JsonObject } from "@/lib/json";
import {
  nativeEquipmentEditorManualUrl,
  nativeEquipmentResources,
} from "@/lib/native-equipment-files";
import {
  equipmentManualFilename,
  getEquipmentRecord,
  invalidateEquipment,
  type EquipmentPayload,
  type EquipmentRecord,
} from "@/lib/equipment-form";
import { getCustomObjectValues } from "@/lib/custom-object-form";
import { saveNativeObjectFields } from "@/lib/native-object-fields";
import { useDocumentTasks } from "@/lib/document-tasks";
import { initialUserfields, userfieldsQuery, type UserfieldDefinition } from "@/lib/userfields";
import { useI18n } from "@/lib/i18n";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { DescriptionEditor } from "./DescriptionEditor";
import { EquipmentManual } from "./EquipmentManual";
import { UserfieldsEditor, type UserfieldsEditorHandle } from "./UserfieldsEditor";
import { NativeUserfieldsLoad } from "./NativeUserfieldsLoad";

export function EquipmentEditor({
  recordId,
  onSaved,
}: {
  recordId: number | null;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const client = useQueryClient();

  const [nativeResources] = useState(() =>
    nativeEquipmentResources(client.getQueryData<JsonObject>(queryKeys.systemConfig)),
  );

  const nativeDocument = useDocumentTasks();
  const valid = recordId === null || (Number.isInteger(recordId) && recordId > 0);
  const definitions = useQuery({ ...userfieldsQuery, refetchOnMount: "always" });
  const [fields, setFields] = useState<UserfieldDefinition[]>();

  if (!fields && definitions.isSuccess && !definitions.isFetching)
    setFields(definitions.data.filter((field) => field.entity === "equipment"));

  const row = useQuery({
    queryKey: ["equipment-editor", recordId],
    queryFn: ({ signal }) =>
      recordId === null ? Promise.resolve(null) : getEquipmentRecord(recordId, signal),
    enabled: valid,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const custom = useQuery({
    queryKey: ["equipment-editor-fields", recordId],
    queryFn: ({ signal }) =>
      getCustomObjectValues(
        "equipment",
        recordId!,
        AbortSignal.any([signal, nativeDocument.capture().signal]),
      ),
    enabled:
      valid && row.isSuccess && recordId !== null && fields !== undefined && fields.length > 0,
    retry: false,
    refetchOnMount: "always",
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const error = definitions.error || row.error;
  const ready = fields !== undefined && row.isSuccess;
  const title = recordId === null ? "Create equipment" : "Edit equipment";

  return (
    <>
      <PageHeader title={t(title)} />
      {!valid ? <ErrorBlock message={t("Object not found")} /> : null}
      {error ? (
        <>
          <ErrorBlock message={error.message} />
          <button
            type="button"
            className="btn"
            onClick={() => {
              void definitions.refetch();

              if (valid) void row.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {valid && !ready && !error ? <LoadingBlock /> : null}
      {ready && fields ? (
        <EquipmentFields
          record={row.data!}
          fields={fields}
          custom={custom.isFetching ? undefined : custom.data}
          customError={custom.isFetching ? null : custom.error}
          title={title}
          onSaved={onSaved}
          nativeResources={nativeResources}
        />
      ) : null}
    </>
  );
}

function EquipmentFields({
  record,
  fields,
  custom,
  customError,
  title,
  onSaved,
  nativeResources,
}: {
  record: EquipmentRecord | null;
  fields: UserfieldDefinition[];
  custom: Record<string, string | null> | undefined;
  customError: Error | null;
  title: string;
  onSaved: () => Promise<void> | void;
  nativeResources: boolean;
}) {
  const { t } = useI18n();
  const client = useQueryClient();

  const config = useQuery<JsonObject>({
    queryKey: queryKeys.systemConfig,
    queryFn: api.getSystemConfig,
    enabled: false,
  });

  const nativeDocument = useDocumentTasks();
  const manualId = useId();
  const [name, setName] = useState(record?.name ?? "");
  const [description, setDescription] = useState(record?.description ?? "");
  const [descriptionReady, setDescriptionReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState(() => initialUserfields(fields, {}, false));
  const userfields = useRef<UserfieldsEditorHandle>(null);
  const loadAttempted = useRef(false);
  const loadOwner = useRef<AbortSignal>(undefined);
  const loadDocument = useRef(nativeDocument);
  useEffect(() => {
    if (record === null) return;

    // Strict Mode replays the same provider with a fresh signal; a replacement document retires Load.
    if (
      !loadOwner.current ||
      (loadOwner.current.aborted && loadDocument.current === nativeDocument)
    ) {
      loadOwner.current = nativeDocument.capture().signal;
      loadDocument.current = nativeDocument;
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
      // Native Load callback failure does not replace the usable form.
      console.error(error);
    }
  }, [custom, customError, record, nativeDocument]);
  const saving = useRef(false);
  const descriptionInput = useRef<HTMLTextAreaElement>(null);
  const manual = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const scope = useRef<AbortController>(undefined);
  const deleteRequested = useRef(false);
  const [deleted, setDeleted] = useState(false);
  const [deleteHint, setDeleteHint] = useState(false);
  const [selectedName, setSelectedName] = useState<string>();

  const storedManual =
    record?.instruction_manual_file_name && record.instruction_manual_file_name !== "0"
      ? record.instruction_manual_file_name
      : "";

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

  const save = async (input: { body: EquipmentPayload; deleteAtSubmit: boolean }) => {
    const owner = scope.current;

    if (!owner || saving.current) return;
    const task = nativeDocument.capture();
    const signal = AbortSignal.any([task.signal, owner.signal]);
    signal.throwIfAborted();
    saving.current = true;
    setBusy(true);
    document.body.classList.add("cursor-busy");

    const settled = () => {
      void invalidateEquipment(client);
    };

    const genericFailure = (error: Error, unlock: boolean) => {
      if (signal.aborted) return;

      if (unlock) {
        saving.current = false;
        setBusy(false);
      }

      task.genericError("Error while saving, probably this item already exists", error);
    };

    if (record && input.deleteAtSubmit) {
      // This independent source request may unlock another Save while the old PUT lives.
      void request(filePath("equipmentmanuals", storedManual || "undefined"), {
        method: "DELETE",
        signal,
      })
        .catch((error: Error) => genericFailure(error, true))
        .finally(settled);
    }

    let id: number | string;

    try {
      const result = await request(
        record ? `/api/objects/equipment/${record.id}` : "/api/objects/equipment",
        { method: record ? "PUT" : "POST", body: JSON.stringify(input.body), signal },
      );

      signal.throwIfAborted();
      id =
        record?.id ??
        z.object({ created_object_id: z.union([z.string(), z.number()]) }).parse(result)
          .created_object_id;
      z.coerce.number().int().parse(id);
    } catch (error) {
      if (error instanceof Error) genericFailure(error, true);

      return;
    } finally {
      settled();
    }

    try {
      await saveNativeObjectFields({
        namespace: "equipment",
        id,
        fields,
        readEdits: () => userfields.current?.snapshot() ?? edits,
        fileError: (error) => genericFailure(error, false),
        signal,
        settled,
      });
      signal.throwIfAborted();
    } catch {
      // Native metadata failure has no outer callback; custom file errors stay busy.
      return;
    }

    if (input.body.instruction_manual_file_name !== undefined && !deleteRequested.current) {
      try {
        // Filename is fixed at submit; the bytes come from the enabled live picker.
        await request(
          filePath("equipmentmanuals", String(input.body.instruction_manual_file_name)),
          { method: "PUT", body: manual.current?.files?.[0], signal },
        );
        signal.throwIfAborted();
      } catch (error) {
        if (error instanceof Error) genericFailure(error, true);

        return;
      } finally {
        settled();
      }
    }

    if (!signal.aborted) await onSaved();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      busy ||
      !descriptionReady ||
      document.querySelector(".combobox-menu-visible") ||
      !event.currentTarget.reportValidity()
    )
      return;

    const body: EquipmentPayload = {
      name: nameInput.current?.value ?? name,
      description: (descriptionInput.current?.value ?? description).replace(/\r?\n/g, "\r\n"),
    };

    const file = manual.current?.files?.[0];

    if (file) body.instruction_manual_file_name = equipmentManualFilename(file);

    if (deleteRequested.current) body.instruction_manual_file_name = null;
    void save({ body, deleteAtSubmit: deleteRequested.current });
  };

  return (
    <div className="form-grid equipment-editor">
      <form className="move-form household-editor" aria-label={t(title)} onSubmit={submit}>
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
          <textarea ref={descriptionInput} hidden readOnly name="description" value={description} />
          <DescriptionEditor
            entity="equipment"
            label="Notes"
            value={description}
            onChange={setDescription}
            onReady={setDescriptionReady}
          />
        </fieldset>
        <UserfieldsEditor
          ref={userfields}
          nativeFiles
          nativeDirty
          nativeLoadPending
          fields={fields}
          values={edits}
          creating={record === null}
          disabled={busy}
          onChange={(name, edit) => setEdits((current) => ({ ...current, [name]: edit }))}
        />
        {record === null ? (
          <NativeUserfieldsLoad
            namespace={"equipment"}
            objectId={null}
            fieldCount={fields.length}
            editor={userfields}
          />
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={busy || !descriptionReady}>
          {t("Save")}
        </button>
      </form>
      <section className="equipment-manual-editor">
        <h2>{t("Instruction manual")}</h2>
        <input
          ref={manual}
          id={manualId}
          aria-label={t("Instruction manual")}
          type="file"
          accept="application/pdf"
          onChange={(event) => {
            setSelectedName(event.target.files?.[0]?.name ?? "");
            setDeleteHint(false);
          }}
        />
        <label htmlFor={manualId}>
          {(selectedName ?? (deleted ? "" : storedManual)) || t("No file selected")}
        </label>
        <button
          type="button"
          className="btn"
          disabled={deleted}
          onClick={() => {
            deleteRequested.current = true;
            setDeleted(true);
            setDeleteHint(true);
            setSelectedName("");
          }}
        >
          {t("Delete current instruction manual")}
        </button>
        {storedManual ? (
          <>
            <div hidden={deleted}>
              {nativeResources && !config.data ? (
                <LoadingBlock />
              ) : (
                <EquipmentManual
                  name={storedManual}
                  label={`${t("Instruction manual")}: ${record?.name ?? ""}`}
                  sourceUrl={
                    nativeResources && config.data
                      ? nativeEquipmentEditorManualUrl(storedManual, config.data)
                      : undefined
                  }
                />
              )}
            </div>
            {deleteHint ? <p>{t("The current file will be deleted on save")}</p> : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
