import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/lib/api";
import {
  getUserentity,
  invalidateUserentityDefinitions,
  type UserentityRecord,
} from "@/lib/custom-object-form";
import type { JsonObject } from "@/lib/json";
import { useI18n } from "@/lib/i18n";
import { useDocumentTasks } from "@/lib/document-tasks";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

export function UserentityEditor({
  recordId,
  onSaved,
}: {
  recordId: number | null;
  onSaved: (signal: AbortSignal) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const valid = recordId === null || (Number.isInteger(recordId) && recordId > 0);

  const row = useQuery({
    queryKey: ["userentity-editor", recordId],
    queryFn: ({ signal }) =>
      recordId === null ? Promise.resolve(null) : getUserentity(recordId, signal),
    enabled: valid,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const title = recordId === null ? "Create userentity" : "Edit userentity";

  return (
    <>
      <PageHeader title={t(title)} />
      {!valid ? <ErrorBlock message={t("Object not found")} /> : null}
      {row.error ? (
        <>
          <ErrorBlock message={row.error.message} />
          <button type="button" className="btn" onClick={() => void row.refetch()}>
            {t("Retry")}
          </button>
        </>
      ) : null}
      {valid && row.isPending ? <LoadingBlock /> : null}
      {row.isSuccess ? (
        <UserentityFields record={row.data} title={title} onSaved={onSaved} />
      ) : null}
    </>
  );
}

function UserentityFields({
  record,
  title,
  onSaved,
}: {
  record: UserentityRecord | null;
  title: string;
  onSaved: (signal: AbortSignal) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const nativeDocument = useDocumentTasks();
  const [name, setName] = useState(record?.name ?? "");
  const [caption, setCaption] = useState(record?.caption ?? "");
  const [description, setDescription] = useState(record?.description ?? "");
  const [sidebar, setSidebar] = useState(record?.show_in_sidebar_menu === 1);
  const [icon, setIcon] = useState(record?.icon_css_class ?? "");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [restored, setRestored] = useState({ name: false, icon: false });
  const primaryFields = useRef<HTMLFieldSetElement>(null);
  const scope = useRef<AbortController>(undefined);
  const nameInput = useRef<HTMLInputElement>(null);
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
    const body: JsonObject = {};

    for (const control of primaryFields.current?.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement
    >("input[name], textarea[name]") ?? []) {
      if (control.matches(":disabled")) continue;
      body[control.name] =
        control instanceof HTMLTextAreaElement
          ? control.value.replace(/\r?\n/g, "\r\n")
          : control.type === "checkbox"
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
        record ? `/api/objects/userentities/${record.id}` : "/api/objects/userentities",
        { method: record ? "PUT" : "POST", body: JSON.stringify(body), signal },
      );
      signal.throwIfAborted();
    } catch (error) {
      if (!signal.aborted) {
        saving.current = false;
        setBusy(false);
        // Native EndUiBusy enables every control, including the original edit Name/Icon.
        setRestored({ name: true, icon: true });
        task.genericError(
          "Error while saving, probably this item already exists",
          error instanceof Error ? error : undefined,
        );
      }

      return;
    } finally {
      void invalidateUserentityDefinitions(client);
    }

    if (!signal.aborted) await onSaved(signal);
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
      <fieldset ref={primaryFields} disabled={busy}>
        <label className="field">
          {t("Name")}
          <input
            ref={nameInput}
            name="name"
            required
            pattern="^[a-zA-Z0-9_]*$"
            disabled={record !== null && !restored.name}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          {t("Caption")}
          <input
            name="caption"
            required
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
          />
        </label>
        <label className="field">
          {t("Description")}
          <textarea
            name="description"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            name="show_in_sidebar_menu"
            checked={sidebar}
            onChange={(event) => {
              setRestored((current) => ({ ...current, icon: false }));
              setSidebar(event.target.checked);
            }}
          />
          {t("Show in sidebar menu")}
        </label>
        <label className="field">
          {t("Icon CSS class")}
          <input
            name="icon_css_class"
            disabled={!sidebar && !restored.icon}
            value={icon}
            placeholder={`${t("For example")} "fa-solid fa-smile"`}
            onChange={(event) => setIcon(event.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary">
          {t("Save")}
        </button>
      </fieldset>
    </form>
  );
}
