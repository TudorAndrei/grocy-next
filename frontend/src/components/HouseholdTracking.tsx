import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { currentUserQuery } from "@/hooks/queries";
import { useFeatures } from "@/lib/features";
import { request } from "@/lib/api";
import { useDocumentTasks } from "@/lib/document-tasks";
import { saveNativeObjectFields } from "@/lib/native-object-fields";
import { useI18n } from "@/lib/i18n";
import { nativeUserfieldDateNow } from "@/lib/native-userfield-dates";
import { useNativeTrackingCard } from "@/lib/native-tracking-card";
import { initialUserfields, userfieldsQuery, type UserfieldDefinition } from "@/lib/userfields";
import {
  getTrackingDetails,
  getTrackingRecords,
  getTrackingUsers,
  invalidateNativeTracking,
  recordTracking,
  undoTracking,
  type TrackingKind,
  type TrackingRecord,
  type TrackingUser,
} from "@/lib/household-tracking";
import { PageHeader } from "./PageHeader";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";
import { UserfieldsEditor, type UserfieldsEditorHandle } from "./UserfieldsEditor";
import { HouseholdRecordPicker, type HouseholdRecordPickerHandle } from "./HouseholdRecordPicker";
import { NativeTrackingCard } from "./NativeTrackingCard";
import { useNotify } from "./Toaster";
import { UserPicker } from "./UserPicker";
import { EmbeddedPageDialog, type EmbeddedPage } from "./EmbeddedPageDialog";
import { NativeMainDateInput, type NativeMainDateHandle } from "./NativeMainDateInput";

type TrackingBooking = { id: number; record: TrackingRecord };

export function HouseholdTracking({ kind }: { kind: TrackingKind }) {
  const { t } = useI18n();

  const records = useQuery({
    queryKey: ["tracking-records", kind],
    queryFn: () => getTrackingRecords(kind),
  });

  const fields = useQuery(userfieldsQuery);

  const users = useQuery({
    queryKey: ["tracking-users"],
    queryFn: getTrackingUsers,
    enabled: kind === "chore",
  });

  const actor = useQuery({ ...currentUserQuery(), enabled: kind === "chore" });

  const error =
    records.error ?? fields.error ?? (kind === "chore" ? (users.error ?? actor.error) : null);

  const ready =
    records.isSuccess &&
    fields.isSuccess &&
    (kind === "battery" || (users.isSuccess && actor.isSuccess));

  return (
    <>
      <PageHeader title={t(kind === "chore" ? "Chore tracking" : "Battery tracking")} />
      {error ? (
        <>
          <ErrorBlock message={error.message} />
          <button
            className="btn"
            onClick={() => {
              void records.refetch();
              void fields.refetch();

              if (kind === "chore") {
                void users.refetch();
                void actor.refetch();
              }
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {!ready && !error ? <LoadingBlock /> : null}
      {ready ? (
        <TrackingForm
          key={kind}
          kind={kind}
          records={records.data}
          users={users.data ?? []}
          userId={String(actor.data?.id ?? "")}
          fields={fields.data.filter(
            (field) => field.entity === (kind === "chore" ? "chores_log" : "battery_charge_cycles"),
          )}
        />
      ) : null}
    </>
  );
}

function TrackingForm({
  kind,
  records,
  fields,
  users,
  userId,
}: {
  kind: TrackingKind;
  records: TrackingRecord[];
  fields: UserfieldDefinition[];
  users: TrackingUser[];
  userId: string;
}) {
  const { t } = useI18n();
  const features = useFeatures();
  const client = useQueryClient();
  const documentTasks = useDocumentTasks();
  const notify = useNotify();
  const id = useId();
  const picker = useRef<HTMLInputElement>(null);
  const recordPicker = useRef<HouseholdRecordPickerHandle>(null);
  const time = useRef<HTMLInputElement>(null);
  const timePicker = useRef<NativeMainDateHandle>(null);
  const selectedInput = useRef<HTMLInputElement>(null);
  const userInput = useRef<HTMLInputElement>(null);
  const userfields = useRef<UserfieldsEditorHandle>(null);
  const [selected, setSelected] = useState<number>();
  const [tracked, setTracked] = useState("");
  const [validTime, setValidTime] = useState(true);
  const [doneBy, setDoneBy] = useState(userId);
  const [journal, setJournal] = useState<EmbeddedPage>();
  // These hosts never invoke the common Userfields.Load or Clear stages.
  const [values, setValues] = useState(() => initialUserfields(fields, {}, false));
  const [busy, setBusy] = useState(false);
  const [manualSkip, setManualSkip] = useState(false);
  const scope = useRef<AbortController>(undefined);
  const startup = useRef(true);
  const focusTimers = useRef(new Set<number>());
  const saving = useRef(false);
  const assignments = kind === "chore" && features.enabled("CHORES_ASSIGNMENTS");

  const { card, refresh: refreshCard, refreshedAt } = useNativeTrackingCard(kind);

  useEffect(() => {
    const owner = new AbortController();
    scope.current = owner;
    const timeInput = time.current;
    const selectTime = () => timeInput?.select();
    timeInput?.addEventListener("focus", selectTime);

    const pendingFocus = focusTimers.current;

    const timer = window.setTimeout(() => {
      startup.current = false;
    }, 1000);

    return () => {
      owner.abort();
      timeInput?.removeEventListener("focus", selectTime);
      window.clearTimeout(timer);

      for (const pending of pendingFocus) window.clearTimeout(pending);
      document.body.classList.remove("cursor-busy");
    };
  }, []);

  const readTime = () => timePicker.current?.GetValue() ?? time.current?.value ?? tracked;

  const focusDelay = () => (startup.current ? 500 : 0);

  const commitSelection = (record: TrackingRecord) => {
    const owner = scope.current;

    const signal = owner
      ? AbortSignal.any([documentTasks.capture().signal, owner.signal])
      : undefined;

    if (kind === "chore" && signal) {
      // Each explicit selection is independent, including a repeated Grocycode.
      void request(`/api/objects/chores/${record.id}`, { signal })
        .then((result) => {
          if (signal.aborted) return;

          const current = z
            .object({ track_date_only: z.coerce.number(), period_type: z.string().nullable() })
            .parse(result);

          const onlyDate = current.track_date_only === 1;

          timePicker.current?.ChangeFormat(onlyDate ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm:ss");
          timePicker.current?.SetValue(
            nativeUserfieldDateNow(t("moment_locale"), onlyDate ? "date" : "datetime"),
          );
          setManualSkip(current.period_type === "manually");
        })
        .catch((error: Error) => {
          if (!signal.aborted) console.error(error);
        });
    }

    refreshCard(String(record.id));

    const timer = window.setTimeout(() => {
      focusTimers.current.delete(timer);

      if (!signal?.aborted) time.current?.focus();
    }, focusDelay());

    focusTimers.current.add(timer);
  };

  const endBusy = () => {
    saving.current = false;
    setBusy(false);
    document.body.classList.remove("cursor-busy");
  };

  const save = async (skipped: boolean) => {
    const owner = scope.current;
    const recordId = Number(selectedInput.current?.value ?? selected);

    if (
      !owner ||
      owner.signal.aborted ||
      saving.current ||
      !Number.isInteger(recordId) ||
      recordId <= 0
    )
      return;
    const task = documentTasks.capture();
    const signal = AbortSignal.any([task.signal, owner.signal]);
    const settle = () => invalidateNativeTracking(client, kind);
    saving.current = true;
    setBusy(true);
    document.body.classList.add("cursor-busy");
    let booking: TrackingBooking;

    try {
      const current = await getTrackingDetails(kind, recordId, signal);
      signal.throwIfAborted();
      let result: Awaited<ReturnType<typeof recordTracking>>;

      try {
        result = await recordTracking(
          kind,
          recordId,
          kind === "chore"
            ? { tracked_time: readTime(), done_by: userInput.current?.value ?? doneBy, skipped }
            : { tracked_time: readTime() },
          signal,
        );
        signal.throwIfAborted();
      } finally {
        settle();
      }

      booking = { id: result.id, record: current.record };
    } catch (error) {
      if (!signal.aborted) {
        endBusy();
        console.error(error);
      }

      return;
    }

    try {
      // Native Save leaves the controls in place, including edits made while the primary ran.
      const snapshot = userfields.current?.snapshot() ?? values;
      setValues(snapshot);
      await saveNativeObjectFields({
        namespace: kind === "chore" ? "chores_log" : "battery_charge_cycles",
        id: booking.id,
        fields,
        readEdits: () => snapshot,
        fileError: (error) => {
          if (!signal.aborted)
            task.genericError("Error while saving, probably this item already exists", error);
        },
        signal,
        settled: settle,
      });
      signal.throwIfAborted();
    } catch {
      // Last metadata failure has no callback; file errors report above. Both stay busy.
      return;
    }

    endBusy();
    notify({
      message: t(
        kind === "chore"
          ? "Tracked execution of chore %1$s on %2$s"
          : "Tracked charge cycle of battery %1$s on %2$s",
        booking.record.name ?? "",
        readTime(),
      ),
      undo: async () => {
        const undoOwner = scope.current;

        if (!undoOwner || undoOwner.signal.aborted) return;
        const undoTask = documentTasks.capture();
        const undoSignal = AbortSignal.any([undoTask.signal, undoOwner.signal]);

        try {
          undoSignal.throwIfAborted();

          try {
            await undoTracking(kind, booking.id, undoSignal);
          } finally {
            settle();
          }

          undoSignal.throwIfAborted();
          notify({
            message: t(
              kind === "chore"
                ? "Chore execution successfully undone"
                : "Charge cycle successfully undone",
            ),
          });
        } catch (error) {
          if (!undoSignal.aborted) console.error(error);
        }
      },
    });
    refreshCard(recordPicker.current?.GetValue() ?? "");
    setSelected(undefined);
    recordPicker.current?.ResetAfterBooking();
    // The picker clears, but an existing Chore date-only format remains installed.
    const now = nativeUserfieldDateNow(t("moment_locale"), "datetime");

    if (kind === "chore") timePicker.current?.SetValue(now);
    else {
      // The source assigns raw text even when React already holds the same reset value.
      if (time.current) time.current.value = now;
      setTracked(now);
    }

    requestAnimationFrame(() => {
      if (!signal.aborted) picker.current?.focus();
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      selected !== undefined &&
      validTime &&
      !document.querySelector(".combobox-menu-visible") &&
      event.currentTarget.reportValidity()
    )
      void save(false);
  };

  return (
    <div className="transfer-layout">
      <form
        className="move-form transfer-form household-tracking-form"
        aria-label={t(kind === "chore" ? "Chore tracking" : "Battery tracking")}
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
          event.preventDefault();
          event.currentTarget.classList.add("was-validated");

          if (event.currentTarget.checkValidity())
            event.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
        }}
      >
        <fieldset disabled={busy}>
          <input ref={userInput} type="hidden" name="user_id" value={doneBy} />
          <HouseholdRecordPicker
            ref={recordPicker}
            id={`${id}-record`}
            kind={kind}
            records={records}
            value={selected === undefined ? "" : String(selected)}
            disabled={busy}
            inputRef={picker}
            selectedInputRef={selectedInput}
            focusDelay={focusDelay}
            onChange={(value) => setSelected(value ? Number(value) : undefined)}
            onCommit={commitSelection}
            onFocusNext={() => time.current?.focus()}
          />
          <NativeMainDateInput
            ref={timePicker}
            inputRef={time}
            id={`${id}-tracked-time`}
            caption={t("Tracked time")}
            required
            initWithNow
            limitEndToNow={kind === "battery"}
            showInitialContext
            value={tracked}
            onChange={(value) => {
              setTracked(value);
              setValidTime(time.current?.validity.valid ?? false);
            }}
          />
          {!validTime && tracked ? (
            <p className="field-hint">
              {t(kind === "battery" ? "This can only be before now" : "A date is required")}
            </p>
          ) : null}
          {assignments ? (
            <UserPicker
              label={t("Done by")}
              users={users}
              value={doneBy}
              onChange={setDoneBy}
              disabled={busy}
            />
          ) : null}
        </fieldset>
        <UserfieldsEditor
          ref={userfields}
          fields={fields}
          values={values}
          creating={false}
          nativeFiles
          nativeDirty
          nativeUnloaded
          disabled={busy}
          onChange={(name, edit) => setValues((current) => ({ ...current, [name]: edit }))}
        />
        <div className="actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={selected === undefined || !validTime || busy}
          >
            {t("OK")}
          </button>
          {kind === "chore" ? (
            <button
              type="button"
              className={`btn${manualSkip ? " disabled" : ""}`}
              style={manualSkip ? { pointerEvents: "none", opacity: 0.65 } : undefined}
              disabled={selected === undefined || !validTime || busy}
              onClick={(event) => {
                if (
                  selected !== undefined &&
                  validTime &&
                  !document.querySelector(".combobox-menu-visible") &&
                  event.currentTarget.form?.reportValidity()
                )
                  void save(true);
              }}
            >
              {t("Skip")}
            </button>
          ) : null}
        </div>
      </form>
      <NativeTrackingCard
        kind={kind}
        card={card}
        refreshedAt={refreshedAt}
        assignments={assignments}
        onJournal={(recordId, url) => setJournal({ id: recordId, url, dialogType: "table" })}
      />
      {journal ? <EmbeddedPageDialog page={journal} onClose={() => setJournal(undefined)} /> : null}
    </div>
  );
}
