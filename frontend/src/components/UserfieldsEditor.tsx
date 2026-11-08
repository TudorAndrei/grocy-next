import { z } from "zod";
import { nativeUserfieldDateNow } from "@/lib/native-userfield-dates";
import { useQueryClient } from "@tanstack/react-query";
import { useUserSettings } from "@/hooks/useUserSettings";
import { preferenceEnabled } from "@/lib/preferences";
import { normalizeCurrencyInput } from "@/lib/stock-settings";
import { nativeCurrencyValue } from "@/lib/native-quantity";
import {
  parseNativeUserfieldCreation,
  type NativeUserfieldCreation,
} from "@/lib/native-userfields-create";
import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
  type SyntheticEvent,
} from "react";
import {
  clearNativeUserfields,
  nativeClearFileValue,
  nativeClearLinkValue,
  nativeUserfileUrl,
} from "@/lib/native-userfields-clear";
import { useNativeScriptBindings } from "@/lib/native-script-bindings";
import { useI18n } from "@/lib/i18n";
import { filePath, queryKeys } from "@/lib/api";
import type { JsonObject, JsonValue } from "@/lib/json";
import { openApiDocument } from "@/lib/open-document";
import {
  userfieldFile,
  userfieldUpload,
  type FieldEdits,
  type FieldEdit,
  type UserfieldDefinition,
} from "@/lib/userfields";
import { EntityPicture } from "./EntityPicture";
import { ErrorBlock } from "./ErrorBlock";
import { NativeDateTimeInput } from "./NativeDateTimeInput";

export type UserfieldsEditorHandle = {
  snapshot: () => FieldEdits;
  load: (values: Record<string, string | null>) => void;
  initializeCreate: (definitions: JsonValue[]) => void;
  clear: (namespace: string, signal?: AbortSignal) => Promise<void>;
  refreshCurrencyValues: (precision: number) => void;
};

type UserfieldControl = {
  initializeCreate: (
    definition: NativeUserfieldCreation,
    edit: FieldEdit,
    control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  ) => void;
  clear: (edit: FieldEdit) => void;
  load: (value: string | null, edit: FieldEdit) => void;
};

export function UserfieldsEditor({
  fields,
  values,
  creating,
  disabled,
  nativeFiles = false,
  nativeDirty = false,
  nativeLoadPending = false,
  nativeUnloaded = false,
  onChange,
  ref,
}: {
  fields: UserfieldDefinition[];
  values: FieldEdits;
  creating: boolean;
  disabled: boolean;
  nativeFiles?: boolean;
  nativeDirty?: boolean;
  nativeLoadPending?: boolean;
  nativeUnloaded?: boolean;
  onChange: (name: string, value: FieldEdit) => void;
  ref?: Ref<UserfieldsEditorHandle>;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLFieldSetElement>(null);
  const current = useRef({ fields, values, onChange, nativeDirty });
  useLayoutEffect(() => {
    current.current = { fields, values, onChange, nativeDirty };
  });
  const controls = useRef(new Map<string, UserfieldControl>());
  const lifetime = useRef(new AbortController());
  useEffect(() => {
    if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
    const owner = lifetime.current;

    return () => owner.abort();
  }, []);

  function update(name: string, edit: FieldEdit) {
    current.current.values = { ...current.current.values, [name]: edit };
    current.current.onChange(name, edit);
  }

  useImperativeHandle(
    ref,
    () => ({
      snapshot: () => {
        const inputs = new Map(
          Array.from(
            root.current?.querySelectorAll<
              HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
            >("[data-native-userfield]") ?? [],
            (control) => [control.getAttribute("data-native-userfield"), control],
          ),
        );

        return Object.fromEntries(
          current.current.fields.map((field) => {
            const edit = { ...(current.current.values[field.name] ?? { value: "", dirty: false }) };
            const control = inputs.get(field.name);

            if (
              current.current.nativeDirty &&
              control &&
              field.type !== "file" &&
              field.type !== "image"
            ) {
              edit.value =
                control instanceof HTMLInputElement && control.type === "checkbox"
                  ? control.checked
                    ? "1"
                    : "0"
                  : control instanceof HTMLSelectElement && control.multiple
                    ? Array.from(control.selectedOptions, (option) => option.value).join(",")
                    : control instanceof HTMLInputElement &&
                        control.type === "datetime-local" &&
                        control.value
                      ? control.value.replace("T", " ").padEnd(19, ":00")
                      : control.value;

              if (
                control instanceof HTMLSelectElement &&
                !control.multiple &&
                control.selectedIndex === -1
              )
                edit.nativeValue = null;
              else delete edit.nativeValue;
            }

            // Packed links retain their hidden payload; files retain their live File reader.
            return [field.name, edit];
          }),
        );
      },
      load: (values) => {
        if (lifetime.current.signal.aborted) return;

        for (const [name, value] of Object.entries(values)) {
          controls.current
            .get(name)
            ?.load(value, current.current.values[name] ?? { value: "", dirty: false });
        }
      },
      initializeCreate: (definitions) => {
        if (lifetime.current.signal.aborted) return;

        const inputs = new Map(
          Array.from(
            root.current?.querySelectorAll<
              HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
            >("[data-native-userfield]") ?? [],
            (control) => [control.getAttribute("data-native-userfield"), control],
          ),
        );

        for (const value of definitions) {
          const definition = parseNativeUserfieldCreation(value);
          const input = inputs.get(definition.name);

          if (!input) continue;
          controls.current
            .get(definition.name)
            ?.initializeCreate(
              definition,
              current.current.values[definition.name] ?? { value: "", dirty: false },
              input,
            );
        }
      },
      refreshCurrencyValues: (precision) => {
        if (lifetime.current.signal.aborted) return;

        for (const field of current.current.fields) {
          if (field.type !== "number-currency") continue;
          const edit = current.current.values[field.name];

          if (!edit) continue;
          const value = nativeCurrencyValue(edit.value, precision);

          if (value !== edit.value) update(field.name, { ...edit, value });
        }
      },
      clear: async (namespace, signal) => {
        if (!current.current.fields.length) return;

        const scope = signal
          ? AbortSignal.any([lifetime.current.signal, signal])
          : lifetime.current.signal;

        await clearNativeUserfields(
          namespace,
          (name) => {
            controls.current
              .get(name)
              ?.clear(current.current.values[name] ?? { value: "", dirty: false });
          },
          scope,
        );
      },
    }),
    [],
  );

  const markNativeDirty = (event: SyntheticEvent, selectClick = false) => {
    if (!nativeDirty) return;
    const target = event.target;

    const control = selectClick
      ? target instanceof Element
        ? target.closest("select")
        : null
      : target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        ? target
        : null;

    const name = control?.getAttribute("data-native-userfield");

    if (!name) return;
    const edit = current.current.values[name] ?? { value: "", dirty: false };
    update(name, { ...edit, dirty: true });
  };

  if (!fields.length) return null;

  return (
    <fieldset
      ref={root}
      className="userfields-editor"
      disabled={disabled}
      onKeyUpCapture={nativeDirty ? markNativeDirty : undefined}
      onPasteCapture={nativeDirty ? markNativeDirty : undefined}
      onChangeCapture={nativeDirty ? markNativeDirty : undefined}
      onClickCapture={nativeDirty ? (event) => markNativeDirty(event, true) : undefined}
    >
      <legend>{t("Userfields")}</legend>
      {fields.map((field) => (
        <Userfield
          key={field.id}
          field={field}
          edit={values[field.name] ?? { value: "", dirty: false }}
          creating={creating}
          nativeFiles={nativeFiles}
          nativeDirty={nativeDirty}
          nativeLoadPending={nativeLoadPending}
          nativeUnloaded={nativeUnloaded}
          onChange={(edit) => update(field.name, edit)}
          readEdit={() => current.current.values[field.name] ?? { value: "", dirty: false }}
          ref={(control) => {
            if (control) controls.current.set(field.name, control);
            else controls.current.delete(field.name);
          }}
        />
      ))}
    </fieldset>
  );
}

function Userfield({
  field,
  edit,
  creating,
  nativeFiles,
  nativeDirty,
  nativeLoadPending,
  nativeUnloaded,
  onChange,
  readEdit,
  ref,
}: {
  field: UserfieldDefinition;
  edit: FieldEdit;
  creating: boolean;
  nativeFiles: boolean;
  nativeDirty: boolean;
  nativeLoadPending: boolean;
  nativeUnloaded: boolean;
  onChange: (edit: FieldEdit) => void;
  readEdit: () => FieldEdit;
  ref?: Ref<UserfieldControl>;
}) {
  const { t } = useI18n();
  const id = useId();
  const scripts = useNativeScriptBindings();
  const client = useQueryClient();
  const settings = useUserSettings(field.type === "number-currency");
  const [search, setSearch] = useState("");
  const checkbox = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const singleSelect = useRef<HTMLSelectElement>(null);
  const linkTitle = useRef<HTMLInputElement>(null);
  const linkTarget = useRef<HTMLInputElement>(null);
  const createListeners = useRef<Array<() => void>>([]);
  const [createIndeterminate, setCreateIndeterminate] = useState(false);
  const [createRequiredRemoved, setCreateRequiredRemoved] = useState(false);
  useLayoutEffect(() => {
    const select = singleSelect.current;

    if (
      nativeDirty &&
      select &&
      !Array.from(select.options).some((option) => option.value === edit.value)
    )
      select.selectedIndex = -1;
  });
  useEffect(
    () => () => {
      for (const remove of createListeners.current) remove();
      createListeners.current = [];
    },
    [],
  );
  const clearDeleteInstalled = useRef(false);
  const [error, setError] = useState<Error>();

  const [originalFile, setOriginalFile] = useState(() =>
    nativeFiles && (field.type === "file" || field.type === "image") && edit.value
      ? userfieldFile(edit.value)
      : undefined,
  );

  const [nativePreview, setNativePreview] = useState<{
    source?: string;
    visible: boolean;
  }>(() => ({
    source: originalFile ? edit.value : undefined,
    visible: originalFile !== undefined,
  }));

  const hideNativePreview = () => setNativePreview((current) => ({ ...current, visible: false }));

  const [fileView, setFileView] = useState<
    | { kind: "stored" | "deleted" }
    | { kind: "selected"; name: string }
    | { kind: "cleared"; source?: string }
  >({ kind: "stored" });

  const [clearedLink, setClearedLink] = useState<{ title: string; link: string }>();
  const [nativeLoaded, setNativeLoaded] = useState(false);

  useImperativeHandle(ref, () => ({
    initializeCreate: (definition, current, control) => {
      if (
        (definition.type === "date" || definition.type === "datetime") &&
        definition.default_value === "now"
      ) {
        const value = nativeUserfieldDateNow(t("moment_locale"), definition.type);

        if (control instanceof HTMLSelectElement && control.multiple) {
          for (const option of control.options) option.selected = option.value === value;
        } else control.value = value;

        if (field.type === "link-with-title")
          setClearedLink({
            title: linkTitle.current?.value ?? "",
            link: linkTarget.current?.value ?? "",
          });

        onChange({
          ...current,
          value:
            control instanceof HTMLInputElement && control.type === "checkbox"
              ? control.checked
                ? "1"
                : "0"
              : control instanceof HTMLSelectElement && control.multiple
                ? Array.from(control.selectedOptions, (option) => option.value).join(",")
                : field.type === "preset-list"
                  ? value
                  : control instanceof HTMLInputElement &&
                      control.type === "datetime-local" &&
                      control.value
                    ? control.value.replace("T", " ").padEnd(19, ":00")
                    : control.value,
        });
      } else if (definition.type === "checkbox" && Number(definition.input_required) === 1) {
        if (control instanceof HTMLInputElement) control.indeterminate = true;
        setCreateIndeterminate(true);

        if (control instanceof HTMLInputElement && control.type === "checkbox")
          onChange({ ...current, value: control.checked ? "1" : "0" });

        const acknowledge = () => {
          control.required = false;
          setCreateRequiredRemoved(true);
          setCreateIndeterminate(
            control instanceof HTMLInputElement ? control.indeterminate : false,
          );
          const current = readEdit();

          onChange({
            ...current,
            dirty: nativeDirty || current.dirty,
            value:
              control instanceof HTMLInputElement && control.type === "checkbox"
                ? control.checked
                  ? "1"
                  : "0"
                : current.value,
          });
        };

        control.addEventListener("change", acknowledge);
        createListeners.current.push(() => control.removeEventListener("change", acknowledge));
      }
    },
    load: (value, current) => {
      setNativeLoaded(true);

      if (field.type === "file" || field.type === "image") {
        if (!value) return;
        // Native Load stops at malformed packed files rather than applying later keys.
        const parts = value.split("_");
        const display = atob(parts[1]);
        const name = atob(parts[0]);
        clearDeleteInstalled.current = false;
        setOriginalFile({ name, display });
        setNativePreview({ source: value, visible: true });
        setFileView({ kind: "stored" });
      } else if (field.type === "link-with-title") {
        if (!value) return;
        // JSON primitives expose undefined parts; null and malformed JSON stop the callback.
        const loaded: unknown = JSON.parse(value);

        if (loaded === null) throw new TypeError("Invalid packed link value");
        const parts = loadedLinkSchema.parse(loaded);

        setClearedLink({
          title: String(parts.title ?? ""),
          link: String(parts.link ?? ""),
        });
      } else if (field.type === "preset-checklist" && !value) return;

      onChange({
        ...current,
        value:
          field.type === "checkbox"
            ? Number(value) === 1 || checkbox.current?.checked
              ? "1"
              : "0"
            : (value ?? ""),
      });
    },
    clear: (current) => {
      if (field.type === "file" || field.type === "image") {
        setFileView({ kind: "cleared" });
        const source = String(scripts ? scripts.fileValue() : nativeClearFileValue());
        setFileView({ kind: "cleared", source });
        setNativePreview({ source, visible: true });
        clearDeleteInstalled.current = true;
      } else if (field.type === "link-with-title") {
        const binding = nativeClearLinkValue();
        setClearedLink({
          title: binding.title == null ? "" : String(binding.title),
          link: binding.link == null ? "" : String(binding.link),
        });
        onChange({ ...current, value: "" });
      } else
        onChange({
          ...current,
          value: field.type === "checkbox" && current.value !== "" ? "0" : "",
        });
    },
  }));

  const required = field.input_required === 1 && !createRequiredRemoved;
  // Tracking pages never invoke the common Load initialization or its checkbox acknowledgement.
  const awaitingLoad = (nativeLoadPending || nativeUnloaded) && !nativeLoaded;
  const acknowledge = !awaitingLoad && creating && required && edit.value === "";
  useEffect(() => {
    if (checkbox.current) checkbox.current.indeterminate = createIndeterminate || acknowledge;
  }, [acknowledge, createIndeterminate]);
  const change = (value: string) => onChange({ ...edit, value, dirty: true });
  const choices = (field.config ?? "").split(/\r\n|\r|\n/);
  const selected = edit.value ? edit.value.split(",") : [];
  const visible = (choice: string) => choice.toLowerCase().includes(search.toLowerCase());

  if (field.type === "checkbox")
    return (
      <label className="check-field" htmlFor={id}>
        <input
          id={id}
          data-native-userfield={nativeDirty ? field.name : undefined}
          ref={checkbox}
          type="checkbox"
          checked={Number(edit.value) === 1}
          required={awaitingLoad ? required : acknowledge}
          onChange={(event) => change(event.target.checked ? "1" : "0")}
        />
        <span>{field.caption}</span>
      </label>
    );

  if (field.type === "link-with-title") {
    let link = { title: "", link: "" };

    try {
      const parsed = JSON.parse(edit.value);
      link = linkSchema.parse(parsed);
    } catch {
      /* Empty and invalid native values start with empty inputs. */
    }

    if (clearedLink) link = clearedLink;

    const changeLink = (next: typeof link) => {
      setClearedLink(undefined);
      change(JSON.stringify(next));
    };

    return (
      <fieldset className="field">
        <legend>{field.caption}</legend>
        {nativeDirty ? (
          <input type="hidden" data-native-userfield={field.name} value={edit.value} readOnly />
        ) : null}
        <div className="form-grid">
          <label>
            {t("Title")}
            <input
              ref={linkTitle}
              required={field.input_required === 1}
              value={link.title}
              onKeyUp={nativeDirty ? () => changeLink(link) : undefined}
              onChange={(event) => {
                const next = { ...link, title: event.target.value };

                if (nativeDirty) setClearedLink(next);
                else changeLink(next);
              }}
            />
          </label>
          <label>
            {t("Link")}
            <input
              ref={linkTarget}
              required={field.input_required === 1}
              value={link.link}
              onKeyUp={nativeDirty ? () => changeLink(link) : undefined}
              onChange={(event) => {
                const next = { ...link, link: event.target.value };

                if (nativeDirty) setClearedLink(next);
                else changeLink(next);
              }}
            />
          </label>
        </div>
      </fieldset>
    );
  }

  if (field.type === "file" || field.type === "image") {
    const stored = userfieldFile(edit.value);

    const showSource = nativeFiles
      ? nativePreview.source
      : fileView.kind === "cleared"
        ? fileView.source
        : undefined;

    const showUrl =
      showSource !== undefined
        ? nativeUserfileUrl(showSource, client.getQueryData<JsonObject>(queryKeys.systemConfig))
        : undefined;

    const showStored = nativeFiles ? nativePreview.visible : Boolean(edit.value && !edit.upload);

    const label = nativeFiles
      ? fileView.kind === "deleted"
        ? t("No file selected")
        : fileView.kind === "cleared"
          ? ""
          : fileView.kind === "selected"
            ? fileView.name
            : (originalFile?.display ?? t("No file selected"))
      : (edit.upload?.file.name ?? stored.display);

    const open = () => {
      setError(undefined);

      const source =
        fileView.kind === "cleared"
          ? (fileView.source ?? stored.name)
          : nativeFiles && fileView.kind === "stored"
            ? (originalFile?.name ?? stored.name)
            : stored.name;

      void openApiDocument(filePath("userfiles", source)).catch((error: Error) => setError(error));
    };

    return (
      <div className="field">
        <label htmlFor={id}>{field.caption}</label>
        <input
          id={id}
          data-native-userfield={nativeDirty ? field.name : undefined}
          ref={file}
          type="file"
          required={required && (nativeFiles || !edit.value)}
          data-old-file={nativeFiles ? edit.remove : undefined}
          onChange={(event) => {
            const next = event.target.files?.[0];

            if (nativeFiles) {
              setFileView({ kind: "selected", name: next?.name ?? "" });
              hideNativePreview();
            }

            if (next) {
              const selection: FieldEdit = { ...edit, ...userfieldUpload(next) };

              if (nativeFiles) selection.readFile = () => file.current?.files?.[0];
              onChange(selection);
            }
          }}
        />
        {nativeFiles || edit.value ? <span>{label}</span> : null}
        {nativeFiles || edit.value ? (
          <div className="actions">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                if (nativeFiles) {
                  if (clearDeleteInstalled.current) {
                    setFileView({ kind: "deleted" });
                    hideNativePreview();
                    onChange({
                      ...edit,
                      dirty: edit.dirty || originalFile !== undefined,
                      remove: "",
                    });

                    return;
                  }

                  if (!originalFile) return;
                  setFileView({ kind: "deleted" });
                  hideNativePreview();
                  onChange({
                    ...edit,
                    value: edit.upload ? edit.value : "",
                    dirty: true,
                    remove: originalFile.name,
                  });

                  return;
                }

                if (file.current) file.current.value = "";
                onChange({
                  value: "",
                  dirty: true,
                  remove: edit.remove ?? (edit.upload ? undefined : stored.name),
                });
              }}
            >
              {t("Delete")}
            </button>
            {(nativeFiles ? field.type === "file" : showStored) ? (
              nativeFiles || showUrl !== undefined ? (
                <a
                  className="btn btn-sm btn-ghost"
                  href={showUrl ?? "#"}
                  target="_blank"
                  rel="noopener"
                  hidden={nativeFiles && !showStored}
                  style={nativeFiles && !showStored ? { display: "none" } : undefined}
                >
                  {t("Show")}
                </a>
              ) : (
                <button type="button" className="btn btn-sm btn-ghost" onClick={open}>
                  {t("Show")}
                </button>
              )
            ) : null}
          </div>
        ) : null}
        {field.type === "image" && (nativeFiles || edit.value) ? (
          nativeFiles || showUrl !== undefined ? (
            // Native source keeps an inert href on the preview without link behavior.
            <img
              {...{ href: showUrl }}
              className="entity-picture"
              src={
                showUrl === undefined
                  ? undefined
                  : `${showUrl}?force_serve_as=picture&best_fit_width=250&best_fit_height=250`
              }
              alt={nativeFiles ? field.name : field.caption}
              loading="lazy"
              hidden={nativeFiles && !showStored}
              style={
                nativeFiles
                  ? {
                      display: showStored ? undefined : "none",
                      alignSelf: "flex-start",
                      width: "auto",
                      maxWidth: "100%",
                      maxHeight: "none",
                    }
                  : undefined
              }
            />
          ) : (
            <EntityPicture
              group="userfiles"
              source={
                nativeFiles && fileView.kind === "stored"
                  ? (originalFile?.name ?? stored.name)
                  : (edit.upload?.file ?? stored.name)
              }
              label={field.caption}
              width={250}
              height={250}
            />
          )
        ) : null}
        {error ? <ErrorBlock message={error.message} /> : null}
      </div>
    );
  }

  if (field.type === "preset-checklist")
    return (
      <div className="field">
        <label htmlFor={id}>{field.caption}</label>
        <input
          type="search"
          aria-label={`${t("Search")}: ${field.caption}`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="actions">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() =>
              change(
                choices.filter((choice) => selected.includes(choice) || visible(choice)).join(","),
              )
            }
          >
            {t("Select all")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => change(selected.filter((choice) => !visible(choice)).join(","))}
          >
            {t("Deselect all")}
          </button>
        </div>
        <select
          id={id}
          data-native-userfield={nativeDirty ? field.name : undefined}
          multiple
          required={required}
          size={Math.min(6, Math.max(2, choices.length))}
          value={selected}
          onChange={(event) =>
            change(Array.from(event.target.selectedOptions, (option) => option.value).join(","))
          }
        >
          {choices.map((choice, index) => (
            <option key={`${index}:${choice}`} value={choice} hidden={!visible(choice)}>
              {choice}
            </option>
          ))}
        </select>
      </div>
    );

  if (field.type === "preset-list")
    return (
      <label className="field" htmlFor={id}>
        {field.caption}
        <select
          id={id}
          ref={singleSelect}
          data-native-userfield={nativeDirty ? field.name : undefined}
          required={required}
          value={edit.value}
          onChange={(event) => {
            if (nativeDirty) onChange({ ...edit, value: event.target.value });
            else change(event.target.value);
          }}
        >
          <option value="" />
          {choices.map((choice, index) => (
            <option key={`${index}:${choice}`} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </label>
    );

  if (field.type === "text-multi-line")
    return (
      <label className="field" htmlFor={id}>
        {field.caption}
        <textarea
          id={id}
          data-native-userfield={nativeDirty ? field.name : undefined}
          rows={4}
          required={required}
          value={edit.value}
          onChange={(event) => change(event.target.value)}
        />
      </label>
    );

  if (
    ![
      "text-single-line",
      "number-integral",
      "number-decimal",
      "number-currency",
      "date",
      "datetime",
      "link",
    ].includes(field.type)
  )
    return null;
  const numeric = field.type.startsWith("number-");

  if (nativeDirty && (field.type === "date" || field.type === "datetime"))
    return (
      <NativeDateTimeInput
        id={id}
        name={field.name}
        caption={field.caption}
        value={edit.value}
        required={required}
        datetime={field.type === "datetime"}
        onChange={(value, dirty) => {
          const current = readEdit();
          onChange({ ...current, value, dirty: current.dirty || Boolean(dirty) });
        }}
      />
    );

  return (
    <label className="field" htmlFor={id}>
      {field.caption}
      <input
        id={id}
        data-native-userfield={nativeDirty ? field.name : undefined}
        type={
          numeric
            ? "number"
            : field.type === "datetime"
              ? "datetime-local"
              : field.type === "date"
                ? "date"
                : "text"
        }
        required={required}
        min={numeric ? 0 : undefined}
        step={
          numeric
            ? field.type === "number-integral"
              ? 1
              : 0.0001
            : field.type === "datetime"
              ? 1
              : undefined
        }
        value={field.type === "datetime" ? edit.value.replace(" ", "T") : edit.value}
        onBlur={(event) => {
          if (field.type !== "number-currency") return;

          const next = normalizeCurrencyInput(
            event.currentTarget.value,
            Number(settings.data?.stock_decimal_places_prices_input ?? 2),
            preferenceEnabled(settings.data?.stock_auto_decimal_separator_prices),
          );

          if (next !== event.currentTarget.value) onChange({ ...edit, value: next });
        }}
        onChange={(event) =>
          change(
            field.type === "datetime"
              ? event.target.value
                ? event.target.value.replace("T", " ").padEnd(19, ":00")
                : ""
              : event.target.value,
          )
        }
      />
    </label>
  );
}

// Native property reads on JSON primitives and arrays yield undefined parts.
const loadedLinkSchema = z
  .object({ title: z.unknown().optional(), link: z.unknown().optional() })
  .catch({});

const linkSchema = z.object({
  title: z
    .string()
    .nullish()
    .transform((value) => value ?? ""),
  link: z
    .string()
    .nullish()
    .transform((value) => value ?? ""),
});
