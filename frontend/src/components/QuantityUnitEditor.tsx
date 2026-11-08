import { nativeTableDocumentOwner, useNativeDocumentReload } from "@/lib/native-document";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, request, queryKeys } from "@/lib/api";
import { getCustomObjectValues } from "@/lib/custom-object-form";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { useDocumentTasks } from "@/lib/document-tasks";
import { saveNativeHouseholdObject } from "@/lib/native-household-save";
import { useModalDialog } from "@/hooks/useModalDialog";
import { userSettingsQuery } from "@/hooks/queries";
import {
  getQuantityUnit,
  getQuantityUnits,
  getQuantityUnitConversions,
  invalidateQuantityUnits,
  type QuantityUnit,
  type QuantityUnitConversion,
} from "@/lib/quantity-unit-form";
import { initialUserfields, userfieldsQuery, type UserfieldDefinition } from "@/lib/userfields";
import { useTableOptions } from "@/lib/table-options";
import { useTableOrder } from "@/lib/table-order";
import { nativeTableCell, tableText, type NativeTableRow } from "@/lib/native-table-cell";
import type { JsonObject } from "@/lib/json";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { UserfieldsEditor, type UserfieldsEditorHandle } from "./UserfieldsEditor";
import { NativeUserfieldsLoad } from "./NativeUserfieldsLoad";
import {
  StockTableCells,
  StockTableOptions,
  StockTableRows,
  StockTableStatus,
} from "./StockTableOptions";
import { EmbeddedPageDialog, type EmbeddedPage } from "./EmbeddedPageDialog";

export function QuantityUnitEditor({
  recordId,
  onSaved,
}: {
  recordId: number | null;
  onSaved: (id: number, mode: string) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const reloadDocument = useNativeDocumentReload(nativeTableDocumentOwner("qu-conversions-table"));
  const features = useFeatures();
  const router = useRouter();
  const settings = useQuery(userSettingsQuery());
  const valid = recordId === null || (Number.isInteger(recordId) && recordId > 0);
  const [version, setVersion] = useState(0);
  const [testing, setTesting] = useState<EmbeddedPage>();
  const [editedName, setEditedName] = useState<string>();
  const [testStay, setTestStay] = useState(false);
  const [unlockVersion, setUnlockVersion] = useState(0);
  const [formValid, setFormValid] = useState(false);

  const localization = useQuery({
    queryKey: queryKeys.localization(features.query.data?.LOCALE),
    queryFn: () => api.getLocalization(features.query.data?.LOCALE),
    staleTime: Infinity,
  });

  const definition = localization.data?.catalog["plural-forms"] ?? "nplurals=2; plural=(n != 1);";
  const pluralCount = Number(/nplurals\s*=\s*(\d+)/.exec(definition)?.[1] ?? 2);
  const pluralRule = /plural\s*=\s*([^;]+)/.exec(definition)?.[1] ?? "(n != 1)";

  const data = useQuery({
    queryKey: ["quantity-unit-editor", recordId, version],
    queryFn: async ({ signal }) => {
      if (recordId === null) return { record: null, units: [], conversions: [] };

      const [record, units, conversions] = await Promise.all([
        getQuantityUnit(recordId, signal),
        getQuantityUnits(signal),
        getQuantityUnitConversions(signal),
      ]);

      return {
        record,
        units,
        conversions: conversions.filter(
          (row) => row.from_qu_id === recordId && row.product_id === null,
        ),
      };
    },
    enabled: valid,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const title = recordId === null ? "Create quantity unit" : "Edit quantity unit";
  const error = data.error || settings.error || localization.error;
  const ready = data.isSuccess && settings.isSuccess && localization.isSuccess;

  return (
    <>
      <PageHeader title={t(title)} />
      {!valid ? <ErrorBlock message={t("Object not found")} /> : null}
      {error ? (
        <>
          <ErrorBlock message={error.message} />
          <button
            className="btn"
            onClick={() => {
              void data.refetch();
              void settings.refetch();
              void localization.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {valid && !ready && !error ? <LoadingBlock /> : null}
      {data.data && ready ? (
        <>
          <QuantityUnitObjectForm
            key={`form:${version}`}
            entity="quantity_units"
            recordId={recordId}
            record={data.data.record}
            title={title}
            defaults={(row) => ({
              name: String(row?.name ?? ""),
              name_plural: String(row?.name_plural ?? ""),
              plural_forms: String(row?.plural_forms ?? ""),
              description: String(row?.description ?? ""),
              active: row === null || Number(row.active) === 1 ? "1" : "0",
            })}
            body={(values) => {
              const body: JsonObject = {
                name: values.name,
                name_plural: values.name_plural,
                description: values.description,
                active: values.active,
              };

              if (pluralCount > 2) body.plural_forms = values.plural_forms;

              return body;
            }}
            buttons={[
              { mode: "continue", label: "Save & continue" },
              { mode: "return", label: "Save & return to quantity units" },
              ...(pluralCount > 2 ? [{ mode: "test", label: "Test plural forms" }] : []),
            ]}
            onAction={(mode) => {
              if (mode !== "test") return;
              setTestStay(true);
              const editObjectId = recordId ?? undefined;

              // The native Test handler clicks a missing save-button ID, then
              // dereferences the existing identity even in a fresh create form.
              const target = editObjectId!.toString();
              setTesting({
                id: Date.now(),
                url: new URL(
                  router.buildLocation({
                    to: "/quantityunitpluraltesting",
                    search: { embedded: "", qu: target },
                  }).publicHref,
                  window.location.href,
                ).href,
                dialogType: "",
              });
            }}
            unlockVersion={unlockVersion}
            blockEnter
            onValidity={setFormValid}
            onSaved={async (id, mode) => {
              await onSaved(id, testStay && mode === "return" ? "stay" : mode);
            }}
            fields={(values, change) => (
              <>
                <label className="field">
                  {t("Name")} <span>{t("in singular form")}</span>
                  <input
                    name="name"
                    autoFocus
                    required
                    value={values.name}
                    onChange={(e) => {
                      change("name", e.target.value);
                      setEditedName(e.target.value);
                    }}
                  />
                </label>
                <label className="field">
                  {t("Name")} <span>{t("in plural form")}</span>
                  <input
                    name="name_plural"
                    value={values.name_plural}
                    onChange={(e) => change("name_plural", e.target.value)}
                  />
                </label>
                {pluralCount > 2 ? (
                  <label className="field">
                    {t("Plural forms")}
                    <span>
                      {t("One plural form per line, the current language requires")}:{" "}
                      {t("Plural count")}: {pluralCount}; {t("Plural rule")}: {pluralRule}
                    </span>
                    <textarea
                      name="plural_forms"
                      rows={3}
                      value={values.plural_forms}
                      onChange={(e) => change("plural_forms", e.target.value)}
                    />
                  </label>
                ) : null}
                <label className="check-field">
                  <input
                    type="checkbox"
                    name="active"
                    checked={values.active === "1"}
                    onChange={(e) => change("active", e.target.checked ? "1" : "0")}
                  />
                  {t("Active")}
                </label>
                <label className="field">
                  {t("Description")}
                  <textarea
                    name="description"
                    rows={2}
                    value={values.description}
                    onChange={(e) => change("description", e.target.value)}
                  />
                </label>
                {recordId === null ? <p>{t("Save & continue to add conversions")}</p> : null}
              </>
            )}
          />
          {recordId !== null ? (
            <DefaultConversions
              key={`conversions:${version}`}
              recordId={recordId}
              name={editedName ?? data.data.record?.name ?? ""}
              units={data.data.units}
              conversions={data.data.conversions}
              formValid={formValid}
              onReload={() => {
                if (reloadDocument()) return;
                setEditedName(undefined);
                setVersion((v) => v + 1);
              }}
            />
          ) : null}
        </>
      ) : null}
      {testing ? (
        <EmbeddedPageDialog
          page={testing}
          onClose={() => {
            setTesting(undefined);
            setTestStay(false);
            setUnlockVersion((current) => current + 1);
          }}
        />
      ) : null}
    </>
  );
}

type FormProps = {
  entity: "quantity_units" | "quantity_unit_conversions";
  recordId: number | null;
  record: JsonObject | null;
  title: string;
  defaults: (row: JsonObject | null) => Record<string, string>;
  body: (values: Record<string, string>) => JsonObject;
  fields: (
    values: Record<string, string>,
    change: (key: string, value: string) => void,
    controlsRestored: boolean,
  ) => ReactNode;
  buttons: Array<{ mode: string; label: string }>;
  onSaved: (id: number, mode: string) => Promise<void> | void;
  onAction?: (mode: string) => void;
  blockEnter?: boolean;
  unlockVersion?: number;
  onValidity?: (valid: boolean) => void;
};

export function QuantityUnitObjectForm(props: FormProps) {
  const { t } = useI18n();
  const nativeDocument = useDocumentTasks();
  const definitions = useQuery(userfieldsQuery);
  const fields = definitions.data?.filter((field) => field.entity === props.entity) ?? [];

  const custom = useQuery({
    queryKey: ["quantity-unit-fields", props.entity, props.recordId],
    queryFn: ({ signal }) =>
      getCustomObjectValues(
        props.entity,
        props.recordId!,
        AbortSignal.any([signal, nativeDocument.capture().signal]),
      ),
    enabled: props.recordId !== null && definitions.isSuccess && fields.length > 0,
    retry: false,
    refetchOnMount: "always",
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const error = definitions.error;

  if (error)
    return (
      <>
        <ErrorBlock message={error.message} />
        <button
          className="btn"
          onClick={() => {
            void definitions.refetch();
          }}
        >
          {t("Retry")}
        </button>
      </>
    );

  if (!definitions.isSuccess) return <LoadingBlock />;

  return (
    <QuantityUnitFields
      {...props}
      definitions={fields}
      custom={custom.isFetching ? undefined : custom.data}
      customError={custom.isFetching ? null : custom.error}
    />
  );
}

function QuantityUnitFields({
  definitions,
  custom,
  customError,
  ...props
}: FormProps & {
  definitions: UserfieldDefinition[];
  custom: Record<string, string | null> | undefined;
  customError: Error | null;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const nativeDocument = useDocumentTasks();
  const [values, setValues] = useState(() => props.defaults(props.record));

  const [edits, setEdits] = useState(() => initialUserfields(definitions, {}, false));

  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [controlsRestored, setControlsRestored] = useState(false);
  const userfields = useRef<UserfieldsEditorHandle>(null);
  const loadAttempted = useRef(false);
  const loadOwner = useRef<AbortSignal>(undefined);
  const loadDocument = useRef(nativeDocument);
  useEffect(() => {
    if (props.recordId === null) return;

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
      console.error(error);
    }
  }, [custom, customError, props.recordId, nativeDocument]);
  const primaryFields = useRef<HTMLFieldSetElement>(null);
  const observedUnlock = useRef(props.unlockVersion);
  const form = useRef<HTMLFormElement>(null);
  const onValidity = props.onValidity;
  useEffect(
    () => onValidity?.(form.current?.checkValidity() ?? false),
    [values, edits, onValidity],
  );
  const scope = useRef<AbortController>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (observedUnlock.current === props.unlockVersion) return;
    observedUnlock.current = props.unlockVersion;
    saving.current = false;
    setBusy(false);
    setControlsRestored(true);
  }, [props.unlockVersion]);

  const submitNative = async (mode: string) => {
    const owner = scope.current;

    if (!owner || saving.current) return;
    const task = nativeDocument.capture();
    const signal = AbortSignal.any([task.signal, owner.signal]);
    signal.throwIfAborted();
    const body = props.body(values);

    for (const control of primaryFields.current?.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("input[name], textarea[name], select[name]") ?? []) {
      // Native conversion explicitly reads From even when its initial query locks it.
      if (control.matches(":disabled") && control.name !== "from_qu_id") continue;
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

    const identity = await saveNativeHouseholdObject({
      client,
      entity: props.entity,
      recordId: props.recordId,
      body,
      fields: definitions,
      readEdits: () => userfields.current?.snapshot() ?? edits,
      primaryError: (error) => {
        saving.current = false;
        setBusy(false);
        setControlsRestored(true);
        task.genericError("Error while saving, probably this item already exists", error);
      },
      fileError: (error) =>
        task.genericError("Error while saving, probably this item already exists", error),
      signal,
    });

    if (identity !== undefined && !signal.aborted) await props.onSaved(identity.id, mode);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const button = event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : null;

    if (!document.querySelector(".combobox-menu-visible") && event.currentTarget.reportValidity()) {
      const mode = button instanceof HTMLButtonElement ? button.value : props.buttons[0]!.mode;
      void submitNative(mode);
    }
  };

  useEffect(() => {
    document.body.classList.toggle("cursor-busy", busy);

    return () => document.body.classList.remove("cursor-busy");
  }, [busy]);

  return (
    <form
      ref={form}
      className="move-form household-editor"
      aria-label={t(props.title)}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;

        if (event.defaultPrevented) return;
        event.preventDefault();

        // The unit source targets a nonexistent save ID; conversion has a real one.
        if (
          !props.blockEnter &&
          !document.querySelector(".combobox-menu-visible") &&
          event.currentTarget.reportValidity()
        )
          void submitNative(props.buttons[0]!.mode);
      }}
    >
      <fieldset ref={primaryFields} disabled={busy}>
        {props.fields(
          values,
          (key, value) => setValues((current) => ({ ...current, [key]: value })),
          controlsRestored,
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
        disabled={busy}
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
        {props.buttons.map((button) => (
          <button
            key={button.mode}
            className="btn btn-primary"
            type={button.mode === "test" ? "button" : "submit"}
            value={button.mode}
            disabled={busy}
            onClick={button.mode === "test" ? () => props.onAction?.("test") : undefined}
          >
            {t(button.label)}
          </button>
        ))}
      </div>
    </form>
  );
}

function DefaultConversions({
  recordId,
  name,
  units,
  conversions,
  formValid,
  onReload,
}: {
  recordId: number;
  name: string;
  units: QuantityUnit[];
  conversions: QuantityUnitConversion[];
  formValid: boolean;
  onReload: () => void;
}) {
  const { t } = useI18n();
  const preferences = usePreferences();
  const client = useQueryClient();
  const [embedded, setEmbedded] = useState<EmbeddedPage>();
  const [deleting, setDeleting] = useState<number>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  const options = useTableOptions(
    "qu-conversions-table",
    [
      { key: "actions", label: "", configurable: false },
      { key: "factor", label: "Factor" },
      { key: "unit", label: "Unit" },
    ],
    { key: "factor", descending: false },
    true,
  );

  const cells = (row: QuantityUnitConversion): NativeTableRow => ({
    // The reference's default chinese-string ordering compares the rendered span text.
    factor: nativeTableCell(
      `<span class="locale-number locale-number-quantity-amount number-parsing-done">${tableText(preferences.formatAmount(row.factor))}</span>`,
    ),
    unit: nativeTableCell(tableText(units.find((unit) => unit.id === row.to_qu_id)?.name ?? "")),
  });

  const ordered = useTableOrder(
    conversions.map((row) => ({ key: String(row.id), row, cells: cells(row) })),
    options,
    true,
  );

  const remove = useMutation({
    mutationFn: (id: number) =>
      request(`/api/objects/quantity_unit_conversions/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await invalidateQuantityUnits(client);

      if (alive.current) onReload();
    },
  });

  const open = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    setEmbedded({ id: Date.now(), url: event.currentTarget.href, dialogType: "" });
  };

  return (
    <section>
      <div className="section-heading">
        <h2>
          {t("Default conversions")} <small>{name ? t("1 %s is the same as...", name) : ""}</small>
        </h2>
        <Link
          className="btn"
          to="/quantityunitconversion/$conversionId"
          params={{ conversionId: "new" }}
          search={{ embedded: "", "qu-unit": String(recordId) }}
          aria-disabled={!formValid}
          onClick={(event) => {
            if (!formValid) event.preventDefault();
            else open(event);
          }}
        >
          {t("Add")}
        </Link>
      </div>
      <StockTableStatus options={options} />
      <div className="journal-table-scroll">
        <table className="stock-table">
          <caption className="sr-only">{t("Default conversions")}</caption>
          <thead>
            <tr>
              <StockTableCells options={options} headers>
                <th>
                  <StockTableOptions options={options} onReset={onReload} />
                </th>
                {["factor", "unit"].map((key) => (
                  <th key={key}>
                    <button
                      type="button"
                      className="journal-sort"
                      onClick={(event) => options.sortBy(key, event.shiftKey)}
                    >
                      {t(key === "factor" ? "Factor" : "Unit")}
                    </button>
                  </th>
                ))}
              </StockTableCells>
            </tr>
          </thead>
          <StockTableRows options={options} groups={[]}>
            {ordered.map((row) => (
              <tr key={row.id}>
                <StockTableCells options={options}>
                  <td>
                    <Link
                      className="btn btn-sm"
                      aria-label={t("Edit this item")}
                      to="/quantityunitconversion/$conversionId"
                      params={{ conversionId: String(row.id) }}
                      search={{ embedded: "", "qu-unit": String(recordId) }}
                      onClick={open}
                    >
                      {t("Edit")}
                    </Link>
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-label={t("Delete this item")}
                      onClick={() => {
                        remove.reset();
                        setDeleting(row.id);
                      }}
                    >
                      {t("Delete")}
                    </button>
                  </td>
                  <td>{preferences.formatAmount(row.factor)}</td>
                  <td>{units.find((unit) => unit.id === row.to_qu_id)?.name}</td>
                </StockTableCells>
              </tr>
            ))}
          </StockTableRows>
        </table>
      </div>
      {embedded ? (
        <EmbeddedPageDialog page={embedded} onClose={() => setEmbedded(undefined)} />
      ) : null}
      {deleting !== undefined ? (
        <QuantityUnitDeleteDialog
          message={t("Are you sure you want to remove this conversion?")}
          pending={remove.isPending}
          error={remove.error}
          onClose={() => setDeleting(undefined)}
          onDelete={() => remove.mutate(deleting)}
        />
      ) : null}
    </section>
  );
}

export function QuantityUnitDeleteDialog({
  message,
  pending,
  error,
  onClose,
  onDelete,
}: {
  message: string;
  pending: boolean;
  error: Error | null;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog"
      aria-label={t("Delete this item")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <p>{message}</p>
      {error ? <ErrorBlock message={error.message} /> : null}
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={pending} onClick={onDelete}>
          {t("Yes")}
        </button>
        <button type="button" className="btn" disabled={pending} onClick={onClose}>
          {t("No")}
        </button>
      </div>
    </dialog>
  );
}
