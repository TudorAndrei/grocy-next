import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { request } from "@/lib/api";
import { customDataCatalogQuery } from "@/lib/custom-data-context";
import {
  getUserfieldDefinition,
  invalidateUserfieldDefinitions,
  type UserfieldDefinitionRecord,
} from "@/lib/userfield-form";
import { nativeQueryParameter } from "@/lib/native-query-flag";
import { useDocumentTasks } from "@/lib/document-tasks";
import { useI18n } from "@/lib/i18n";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { NumberPicker } from "./NumberPicker";

export type UserfieldSaveReceipt = {
  signal: AbortSignal;
  redirectEntity: string | true | undefined;
};

export function UserfieldEditor({
  recordId,
  entity,
  onSaved,
}: {
  recordId: number | null;
  entity?: string | true;
  onSaved: (receipt: UserfieldSaveReceipt) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const valid = recordId === null || (Number.isInteger(recordId) && recordId > 0);
  const catalog = useQuery(customDataCatalogQuery);

  const record = useQuery({
    queryKey: ["userfield-editor", recordId],
    queryFn: ({ signal }) =>
      recordId === null ? Promise.resolve(null) : getUserfieldDefinition(recordId, signal),
    enabled: valid,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const title = recordId === null ? "Create userfield" : "Edit userfield";
  const error = catalog.error || record.error;

  return (
    <>
      <PageHeader title={t(title)} />
      {!valid ? <ErrorBlock message={t("Object not found")} /> : null}
      {error ? (
        <>
          <ErrorBlock message={error.message} />
          <button
            className="btn"
            type="button"
            onClick={() => {
              void catalog.refetch();

              if (valid) void record.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {valid && !error && (!record.isSuccess || !catalog.isSuccess) ? <LoadingBlock /> : null}
      {valid && record.isSuccess && catalog.isSuccess ? (
        <DefinitionForm
          recordId={recordId}
          record={record.data}
          entity={entity}
          entities={catalog.data.entities}
          types={catalog.data.field_types}
          title={title}
          onSaved={onSaved}
        />
      ) : null}
    </>
  );
}

function DefinitionForm({
  recordId,
  record,
  entity,
  entities,
  types,
  title,
  onSaved,
}: {
  recordId: number | null;
  record: UserfieldDefinitionRecord | null;
  entity?: string | true;
  entities: string[];
  types: string[];
  title: string;
  onSaved: (receipt: UserfieldSaveReceipt) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const id = useId();
  const client = useQueryClient();
  const router = useRouter();
  const nativeDocument = useDocumentTasks();
  const form = useRef<HTMLFormElement>(null);
  const scope = useRef<AbortController>(undefined);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;

    return () => {
      controller.abort();
      document.body.classList.remove("cursor-busy");
    };
  }, []);

  const [values, setValues] = useState(() => {
    const selectedEntity = String(entity || record?.entity || "");

    return {
      entity: entities.includes(selectedEntity) ? selectedEntity : "",
      name: record?.name ?? "",
      caption: record?.caption ?? "",
      sort_number: record?.sort_number ? String(record.sort_number) : "",
      type: record && types.includes(record.type) ? record.type : "",
      config: record?.config ?? "",
      default_value: record?.default_value === "now" ? "now" : "",
      show_as_column_in_tables: record?.show_as_column_in_tables === 1 ? "1" : "0",
      input_required: record?.input_required === 1 ? "1" : "0",
    };
  });

  const change = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    document.body.classList.toggle("cursor-busy", busy);

    return () => document.body.classList.remove("cursor-busy");
  }, [busy]);

  const save = async () => {
    const owner = scope.current;

    if (!owner || saving.current || !form.current) return;
    const task = nativeDocument.capture();
    const signal = AbortSignal.any([task.signal, owner.signal]);
    signal.throwIfAborted();
    const redirectEntity = nativeQueryParameter(router.history.location.search, "entity");
    const body: Record<string, string> = {};

    // serializeJSON captures successful main controls, including hidden enabled groups.
    for (const control of form.current.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("input[name], textarea[name], select[name]")) {
      if (control.matches(":disabled")) continue;
      body[control.name] =
        control instanceof HTMLTextAreaElement
          ? control.value.replace(/\r?\n/g, "\r\n")
          : control instanceof HTMLInputElement && control.type === "checkbox"
            ? control.checked
              ? "1"
              : "0"
            : control.value;
    }

    saving.current = true;
    setBusy(true);
    document.body.classList.add("cursor-busy");

    try {
      await request(
        recordId === null ? "/api/objects/userfields" : `/api/objects/userfields/${recordId}`,
        {
          method: recordId === null ? "POST" : "PUT",
          body: JSON.stringify(body),
          signal,
        },
      );
      signal.throwIfAborted();
    } catch (error) {
      if (!signal.aborted) {
        saving.current = false;
        setBusy(false);
        task.genericError(
          "Error while saving, probably this item already exists",
          error instanceof Error ? error : undefined,
        );
      }

      return;
    } finally {
      void invalidateUserfieldDefinitions(client);
    }

    if (!signal.aborted) await onSaved({ signal, redirectEntity });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      !saving.current &&
      !document.querySelector(".combobox-menu-visible") &&
      event.currentTarget.reportValidity()
    )
      void save();
  };

  const showConfig = values.type === "preset-list" || values.type === "preset-checklist";
  const showDefault = values.type === "date" || values.type === "datetime";

  return (
    <form
      ref={form}
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

        if (event.currentTarget.checkValidity()) event.currentTarget.requestSubmit();
      }}
    >
      <fieldset disabled={busy}>
        <label className="field">
          {t("Entity")}
          <select
            name="entity"
            required
            autoFocus={!entity}
            value={values.entity}
            onChange={(event) => change("entity", event.target.value)}
          >
            <option value="" />
            {entities.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t("Name")}
          <input
            name="name"
            required
            pattern="^[a-zA-Z0-9_]*$"
            autoFocus={Boolean(entity)}
            value={values.name}
            onChange={(event) => change("name", event.target.value)}
            aria-describedby={`${id}-name-hint`}
          />
        </label>
        <p className="field-hint" id={`${id}-name-hint`}>
          {t("This is the internal field name, e. g. for the API")}
        </p>
        <label className="field">
          {t("Caption")}
          <input
            name="caption"
            required
            value={values.caption}
            onChange={(event) => change("caption", event.target.value)}
            aria-describedby={`${id}-caption-hint`}
          />
        </label>
        <p className="field-hint" id={`${id}-caption-hint`}>
          {t("This is used to display the field on the frontend")}
        </p>
        <label className="field" htmlFor={`${id}-sort`}>
          {t("Sort number")}
        </label>
        <NumberPicker
          id={`${id}-sort`}
          name="sort_number"
          label="Sort number"
          value={values.sort_number}
          min={0}
          step="1"
          onChange={(value) => change("sort_number", value)}
        />
        <p className="field-hint">
          {t("Multiple Userfields will be ordered by that number on the input form")}
        </p>
        <label className="field">
          {t("Type")}
          <select
            name="type"
            required
            value={values.type}
            onChange={(event) => change("type", event.target.value)}
          >
            <option value="" />
            {types.map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </select>
        </label>
        <div hidden={!showConfig}>
          <label className="field">
            {t("Configuration")}
            <textarea
              name="config"
              rows={10}
              value={values.config}
              onChange={(event) => change("config", event.target.value)}
              aria-describedby={`${id}-config-hint`}
            />
          </label>
          <p className="field-hint" id={`${id}-config-hint`}>
            {showConfig ? t("A predefined list of values, one per line") : ""}
          </p>
        </div>
        <div hidden={!showDefault}>
          <label className="field">
            {t("Default value")}
            <select
              name="default_value"
              value={values.default_value}
              onChange={(event) => change("default_value", event.target.value)}
            >
              <option value="" />
              <option value="now">{t("Now / today")}</option>
            </select>
          </label>
        </div>
        <label className="check-field">
          <input
            type="checkbox"
            name="show_as_column_in_tables"
            checked={values.show_as_column_in_tables === "1"}
            onChange={(event) =>
              change("show_as_column_in_tables", event.target.checked ? "1" : "0")
            }
          />
          {t("Show as column in tables")}
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            name="input_required"
            checked={values.input_required === "1"}
            onChange={(event) => change("input_required", event.target.checked ? "1" : "0")}
          />
          {t("Mandatory")}
        </label>
        <p className="field-hint">
          {t("When enabled, then this field must be filled on the destination form")}
        </p>
        <button type="submit" className="btn btn-primary">
          {t("Save")}
        </button>
      </fieldset>
    </form>
  );
}
