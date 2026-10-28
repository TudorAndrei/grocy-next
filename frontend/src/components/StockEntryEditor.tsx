import { useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useModalDialog } from "@/hooks/useModalDialog";
import { userSettingsQuery } from "@/hooks/queries";
import { useInvalidateStock } from "@/lib/catalog";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { isoDay } from "@/lib/format";
import { usePreferences } from "@/lib/preferences";
import { printLabel } from "@/lib/printing";
import type { JsonObject } from "@/lib/json";
import {
  getEntryEditor,
  saveStockEntry,
  type EntryBookings,
  type EntryEditor,
} from "@/lib/stock-entry-editor";
import { initialUserfields, saveUserfields } from "@/lib/userfields";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { NumberPicker } from "./NumberPicker";
import { UserfieldsEditor } from "./UserfieldsEditor";
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
  const [pending, setPending] = useState(false);

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog stock-entry-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!pending) props.onCancel();
      }}
    >
      <h2 id={title}>{t("Edit stock entry")}</h2>
      <StockEntryEditor {...props} onPendingChange={setPending} />
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

function EntryFields({ data, onSaved, onCancel, onPendingChange }: Props & { data: EntryEditor }) {
  const { t } = useI18n();
  const features = useFeatures();
  const preferences = usePreferences();
  const notify = useNotify();
  const invalidate = useInvalidateStock();
  const id = useId();
  const dueInput = useRef<HTMLInputElement>(null);
  const saved = useRef<EntryBookings | undefined>(undefined);
  const labelStarted = useRef(false);
  const [recordSaved, setRecordSaved] = useState(false);

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

  const [store, setStore] = useState(
    data.stores.some((row) => row.id === data.entry.shopping_location_id)
      ? String(data.entry.shopping_location_id)
      : "",
  );

  const [note, setNote] = useState(data.entry.note ?? "");
  const [opened, setOpened] = useState(data.entry.open === 1);
  const [reprint, setReprint] = useState(false);
  const [values, setValues] = useState(() => initialUserfields(data.fields, data.values, false));
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

        if (features.enabled("STOCK_PRICE_TRACKING")) body.shopping_location_id = store || null;
        saved.current = await saveStockEntry(data.entry.id, body);
        setRecordSaved(true);
        await invalidate();
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
      await invalidate();
      await onSaved(saved.current);
    },
    onSettled: () => onPendingChange?.(false),
  });

  const changeDue = (value: string) => {
    setDue(value);
    setNever(value === "2999-12-31");
    setReprint(true);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (event.currentTarget.reportValidity()) save.mutate();
  };

  return (
    <form className="stock-entry-form" aria-label={t("Edit stock entry")} onSubmit={submit}>
      <p>{data.entry.product_name}</p>
      {save.error ? <ErrorBlock message={save.error.message} /> : null}
      {recordSaved ? (
        <p role="status">{t("Stock entry saved. Retry to finish saving custom fields.")}</p>
      ) : null}
      <fieldset className="form-grid" disabled={save.isPending || recordSaved}>
        <div className="field">
          <label htmlFor={`${id}-amount`}>
            {t("Amount")} <small>{data.entry.qu_name}</small>
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
        <label className="field">
          <span>{t("Purchased date")}</span>
          <input
            type="date"
            required
            value={purchased}
            onChange={(event) => setPurchased(event.target.value)}
          />
        </label>
        {features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING") ? (
          <div className="field">
            <label htmlFor={`${id}-due`}>{t("Due date")}</label>
            <input
              ref={dueInput}
              id={`${id}-due`}
              type="date"
              inputMode={
                features.enabled("STOCK_BEST_BEFORE_DATE_FIELD_NUMBER_PAD") ? "numeric" : undefined
              }
              required
              readOnly={never}
              value={due}
              onChange={(event) => changeDue(event.target.value)}
            />
            <label className="check-field">
              <input
                type="checkbox"
                checked={never}
                onChange={(event) => {
                  changeDue(event.target.checked ? "2999-12-31" : "");

                  if (!event.target.checked) dueInput.current?.focus();
                }}
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
                value={price}
                min="0"
                step={priceStep}
                onChange={setPrice}
              />
              <small>{t("Per stock quantity unit")}</small>
            </div>
            <label className="field">
              <span>{t("Store")}</span>
              <select value={store} onChange={(event) => setStore(event.target.value)}>
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
          <input value={note} onChange={(event) => setNote(event.target.value)} />
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
        fields={data.fields}
        values={values}
        creating={false}
        disabled={save.isPending}
        onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
      />
      {features.enabled("LABEL_PRINTER") ? (
        <label className="check-field">
          <input
            type="checkbox"
            checked={reprint}
            disabled={save.isPending || recordSaved}
            onChange={(event) => setReprint(event.target.checked)}
          />
          <span>{t("Reprint stock entry label")}</span>
        </label>
      ) : null}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {t(recordSaved ? "Retry" : "OK")}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={save.isPending}
          onClick={onCancel}
        >
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}
