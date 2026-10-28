import { z } from "zod";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { filePath } from "@/lib/api";
import { openApiDocument } from "@/lib/open-document";
import {
  userfieldFile,
  userfieldUpload,
  type FieldEdits,
  type FieldEdit,
  type UserfieldDefinition,
} from "@/lib/shopping-list";
import { EntityPicture } from "./EntityPicture";
import { ErrorBlock } from "./ErrorBlock";

export function UserfieldsEditor({
  fields,
  values,
  creating,
  disabled,
  onChange,
}: {
  fields: UserfieldDefinition[];
  values: FieldEdits;
  creating: boolean;
  disabled: boolean;
  onChange: (name: string, value: FieldEdit) => void;
}) {
  const { t } = useI18n();

  if (!fields.length) return null;

  return (
    <fieldset className="userfields-editor" disabled={disabled}>
      <legend>{t("Userfields")}</legend>
      {fields.map((field) => (
        <Userfield
          key={field.id}
          field={field}
          edit={values[field.name] ?? { value: "", dirty: false }}
          creating={creating}
          onChange={(edit) => onChange(field.name, edit)}
        />
      ))}
    </fieldset>
  );
}

function Userfield({
  field,
  edit,
  creating,
  onChange,
}: {
  field: UserfieldDefinition;
  edit: FieldEdit;
  creating: boolean;
  onChange: (edit: FieldEdit) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [search, setSearch] = useState("");
  const checkbox = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<Error>();
  const required = field.input_required === 1;
  const acknowledge = creating && required && edit.value === "";
  useEffect(() => {
    if (checkbox.current) checkbox.current.indeterminate = acknowledge;
  }, [acknowledge]);
  const change = (value: string) => onChange({ ...edit, value, dirty: true });
  const choices = (field.config ?? "").split(/\r\n|\r|\n/);
  const selected = edit.value ? edit.value.split(",") : [];
  const visible = (choice: string) => choice.toLowerCase().includes(search.toLowerCase());

  if (field.type === "checkbox")
    return (
      <label className="check-field" htmlFor={id}>
        <input
          id={id}
          ref={checkbox}
          type="checkbox"
          checked={Number(edit.value) === 1}
          required={acknowledge}
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

    return (
      <fieldset className="field">
        <legend>{field.caption}</legend>
        <div className="form-grid">
          <label>
            {t("Title")}
            <input
              required={required}
              value={link.title}
              onChange={(event) => change(JSON.stringify({ ...link, title: event.target.value }))}
            />
          </label>
          <label>
            {t("Link")}
            <input
              required={required}
              value={link.link}
              onChange={(event) => change(JSON.stringify({ ...link, link: event.target.value }))}
            />
          </label>
        </div>
      </fieldset>
    );
  }

  if (field.type === "file" || field.type === "image") {
    const stored = userfieldFile(edit.value);

    const open = () => {
      setError(undefined);
      void openApiDocument(filePath("userfiles", stored.name)).catch((error: Error) =>
        setError(error),
      );
    };

    return (
      <div className="field">
        <label htmlFor={id}>{field.caption}</label>
        <input
          id={id}
          ref={file}
          type="file"
          required={required && !edit.value}
          onChange={(event) => {
            const next = event.target.files?.[0];

            if (next) onChange({ ...edit, ...userfieldUpload(next) });
          }}
        />
        {edit.value ? <span>{edit.upload?.file.name ?? stored.display}</span> : null}
        {edit.value ? (
          <div className="actions">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
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
            {!edit.upload ? (
              <button type="button" className="btn btn-sm btn-ghost" onClick={open}>
                {t("Show")}
              </button>
            ) : null}
          </div>
        ) : null}
        {field.type === "image" && edit.value ? (
          <EntityPicture
            group="userfiles"
            source={edit.upload?.file ?? stored.name}
            label={field.caption}
            width={250}
            height={250}
          />
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
          required={required}
          value={edit.value}
          onChange={(event) => change(event.target.value)}
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

  return (
    <label className="field" htmlFor={id}>
      {field.caption}
      <input
        id={id}
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
