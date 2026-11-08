import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/lib/api";
import { useDocumentTasks } from "@/lib/document-tasks";
import { useI18n } from "@/lib/i18n";
import {
  getMealPlanSectionContext,
  invalidateMealPlanSections,
  type MealPlanSection,
} from "@/lib/mealplan-sections";
import { PageHeader } from "./PageHeader";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";
import { NumberPicker } from "./NumberPicker";

export function MealPlanSectionEditor({
  recordId,
  onSaved,
}: {
  recordId: number | null;
  onSaved: (signal: AbortSignal) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const valid = recordId === null || Number.isInteger(recordId);

  const data = useQuery({
    queryKey: ["mealplan-section-editor", recordId],
    queryFn: ({ signal }) => getMealPlanSectionContext(recordId, signal),
    enabled: valid,
    retry: false,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const [initial, setInitial] = useState<{ section: MealPlanSection | null }>();

  if (!initial && data.isSuccess && !data.isFetching) setInitial(data.data);
  const title = recordId === null ? "Create meal plan section" : "Edit meal plan section";

  return (
    <>
      <PageHeader title={t(title)} />
      {!valid ? <ErrorBlock message={t("Object not found")} /> : null}
      {data.error ? (
        <>
          <ErrorBlock message={data.error.message} />
          <button
            className="btn"
            onClick={() => {
              void data.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {valid && !initial && !data.error ? <LoadingBlock /> : null}
      {initial ? <SectionFields record={initial.section} title={title} onSaved={onSaved} /> : null}
    </>
  );
}

function SectionFields({
  record,
  title,
  onSaved,
}: {
  record: MealPlanSection | null;
  title: string;
  onSaved: (signal: AbortSignal) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const nativeDocument = useDocumentTasks();
  const id = useId();
  const [name, setName] = useState(record?.name ?? "");

  const [sort, setSort] = useState(
    record?.sort_number && record.sort_number !== "0" ? String(record.sort_number) : "",
  );

  const [time, setTime] = useState(record?.time_info ?? "");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const owner = useRef<AbortController>(undefined);
  const saving = useRef(false);
  useEffect(() => {
    const scope = new AbortController();
    owner.current = scope;
    const timer = window.setTimeout(() => input.current?.focus(), 500);

    return () => {
      scope.abort();
      window.clearTimeout(timer);
      document.body.classList.remove("cursor-busy");
    };
  }, []);
  useEffect(() => {
    document.body.classList.toggle("cursor-busy", busy);

    return () => document.body.classList.remove("cursor-busy");
  }, [busy]);

  const save = async (body: { name: string; sort_number: string; time_info: string }) => {
    const formOwner = owner.current;

    if (!formOwner || saving.current) return;
    const task = nativeDocument.capture();
    const signal = AbortSignal.any([task.signal, formOwner.signal]);
    signal.throwIfAborted();
    saving.current = true;
    setBusy(true);
    document.body.classList.add("cursor-busy");

    try {
      await request(
        record ? `/api/objects/meal_plan_sections/${record.id}` : "/api/objects/meal_plan_sections",
        { method: record ? "PUT" : "POST", body: JSON.stringify(body), signal },
      );
      signal.throwIfAborted();
    } catch (error) {
      if (!signal.aborted) {
        saving.current = false;
        setBusy(false);
        document.body.classList.remove("cursor-busy");
        task.genericError(
          "Error while saving, probably this item already exists",
          error instanceof Error ? error : undefined,
        );
      }

      return;
    } finally {
      void invalidateMealPlanSections(client);
    }

    if (!signal.aborted) await onSaved(signal);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (busy || !event.currentTarget.reportValidity()) return;
    const sortInput = document.getElementById(`${id}-sort`);
    const timeInput = event.currentTarget.elements.namedItem("time_info");
    void save({
      name: input.current?.value ?? name,
      sort_number: sortInput instanceof HTMLInputElement ? sortInput.value : "",
      time_info: timeInput instanceof HTMLInputElement ? timeInput.value : "",
    });
  };

  return (
    <form
      className="move-form household-editor"
      aria-label={t(title)}
      onSubmit={submit}
      onKeyDown={(event) => {
        // The native Enter handler clicks a nonexistent plural button ID.
        if (event.key === "Enter" && event.target instanceof HTMLInputElement)
          event.preventDefault();
      }}
    >
      <fieldset disabled={busy}>
        <label className="field">
          {t("Name")}
          <input
            ref={input}
            name="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field" htmlFor={`${id}-sort`}>
          {t("Sort number")}
        </label>
        <NumberPicker
          id={`${id}-sort`}
          label="Sort number"
          value={sort}
          onChange={setSort}
          min={0}
          step="1"
        />
        <span className="field-hint">
          {t("Sections will be ordered by that number on the meal plan")}
        </span>
        <label className="field">
          {t("Time")}
          <input
            type="time"
            name="time_info"
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary">
          {t("Save")}
        </button>
      </fieldset>
    </form>
  );
}
