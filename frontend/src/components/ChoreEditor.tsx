import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDocumentTasks } from "@/lib/document-tasks";
import { useNativeLabelPrint } from "@/hooks/useNativeLabelPrint";
import {
  saveNativeHouseholdObject,
  invalidateNativeHouseholdObject,
} from "@/lib/native-household-save";
import { userSettingsQuery } from "@/hooks/queries";
import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  choreAssignments,
  chorePeriods,
  choreWeekdays,
  calculateChoreAssignments,
  getChoreForm,
  getChoreProductBarcodes,
  type ChoreFormContext,
} from "@/lib/chore-form";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import type { JsonObject } from "@/lib/json";
import { usePreferences } from "@/lib/preferences";
import { initialUserfields, userfieldsQuery, type UserfieldDefinition } from "@/lib/userfields";
import { fetchApiDocument } from "@/lib/open-document";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { PageHeader } from "./PageHeader";
import { NumberPicker } from "./NumberPicker";
import { ProductPicker } from "./ProductPicker";
import { UserfieldsEditor, type UserfieldsEditorHandle } from "./UserfieldsEditor";
import { NativeUserfieldsLoad } from "./NativeUserfieldsLoad";
import { NativeMainDateInput, type NativeMainDateHandle } from "./NativeMainDateInput";

export function ChoreEditor({ choreId }: { choreId: string }) {
  const { t } = useI18n();

  const context = useQuery({
    queryKey: ["chore-editor", choreId],
    queryFn: ({ signal }) => getChoreForm(choreId, signal),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const fields = useQuery(userfieldsQuery);
  const settings = useQuery(userSettingsQuery());
  const failure = context.error ?? fields.error ?? settings.error;

  return (
    <>
      <PageHeader title={t(choreId === "new" ? "Create chore" : "Edit chore")} />
      {failure ? (
        <>
          <ErrorBlock message={failure.message} />
          <button
            className="btn"
            onClick={() => {
              void context.refetch();
              void fields.refetch();
              void settings.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {!failure && (!context.isSuccess || !fields.isSuccess || !settings.isSuccess) ? (
        <LoadingBlock />
      ) : null}
      {context.isSuccess && fields.isSuccess && settings.isSuccess ? (
        <ChoreFields
          key={choreId}
          context={context.data}
          fields={fields.data.filter((field) => field.entity === "chores")}
        />
      ) : null}
    </>
  );
}

function ChoreFields({
  context,
  fields,
}: {
  context: ChoreFormContext;
  fields: UserfieldDefinition[];
}) {
  const { t } = useI18n();
  const features = useFeatures();
  const nativeDocument = useDocumentTasks();
  const preferences = usePreferences();
  const navigate = useNavigate();
  const client = useQueryClient();
  const prefix = useId();
  const chore = context.chore;
  const assignmentsEnabled = features.enabled("CHORES_ASSIGNMENTS");
  const stockEnabled = features.enabled("STOCK");
  const form = useRef<HTMLFormElement>(null);
  const primaryFields = useRef<HTMLFieldSetElement>(null);
  const startPicker = useRef<NativeMainDateHandle>(null);
  const startInput = useRef<HTMLInputElement>(null);
  const [validStart, setValidStart] = useState(true);
  const userfields = useRef<UserfieldsEditorHandle>(null);
  const [busy, setBusy] = useState(false);
  const [cursorBusy, setCursorBusy] = useState(false);
  const saving = useRef(false);
  const [restored, setRestored] = useState({ product: false, assignment: false, start: false });
  const [pickerBusy, setPickerBusy] = useState(false);
  const [workflowBusy, setWorkflowBusy] = useState(false);

  const barcodes = useQuery({
    queryKey: ["objects", "product_barcodes_view", "chore-editor"],
    queryFn: ({ signal }) => getChoreProductBarcodes(signal),
    enabled: stockEnabled,
    retry: false,
  });

  const amountStep =
    preferences.amountPrecision === 0 ? "1" : `0.${"0".repeat(preferences.amountPrecision - 1)}1`;

  const initialPeriod = chore?.period_type ?? "hourly";
  const fixedPeriod = initialPeriod === "manually" || initialPeriod === "adaptive";

  const [values, setValues] = useState({
    name: chore?.name ?? "",
    description: chore?.description ?? "",
    active: chore === null || Number(chore.active) === 1,
    period: initialPeriod,
    days: ["manually", "daily", "weekly", "yearly", "adaptive"].includes(initialPeriod)
      ? "1"
      : String(chore?.period_days ?? 0),
    interval: fixedPeriod ? "1" : String(chore?.period_interval ?? 1),
    weekdays: (chore?.period_config ?? "").split(","),
    start: context.initial_start_date,
    assignment: chore?.assignment_type ?? "in-alphabetical-order",
    users: (chore?.assignment_config ?? "").split(","),
    dateOnly: chore?.track_date_only === 1,
    rollover: chore?.rollover === 1,
    consume: chore?.consume_product_on_execution === 1,
    product:
      chore?.product_id === null || chore?.product_id === undefined ? "" : String(chore.product_id),
    amount:
      chore?.product_amount === null || chore?.product_amount === undefined
        ? ""
        : chore.product_amount.toLocaleString("en", {
            minimumFractionDigits: 0,
            maximumFractionDigits: preferences.amountPrecision,
            useGrouping: false,
          }),
  });

  const [custom, setCustom] = useState(() => initialUserfields(fields, {}, false));

  const [amountUnit, setAmountUnit] = useState(
    () =>
      context.products.find((product) => product.id === chore?.product_id)?.stock_unit_name ?? "",
  );

  const [monthBounds, setMonthBounds] = useState(initialPeriod === "monthly");
  const controller = useRef<AbortController>(undefined);
  useEffect(() => {
    const pending = new AbortController();
    controller.current = pending;

    return () => {
      pending.abort();
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("cursor-busy", cursorBusy);

    return () => document.body.classList.remove("cursor-busy");
  }, [cursorBusy]);

  const submitNative = async () => {
    const owner = controller.current;

    if (!owner || saving.current) return;
    const task = nativeDocument.capture();
    const signal = AbortSignal.any([task.signal, owner.signal]);
    signal.throwIfAborted();
    const body: JsonObject = {};

    for (const control of primaryFields.current?.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("input[name], textarea[name], select[name]") ?? []) {
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

    // DateTimePicker.GetValue reads even the history-disabled date input.
    body.start_date = startPicker.current?.GetValue() ?? startInput.current?.value ?? values.start;

    if (assignmentsEnabled) {
      const select = primaryFields.current?.querySelector<HTMLSelectElement>(
        '[name="assignment_config"]',
      );

      body.assignment_config = Array.from(
        select?.selectedOptions ?? [],
        (option) => option.value,
      ).join(",");
    }

    saving.current = true;
    setBusy(true);
    setCursorBusy(true);

    const identity = await saveNativeHouseholdObject({
      client,
      entity: "chores",
      recordId: chore?.id ?? null,
      body,
      fields,
      readEdits: () => userfields.current?.snapshot() ?? custom,
      primaryError: (error) => {
        saving.current = false;
        setBusy(false);
        setCursorBusy(false);
        setRestored({ product: true, assignment: true, start: true });
        task.genericError("Error while saving, probably this item already exists", error);
      },
      fileError: (error) =>
        task.genericError("Error while saving, probably this item already exists", error),
      signal,
    });

    if (!identity || signal.aborted) return;

    try {
      await calculateChoreAssignments(identity.wireId, signal);
      signal.throwIfAborted();
    } catch (error) {
      if (!signal.aborted) {
        setCursorBusy(false);
        console.error(error);
      }

      return;
    } finally {
      invalidateNativeHouseholdObject(client, "chores");
    }

    if (!signal.aborted) await navigate({ href: "/chores" });
  };

  const setPeriod = (period: typeof values.period) => {
    if (period === "monthly") setMonthBounds(true);
    setValues((current) => ({
      ...current,
      period,
      days: ["manually", "daily", "weekly", "yearly", "adaptive"].includes(period)
        ? "1"
        : current.days,
      interval: period === "manually" || period === "adaptive" ? "1" : current.interval,
    }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      validStart &&
      !pickerBusy &&
      !workflowBusy &&
      !document.querySelector(".combobox-menu-visible") &&
      event.currentTarget.reportValidity()
    )
      void submitNative();
  };

  const scheduled = values.period !== "manually" && values.period !== "adaptive";

  const scheduleInfo = {
    manually: "This means the next execution of this chore is not scheduled",
    hourly:
      Number(values.interval) === 1
        ? "This means the next execution of this chore is scheduled %s hour after the last execution"
        : "This means the next execution of this chore is scheduled %s hours after the last execution",
    daily:
      Number(values.interval) === 1
        ? "This means the next execution of this chore is scheduled at the same time (based on the start date) every day"
        : "This means the next execution of this chore is scheduled at the same time (based on the start date) every %s days",
    weekly:
      Number(values.interval) === 1
        ? "This means the next execution of this chore is scheduled every week on the selected weekdays"
        : "This means the next execution of this chore is scheduled every %s weeks on the selected weekdays",
    monthly:
      Number(values.interval) === 1
        ? "This means the next execution of this chore is scheduled on the selected day every month"
        : "This means the next execution of this chore is scheduled on the selected day every %s months",
    yearly:
      Number(values.interval) === 1
        ? "This means the next execution of this chore is scheduled every year on the same day (based on the start date)"
        : "This means the next execution of this chore is scheduled every %s years on the same day (based on the start date)",
    adaptive:
      "This means the next execution of this chore is scheduled dynamically based on the past average execution frequency",
  };

  const assignmentInfo = {
    "no-assignment": "This means the next execution of this chore will not be assigned to anyone",
    random: "This means the next execution of this chore will be assigned randomly",
    "in-alphabetical-order":
      "This means the next execution of this chore will be assigned to the next one in alphabetical order",
    "who-least-did-first":
      "This means the next execution of this chore will be assigned to the one who executed it least",
  };

  return (
    <div className="transfer-layout">
      <form
        ref={form}
        className="transfer-form household-tracking-form household-editor"
        aria-label={t(chore ? "Edit chore" : "Create chore")}
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
            validStart &&
            !pickerBusy &&
            !workflowBusy &&
            !document.querySelector(".combobox-menu-visible") &&
            event.currentTarget.reportValidity()
          )
            void submitNative();
        }}
        noValidate
      >
        <fieldset ref={primaryFields} disabled={busy}>
          <label className="field">
            {t("Name")}
            <input
              name="name"
              autoFocus
              required
              value={values.name}
              onChange={(event) => setValues({ ...values, name: event.target.value })}
            />
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              name="active"
              checked={values.active}
              onChange={(event) => setValues({ ...values, active: event.target.checked })}
            />
            {t("Active")}
          </label>
          <label className="field">
            {t("Description")}
            <textarea
              name="description"
              rows={2}
              value={values.description}
              onChange={(event) => setValues({ ...values, description: event.target.value })}
            />
          </label>
          <label className="field">
            {t("Period type")}
            <select
              name="period_type"
              required
              value={values.period}
              onChange={(event) =>
                setPeriod(chorePeriods.find((period) => period === event.target.value) ?? "hourly")
              }
            >
              {chorePeriods.map((period) => (
                <option key={period} value={period}>
                  {t(period)}
                </option>
              ))}
            </select>
          </label>
          <div hidden={values.period !== "monthly"}>
            <label className="field" htmlFor={`${prefix}-days`}>
              {t("Day of month")}
              <NumberPicker
                id={`${prefix}-days`}
                name="period_days"
                label={t("Day of month")}
                value={values.days}
                required
                min={monthBounds ? 1 : 0}
                max={monthBounds ? 31 : undefined}
                step="1"
                onChange={(days) => setValues({ ...values, days })}
              />
            </label>
          </div>
          {values.period === "weekly" ? (
            <fieldset>
              <legend>{t("Weekdays")}</legend>
              {choreWeekdays.map((day) => (
                <label className="check-field" key={day}>
                  <input
                    type="checkbox"
                    checked={values.weekdays.includes(day)}
                    onChange={(event) =>
                      setValues({
                        ...values,
                        weekdays: event.target.checked
                          ? [...values.weekdays, day]
                          : values.weekdays.filter((value) => value !== day),
                      })
                    }
                  />
                  {t(day[0].toUpperCase() + day.slice(1))}
                </label>
              ))}
            </fieldset>
          ) : null}
          <div hidden={!scheduled}>
            <label className="field" htmlFor={`${prefix}-interval`}>
              {t("Period interval")}
              <NumberPicker
                id={`${prefix}-interval`}
                name="period_interval"
                label={t("Period interval")}
                value={values.interval}
                required
                min={1}
                step="1"
                onChange={(interval) => setValues({ ...values, interval })}
              />
            </label>
          </div>
          <input
            type="hidden"
            name="period_config"
            value={
              values.period === "weekly"
                ? choreWeekdays.filter((day) => values.weekdays.includes(day)).join(",")
                : ""
            }
          />
          <p className="field-hint">{t(scheduleInfo[values.period], values.interval)}</p>
          <div className="field">
            <NativeMainDateInput
              ref={startPicker}
              inputRef={startInput}
              id={`${prefix}-start`}
              ariaDescribedBy={`${prefix}-start-hint`}
              caption={t("Start date")}
              required
              initWithNow
              initialValue={context.initial_start_date}
              disabled={context.has_history && !restored.start}
              value={values.start}
              onChange={(value) => {
                setValues((current) => ({ ...current, start: value }));
                setValidStart(startInput.current?.validity.valid ?? false);
              }}
            />
            <span id={`${prefix}-start-hint`} className="field-hint">
              {t("The start date cannot be changed when the chore was once tracked")}
            </span>
          </div>
          {!validStart ? <p className="field-hint">{t("A start date is required")}</p> : null}
          {assignmentsEnabled ? (
            <>
              <label className="field">
                {t("Assignment type")}
                <select
                  name="assignment_type"
                  value={values.assignment}
                  onChange={(event) => {
                    setRestored((current) => ({ ...current, assignment: false }));
                    setValues({
                      ...values,
                      assignment:
                        choreAssignments.find((assignment) => assignment === event.target.value) ??
                        "in-alphabetical-order",
                    });
                  }}
                >
                  {choreAssignments.map((assignment) => (
                    <option value={assignment} key={assignment}>
                      {t(assignment)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {t("Assign to")}
                <select
                  name="assignment_config"
                  multiple
                  required={values.assignment !== "no-assignment"}
                  disabled={values.assignment === "no-assignment" && !restored.assignment}
                  value={values.users}
                  onChange={(event) =>
                    setValues({
                      ...values,
                      users: Array.from(event.target.selectedOptions, (option) => option.value),
                    })
                  }
                >
                  {context.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.display_name ?? user.username}
                    </option>
                  ))}
                </select>
              </label>
              {values.assignment !== "no-assignment" ? (
                <div className="actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() =>
                      setValues({ ...values, users: context.users.map((user) => String(user.id)) })
                    }
                  >
                    {t("Select all")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => setValues({ ...values, users: [] })}
                  >
                    {t("Deselect all")}
                  </button>
                </div>
              ) : null}
              <p className="field-hint">{t(assignmentInfo[values.assignment] ?? "")}</p>
            </>
          ) : (
            <>
              <input type="hidden" name="assignment_type" value="no-assignment" />
              <input type="hidden" name="assignment_config" value="" />
            </>
          )}
          <label className="check-field">
            <input
              type="checkbox"
              name="track_date_only"
              checked={values.dateOnly}
              onChange={(event) => setValues({ ...values, dateOnly: event.target.checked })}
            />
            {t("Track date only")}
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              name="rollover"
              checked={values.rollover}
              onChange={(event) => setValues({ ...values, rollover: event.target.checked })}
            />
            {t("Due date rollover")}
          </label>
          {stockEnabled ? (
            <>
              <label className="check-field">
                <input
                  type="checkbox"
                  name="consume_product_on_execution"
                  checked={values.consume}
                  onChange={(event) => {
                    setRestored((current) => ({ ...current, product: false }));
                    setValues({ ...values, consume: event.target.checked });
                  }}
                />
                {t("Consume product on chore execution")}
              </label>
              <ProductPicker
                products={context.products.map((item) => ({ id: item.id, name: item.name ?? "" }))}
                barcodes={barcodes.data ?? []}
                plugin=""
                value={values.product}
                required={false}
                disabled={busy || (!values.consume && !restored.product) || !barcodes.isSuccess}
                lookupDisabled={false}
                autoFocus={false}
                allowCreate={false}
                disallowAllProductWorkflows
                deferSelection
                onChange={(product) => {
                  setValues((current) => ({ ...current, product }));
                  const selected = context.products.find((row) => String(row.id) === product);

                  if (selected) setAmountUnit(selected.stock_unit_name ?? "");
                }}
                onResolved={() =>
                  form.current?.querySelector<HTMLInputElement>(`[id="${prefix}-amount"]`)?.focus()
                }
                onAssignBarcode={() => {}}
                onBusyChange={setPickerBusy}
                onFormBusyChange={setWorkflowBusy}
              />
              <input
                type="hidden"
                name="product_id"
                value={values.product}
                disabled={(!values.consume && !restored.product) || !barcodes.isSuccess}
              />
              {barcodes.error ? (
                <>
                  <ErrorBlock message={barcodes.error.message} />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      void barcodes.refetch();
                    }}
                  >
                    {t("Retry")}
                  </button>
                </>
              ) : null}
              <div className="field">
                <label htmlFor={`${prefix}-amount`}>{t("Amount")}</label>
                <NumberPicker
                  id={`${prefix}-amount`}
                  name="product_amount"
                  label={t("Amount")}
                  disabled={!values.consume && !restored.product}
                  value={values.amount}
                  min={amountStep}
                  step={amountStep}
                  onChange={(amount) => setValues({ ...values, amount })}
                />
                <span className="field-hint">{amountUnit}</span>
              </div>
            </>
          ) : null}
        </fieldset>
        <UserfieldsEditor
          ref={userfields}
          nativeFiles
          nativeDirty
          nativeLoadPending
          fields={fields}
          values={custom}
          creating={chore === null}
          disabled={busy}
          onChange={(name, edit) => setCustom((current) => ({ ...current, [name]: edit }))}
        />
        <NativeUserfieldsLoad
          namespace="chores"
          objectId={chore?.id ?? null}
          fieldCount={fields.length}
          editor={userfields}
        />
        <div className="actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {t("Save")}
          </button>
        </div>
      </form>
      {chore ? (
        <aside className="panel" aria-label={t("Grocycode")}>
          <h2>{t("Grocycode")}</h2>
          <ChoreCode id={chore.id} name={values.name} />
        </aside>
      ) : null}
    </div>
  );
}

function ChoreCode({ id, name }: { id: number; name: string }) {
  const { t } = useI18n();
  const features = useFeatures();
  const router = useRouter();
  const print = useNativeLabelPrint();
  const root = router.buildLocation({ to: "/", search: {} }).publicHref.replace(/\/+$/, "");
  const [image, setImage] = useState<string>();
  const [error, setError] = useState<Error>();

  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    void fetchApiDocument(`/chore/${id}/grocycode?size=60`, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage(url);
      })
      .catch((failure: Error) => {
        if (!controller.signal.aborted) setError(failure);
      });

    return () => {
      controller.abort();

      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  return (
    <>
      {error ? <ErrorBlock message={error.message} /> : null}
      {image ? <img src={image} alt={name} /> : !error ? <LoadingBlock /> : null}
      <div className="actions">
        <a className="btn btn-ghost" href={`${root}/chore/${id}/grocycode?download=true`}>
          {t("Download")}
        </a>
        {features.enabled("LABEL_PRINTER") ? (
          <a
            href="#"
            className="btn btn-ghost chore-grocycode-label-print"
            data-chore-id={id}
            onClick={(event) => {
              event.preventDefault();
              print(`/api/chores/${id}/printlabel`);
            }}
          >
            {t("Print on label printer")}
          </a>
        ) : null}
      </div>
    </>
  );
}
