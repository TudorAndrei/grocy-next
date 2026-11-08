import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useModalDialog } from "@/hooks/useModalDialog";
import { userSettingsQuery } from "@/hooks/queries";
import { useInvalidateStock } from "@/lib/catalog";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { isoDay } from "@/lib/format";
import { usePreferences } from "@/lib/preferences";
import { printLabel, printNativeLabel } from "@/lib/printing";
import type { JsonObject } from "@/lib/json";
import {
  getEntryEditor,
  getNativeEntryEditor,
  getNativeEntryUnit,
  invalidateNativeEntry,
  saveStockEntry,
  type EntryBookings,
  type EntryEditor,
} from "@/lib/stock-entry-editor";
import { initialUserfields, saveUserfields, userfieldUpload } from "@/lib/userfields";
import { saveCustomObjectFields } from "@/lib/custom-object-form";
import { useGenericError } from "@/hooks/useGenericError";
import { getTopmostGrocyWindow } from "@/lib/embedded-window";
import { tableText } from "@/lib/native-table-cell";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { NumberPicker } from "./NumberPicker";
import { BookingDateInput } from "./BookingDateInput";
import { NativeMainDateInput } from "./NativeMainDateInput";
import { NativeDateTimeInput } from "./NativeDateTimeInput";
import { UserfieldsEditor, type UserfieldsEditorHandle } from "./UserfieldsEditor";
import { NativeUserfieldsLoad } from "./NativeUserfieldsLoad";
import { useNotify } from "./Toaster";

type Props = {
  entryId: number;
  revision?: number;
  onSaved: (bookings: EntryBookings) => Promise<void> | void;
  onCancel: () => void;
  onPendingChange?: (pending: boolean) => void;
};

export function StockEntryDialog(props: Omit<Props, "onPendingChange">) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const title = useId();

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog stock-entry-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();

        props.onCancel();
      }}
    >
      <h2 id={title}>{t("Edit stock entry")}</h2>
      <StockEntryEditor
        {...props}
        onSaved={async (bookings) => {
          if (dialog.current?.open) await props.onSaved(bookings);
        }}
      />
    </dialog>
  );
}

export function StockEntryEditor(props: Props) {
  const { t } = useI18n();
  const settings = useQuery(userSettingsQuery());

  const data = useQuery({
    queryKey: ["stock-entry-editor", props.entryId, props.revision ?? 0],
    queryFn: ({ signal }) => getEntryEditor(props.entryId, signal),
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (data.isSuccess && data.isFetchedAfterMount && settings.isSuccess)
    return <EntryFields {...props} data={data.data} />;

  return (
    <>
      {data.isPending || data.isFetching || settings.isPending ? (
        <LoadingBlock label={t("Loading stock entry…")} />
      ) : null}
      {data.error || settings.error ? (
        <>
          <ErrorBlock
            message={(data.error || settings.error)?.message ?? t("Could not load stock entry")}
          />
          <button
            type="button"
            className="btn"
            onClick={() => void Promise.all([data.refetch(), settings.refetch()])}
          >
            {t("Retry stock entry")}
          </button>
        </>
      ) : null}
      <button type="button" className="btn" onClick={props.onCancel}>
        {t("Cancel")}
      </button>
    </>
  );
}

export function NativeStockEntryEditor({ entryId }: { entryId: string }) {
  const { t } = useI18n();
  const settings = useQuery(userSettingsQuery());

  const data = useQuery({
    queryKey: ["native-stock-entry-editor", entryId],
    queryFn: ({ signal }) => getNativeEntryEditor(entryId, signal),
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (data.isSuccess && data.isFetchedAfterMount && settings.isSuccess)
    return <EntryFields key={entryId} data={data.data} native />;

  return (
    <>
      {data.isPending || data.isFetching || settings.isPending ? (
        <LoadingBlock label={t("Loading stock entry…")} />
      ) : null}
      {data.error || settings.error ? (
        <>
          <ErrorBlock
            message={(data.error || settings.error)?.message ?? t("Could not load stock entry")}
          />
          <button
            type="button"
            className="btn"
            onClick={() => void Promise.all([data.refetch(), settings.refetch()])}
          >
            {t("Retry stock entry")}
          </button>
        </>
      ) : null}
    </>
  );
}

function EntryFields({
  data,
  onSaved,
  onCancel,
  onPendingChange,
  native = false,
}: Partial<Props> & { data: EntryEditor; native?: boolean }) {
  const { t } = useI18n();
  const features = useFeatures();
  const preferences = usePreferences();
  const notify = useNotify();
  const client = useQueryClient();
  const genericError = useGenericError();
  const invalidate = useInvalidateStock();
  const id = useId();
  const dueInput = useRef<HTMLInputElement>(null);
  const purchasedInput = useRef<HTMLInputElement>(null);
  const noteInput = useRef<HTMLInputElement>(null);
  const storeInput = useRef<HTMLSelectElement>(null);
  const userfields = useRef<UserfieldsEditorHandle>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const saved = useRef<EntryBookings | undefined>(undefined);
  const labelStarted = useRef(false);
  const [recordSaved, setRecordSaved] = useState(false);
  const [nativeBusy, setNativeBusy] = useState(false);
  const owner = useRef<AbortController | null>(null);
  const nativePrice = useRef<JsonObject[string]>({});
  const [nativeUnit, setNativeUnit] = useState("");

  useEffect(() => {
    if (!native) return;
    const controller = new AbortController();
    owner.current = controller;

    return () => {
      controller.abort();

      if (owner.current === controller) owner.current = null;
    };
  }, [native]);

  useEffect(() => {
    if (!native) return;
    const signal = owner.current?.signal;

    if (!signal) return;

    void getNativeEntryUnit(data.entry.product_id, signal)
      .then((name) => {
        if (!signal.aborted) setNativeUnit(name ?? "");
      })
      .catch((error: Error) => {
        if (!signal.aborted) console.error(error);
      });
  }, [native, data.entry.product_id]);

  useEffect(() => {
    if (!native) return;
    document.body.classList.toggle("cursor-busy", nativeBusy);

    return () => document.body.classList.remove("cursor-busy");
  }, [native, nativeBusy]);

  const [amount, setAmount] = useState(() =>
    data.entry.amount.toLocaleString("en", {
      maximumFractionDigits: preferences.amountPrecision,
      useGrouping: false,
    }),
  );

  const [price, setPrice] = useState(() =>
    data.entry.price
      ? data.entry.price.toLocaleString("en", {
          minimumFractionDigits: preferences.priceInputPrecision,
          maximumFractionDigits: preferences.priceInputPrecision,
          useGrouping: false,
        })
      : "",
  );

  const [purchased, setPurchased] = useState(data.entry.purchased_date?.slice(0, 10) ?? "");
  const [due, setDue] = useState(data.entry.best_before_date?.slice(0, 10) ?? "");
  const [never, setNever] = useState(false);

  const [location, setLocation] = useState(
    data.locations.some((row) => row.id === data.entry.location_id)
      ? String(data.entry.location_id)
      : "",
  );

  const [store, setStore] = useState<string | null>(
    data.stores.some((row) => row.id === data.entry.shopping_location_id)
      ? String(data.entry.shopping_location_id)
      : native && data.entry.shopping_location_id !== null
        ? null
        : "",
  );

  const [note, setNote] = useState(data.entry.note ?? "");
  const [opened, setOpened] = useState(data.entry.open === 1);
  const [reprint, setReprint] = useState(false);

  const [values, setValues] = useState(() =>
    initialUserfields(data.fields, native ? {} : data.values, false),
  );

  const amountStep = (10 ** -preferences.amountPrecision).toFixed(preferences.amountPrecision);

  const priceStep = (10 ** -preferences.priceInputPrecision).toFixed(
    preferences.priceInputPrecision,
  );

  const save = useMutation({
    onMutate: () => onPendingChange?.(true),
    mutationFn: async () => {
      if (!saved.current) {
        const body: JsonObject = {
          amount,
          best_before_date: due,
          purchased_date: purchased,
          price: features.enabled("STOCK_PRICE_TRACKING")
            ? price
              ? Number(price).toFixed(preferences.priceInputPrecision)
              : ""
            : Number(0).toFixed(preferences.priceInputPrecision),
          location_id: features.enabled("STOCK_LOCATION_TRACKING") ? location : 1,
          note,
          open: features.enabled("STOCK_PRODUCT_OPENED_TRACKING") && opened,
        };

        if (features.enabled("STOCK_PRICE_TRACKING")) body.shopping_location_id = store;
        saved.current = await saveStockEntry(data.entry.id, body);
        setRecordSaved(true);
        await invalidate(data.entry.product_id);
      }

      const booking = saved.current[0];

      if (!booking) throw new Error(t("The stock booking could not be read."));

      if (features.enabled("LABEL_PRINTER") && reprint && !labelStarted.current) {
        labelStarted.current = true;
        void printLabel(
          `/api/stock/entry/${encodeURIComponent(booking.stock_id)}/printlabel`,
          features.query.data ?? {},
        ).catch((error: Error) => notify({ message: error.message, tone: "error" }));
      }

      await saveUserfields("stock", booking.transaction_id, data.fields, values, (name, value) =>
        setValues((current) => ({ ...current, [name]: value })),
      );
      await invalidate(data.entry.product_id);
      await onSaved?.(saved.current);
    },
    onSettled: () => onPendingChange?.(false),
  });

  const nativeSave = useMutation({
    mutationFn: async () => {
      const signal = owner.current?.signal;

      if (!signal || signal.aborted) return;
      setNativeBusy(true);
      const serializedPrice = features.enabled("STOCK_PRICE_TRACKING") ? price : "0";

      if (serializedPrice)
        nativePrice.current = Number.parseFloat(serializedPrice).toFixed(
          preferences.priceInputPrecision,
        );

      const body: JsonObject = {
        amount,
        best_before_date: dueInput.current?.value ?? due,
        purchased_date: purchasedInput.current?.value ?? purchased,
        note: noteInput.current?.value ?? note,
        price: nativePrice.current,
        open: features.enabled("STOCK_PRODUCT_OPENED_TRACKING") && opened,
        location_id: features.enabled("STOCK_LOCATION_TRACKING") ? location : 1,
      };

      if (features.enabled("STOCK_PRICE_TRACKING"))
        body.shopping_location_id =
          storeInput.current?.selectedIndex === -1 ? null : (storeInput.current?.value ?? store);
      let bookings: EntryBookings;

      try {
        try {
          bookings = await saveStockEntry(data.entry.id, body, signal);
        } finally {
          invalidateNativeEntry(client);
        }

        signal.throwIfAborted();
      } catch (error) {
        if (!signal.aborted) {
          console.error(error);
          setNativeBusy(false);
        }

        return;
      }

      const booking = bookings[0]!;

      if (features.enabled("LABEL_PRINTER") && reprint)
        void printNativeLabel(
          `/api/stock/entry/${encodeURIComponent(booking.stock_id)}/printlabel`,
          features.query.data ?? {},
          () => genericError("Error while executing WebHook"),
          signal,
        );

      const edits = Object.fromEntries(
        Object.entries(userfields.current?.snapshot() ?? values).map(([name, edit]) => {
          const file = edit.readFile ? edit.readFile() : edit.upload?.file;

          return [name, file && edit.dirty ? { ...edit, ...userfieldUpload(file) } : edit];
        }),
      );

      // Keep early Delete success invalidation and each later field settlement.
      const jobs = data.fields
        .filter((field) => edits[field.name]?.dirty)
        .map((field) =>
          saveCustomObjectFields(
            "stock",
            booking.transaction_id,
            [field],
            edits,
            () => invalidateNativeEntry(client),
            (error) => genericError("Error while saving, probably this item already exists", error),
            signal,
          ).finally(() => invalidateNativeEntry(client)),
        );

      for (const job of jobs.slice(0, -1)) void job.catch(() => {});

      try {
        await jobs.at(-1);
        signal.throwIfAborted();
      } catch {
        return;
      }

      const success =
        tableText(t("Stock entry successfully updated")) +
        `<br><a class="btn btn-secondary btn-sm mt-2" href="#" onclick="UndoStockBookingEntry('undefined','${data.entry.id}')"><i class="fa-solid fa-undo"></i> ${tableText(t("Undo"))}</a>`;

      getTopmostGrocyWindow().postMessage(
        {
          Message: "BroadcastMessage",
          Payload: { Message: "ProductChanged", Payload: data.entry.product_id },
        },
        window.location.origin,
      );
      window.parent.postMessage(
        { Message: "ShowSuccessMessage", Payload: success },
        window.location.origin,
      );
      window.parent.postMessage({ Message: "Ready", Payload: null }, window.location.origin);
      window.parent.postMessage(
        { Message: "CloseLastModal", Payload: null },
        window.location.origin,
      );
    },
  });

  const pending = native ? nativeBusy : save.isPending;

  function changeDue(value: string) {
    setDue(value);

    if (never && value !== "2999-12-31") {
      setNever(false);
      setReprint(true);
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!pending && event.currentTarget.reportValidity()) {
      if (native) nativeSave.mutate();
      else save.mutate();
    }
  };

  return (
    <form className="stock-entry-form" aria-label={t("Edit stock entry")} onSubmit={submit}>
      <p>{data.entry.product_name}</p>
      {!native && save.error ? <ErrorBlock message={save.error.message} /> : null}
      {!native && recordSaved ? (
        <p role="status">{t("Stock entry saved. Retry to finish saving custom fields.")}</p>
      ) : null}
      <fieldset className="form-grid" disabled={pending || (!native && recordSaved)}>
        <div className="field">
          <label htmlFor={`${id}-amount`}>
            {t("Amount")} <small>{native ? nativeUnit : data.entry.qu_name}</small>
          </label>
          <NumberPicker
            id={`${id}-amount`}
            label={t("Amount")}
            value={amount}
            min={amountStep}
            step={amountStep}
            required
            autoFocus
            onChange={setAmount}
          />
        </div>
        {native ? (
          <NativeDateTimeInput
            inputRef={purchasedInput}
            id={`${id}-purchased`}
            caption={t("Purchased date")}
            required
            value={purchased}
            initialValue={data.entry.purchased_date ?? ""}
            nextInputSelector={`[id="${id}-save"]`}
            onChange={setPurchased}
          />
        ) : (
          <div className="field">
            <label htmlFor={`${id}-purchased`}>{t("Purchased date")}</label>
            <BookingDateInput
              id={`${id}-purchased`}
              label={t("Purchased date")}
              required
              value={purchased}
              initialCalendarValue={purchased}
              parseOnBlur={false}
              showInitialContext={false}
              firstDayOfWeek={features.query.data?.CALENDAR_FIRST_DAY_OF_WEEK}
              weekNumbers={features.query.data?.CALENDAR_SHOW_WEEK_OF_YEAR !== false}
              onChange={setPurchased}
              onShortcut={() => saveButton.current?.focus()}
            />
          </div>
        )}
        {native || features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING") ? (
          <div className="field" hidden={!features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING")}>
            {native ? (
              <NativeMainDateInput
                inputRef={dueInput}
                id={`${id}-due`}
                caption={t("Due date")}
                datetime={false}
                required
                value={due}
                initialValue={data.entry.best_before_date ?? ""}
                numeric={features.enabled("STOCK_BEST_BEFORE_DATE_FIELD_NUMBER_PAD")}
                nextInputSelector={`[id="${id}-due"]`}
                syncValue="set"
                onChange={changeDue}
                onCommit={() => setReprint(true)}
              />
            ) : (
              <>
                <label htmlFor={`${id}-due`}>{t("Due date")}</label>
                <BookingDateInput
                  inputRef={dueInput}
                  id={`${id}-due`}
                  label={t("Due date")}
                  numeric={features.enabled("STOCK_BEST_BEFORE_DATE_FIELD_NUMBER_PAD")}
                  required
                  readOnly={never}
                  value={due}
                  initialCalendarValue={due}
                  showInitialContext={false}
                  firstDayOfWeek={features.query.data?.CALENDAR_FIRST_DAY_OF_WEEK}
                  weekNumbers={features.query.data?.CALENDAR_SHOW_WEEK_OF_YEAR !== false}
                  onChange={changeDue}
                  onCommit={() => setReprint(true)}
                  onShortcut={() => {
                    if (dueInput.current?.value === "2999-12-31") {
                      setNever(true);
                      setReprint(true);
                    }

                    dueInput.current?.focus();
                  }}
                />
              </>
            )}
            <label className="check-field">
              <input
                type="checkbox"
                data-native-date-shortcut={native ? "1" : undefined}
                data-datetimepicker-shortcut-value={native ? "2999-12-31" : undefined}
                tabIndex={-1}
                checked={native ? undefined : never}
                defaultChecked={native ? false : undefined}
                onChange={
                  native
                    ? undefined
                    : (event) => {
                        setNever(event.target.checked);
                        setReprint(true);
                        setDue(event.target.checked ? "2999-12-31" : "");

                        if (!event.target.checked) dueInput.current?.focus();
                      }
                }
              />
              <span>{t("Never overdue")}</span>
            </label>
            {due && due < isoDay() ? (
              <p className="hint">{t("The given date is earlier than today, are you sure?")}</p>
            ) : null}
          </div>
        ) : null}
        {features.enabled("STOCK_PRICE_TRACKING") ? (
          <>
            <div className="field">
              <label htmlFor={`${id}-price`}>{t("Price")}</label>
              <NumberPicker
                id={`${id}-price`}
                label={t("Price")}
                currency
                value={price}
                min="0"
                step={priceStep}
                onChange={setPrice}
              />
              <small>{t("Per stock quantity unit")}</small>
            </div>
            <label className="field">
              <span>{t("Store")}</span>
              <select
                ref={(select) => {
                  storeInput.current = select;

                  if (native && store === null && select) select.selectedIndex = -1;
                }}
                value={store ?? ""}
                onChange={(event) => setStore(event.target.value)}
              >
                <option value="">{t("None")}</option>
                {data.stores.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        {features.enabled("STOCK_LOCATION_TRACKING") ? (
          <label className="field">
            <span>{t("Location")}</span>
            <select required value={location} onChange={(event) => setLocation(event.target.value)}>
              <option value="">{t("Select an option")}</option>
              {data.locations.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field">
          <span>{t("Note")}</span>
          <input ref={noteInput} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {features.enabled("STOCK_PRODUCT_OPENED_TRACKING") ? (
          <label className="check-field">
            <input
              type="checkbox"
              checked={opened}
              onChange={(event) => setOpened(event.target.checked)}
            />
            <span>{t("Opened")}</span>
          </label>
        ) : null}
      </fieldset>
      <UserfieldsEditor
        ref={native ? userfields : undefined}
        fields={data.fields}
        values={values}
        creating={false}
        disabled={pending}
        nativeFiles={native}
        nativeDirty={native}
        nativeLoadPending={native}
        onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
      />
      {native ? (
        <NativeUserfieldsLoad
          namespace="stock"
          objectId={data.entry.stock_id}
          fieldCount={data.fields.length}
          editor={userfields}
        />
      ) : null}
      {features.enabled("LABEL_PRINTER") ? (
        <label className="check-field">
          <input
            type="checkbox"
            checked={reprint}
            disabled={pending || (!native && recordSaved)}
            onChange={(event) => setReprint(event.target.checked)}
          />
          <span>{t("Reprint stock entry label")}</span>
        </label>
      ) : null}
      <div className="actions">
        <button
          id={native ? `${id}-save` : undefined}
          ref={saveButton}
          type="submit"
          className="btn btn-primary"
          disabled={pending}
        >
          {t(!native && recordSaved ? "Retry" : "OK")}
        </button>
        {!native ? (
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={onCancel}>
            {t("Cancel")}
          </button>
        ) : null}
      </div>
    </form>
  );
}
