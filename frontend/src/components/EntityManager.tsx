import { useI18n } from "@/lib/i18n";
import { useEffect, useId, useRef, useState, type ReactNode, type FormEvent } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JsonObject } from "@/lib/json";
import { api, filePath, request } from "@/lib/api";
import {
  entities,
  getEntitySpec,
  type EntityField,
  type EntityRow,
  type EntitySpec,
} from "@/lib/entities";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { useFeatures } from "@/lib/features";
import { userSettingsQuery } from "@/hooks/queries";
import { preferenceEnabled } from "@/lib/preferences";
import { CameraScanner } from "./CameraScanner";
import {
  EntityPictureDetails,
  EntityPictureField,
  type PictureSelection,
  type PictureUpload,
} from "./EntityPicture";

type Props = {
  entity: string;
  detail?: (row: EntityRow) => ReactNode;
  actions?: (row: EntityRow) => ReactNode;
  fixed?: JsonObject;
  title?: string;
  editor?: {
    recordId: number | null;
    initialValues?: Record<string, string>;
    onSaved: (id: number, body: JsonObject) => Promise<void>;
    onCancel: () => void;
  };
};

function customField(row: EntityRow): EntityField {
  const kind = String(row.type);

  return {
    key: `custom:${row.entity}:${row.name}`,
    label: String(row.caption),
    required: Boolean(row.input_required),
    value: row.default_value == null ? "" : String(row.default_value),
    type: kind.startsWith("number")
      ? "number"
      : kind === "datetime"
        ? "datetime-local"
        : kind === "date"
          ? "date"
          : kind === "checkbox"
            ? "checkbox"
            : kind === "preset-checklist"
              ? "multiple"
              : ["text", "text-multi-line"].includes(kind)
                ? "textarea"
                : undefined,
    choices: kind.startsWith("preset-")
      ? String(row.config ?? "")
          .split(/\r\n|\r|\n/)
          .filter(Boolean)
      : undefined,
  };
}

export function EntityManager({ entity, detail, actions, fixed, title, editor }: Props) {
  const { t: tr } = useI18n();

  const features = useFeatures();
  const productSettings = useQuery({ ...userSettingsQuery(), enabled: entity === "products" });
  const definition = getEntitySpec(entity);

  const baseSpec = {
    ...definition,
    label: tr(definition.label),
    singular: tr(definition.singular),
    fields: definition.fields.map((field) => ({
      ...field,
      label: tr(field.label),
      choiceLabels: Object.fromEntries(
        (field.choices ?? []).map((choice) => [choice, tr(field.choiceLabels?.[choice] ?? choice)]),
      ),
    })),
  };

  const energyUnit = String(features.query.data?.ENERGY_UNIT ?? "kcal");

  const labeledFields = baseSpec.fields.map((field) =>
    entity === "products" && field.key === "calories"
      ? { ...field, label: tr("Energy per stock unit (%s)", energyUnit) }
      : field,
  );

  const fieldEnabled = (field: EntityField) =>
    !field.features || field.features.every(features.enabled);

  const [values, setValues] = useState<Record<string, string>>({});

  const pictureGroup =
    entity === "products" ? "productpictures" : entity === "recipes" ? "recipepictures" : null;

  const [picture, setPicture] = useState<PictureSelection>({
    original: null,
    upload: null,
    remove: false,
  });

  const recordTypes = useQuery({
    queryKey: ["objects", "userentities"],
    queryFn: () => api.objects("userentities"),
    enabled: ["userfields", "userobjects"].includes(entity),
  });

  const custom = useQuery({
    queryKey: ["objects", "userfields"],
    queryFn: () => api.objects("userfields"),
    enabled: !["userfields", "userentities"].includes(entity),
  });

  const customFields = (custom.data ?? []).filter(
    (row) =>
      row.entity === entity ||
      (entity === "userobjects" &&
        row.entity ===
          `userentity-${recordTypes.data?.find((type) => type.id === Number(values.userentity_id))?.name}`),
  );

  const spec: EntitySpec = {
    ...baseSpec,
    fields: [
      ...labeledFields.filter(fieldEnabled).map((field) =>
        entity === "userfields" && field.key === "entity"
          ? {
              ...field,
              choiceLabels: Object.fromEntries([
                ...(field.choices ?? []).map((key) => [key, tr(entities.get(key)?.label ?? key)]),
                ...(recordTypes.data ?? []).map((type) => [
                  `userentity-${type.name}`,
                  String(type.caption ?? type.name),
                ]),
              ]),
              choices: [
                ...(field.choices ?? []),
                ...(recordTypes.data ?? []).map((type) => `userentity-${type.name}`),
              ],
            }
          : field,
      ),
      ...customFields.map(customField),
    ],
  };

  const prefix = useId();
  const client = useQueryClient();
  const [editing, setEditing] = useState<number | null | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const editorStarted = useRef(false);

  const query = useQuery({
    queryKey: ["entity-manager", entity],
    queryFn: async () => {
      const [rows, types, conversions] = await Promise.all([
        api.objects(entity),
        entity === "userobjects" ? api.objects("userentities") : [],
        entity === "products" ? api.objects("quantity_unit_conversions_resolved") : [],
      ]);

      return Promise.all(
        rows.map(async (row): Promise<EntityRow> => {
          const fields: Record<string, string | null> = Object.fromEntries(
            Object.entries(row.userfields ?? {}).map(([key, value]) => [
              `custom:${entity}:${key}`,
              value,
            ]),
          );

          const type = types.find((type) => type.id === row.userentity_id);

          if (type) {
            const namespace = `userentity-${type.name}`;

            const values = await request<Record<string, string | null>>(
              `/api/userfields/${encodeURIComponent(namespace)}/${row.id}`,
            );

            for (const [key, value] of Object.entries(values))
              fields[`custom:${namespace}:${key}`] = value;
          }

          const purchase = conversions.find(
            (conversion) =>
              conversion.product_id === row.id &&
              conversion.from_qu_id === row.qu_id_purchase &&
              conversion.to_qu_id === row.qu_id_stock,
          );

          const result: EntityRow = { ...row, custom_values: fields };

          if (entity === "products") {
            result.qu_factor_purchase_to_stock = Number(purchase?.factor ?? 1);
          }

          return result;
        }),
      );
    },
  });

  const refs = [...new Set(spec.fields.flatMap((f) => (f.ref ? [f.ref] : [])))];

  const options = useQueries({
    queries: refs.map((ref) => ({
      queryKey: ["objects", ref],
      queryFn: () => (ref === "users" ? request<EntityRow[]>("/api/users") : api.objects(ref)),
    })),
  });

  const error =
    query.error ||
    custom.error ||
    options.find((q) => q.error)?.error ||
    (entity === "products" ? productSettings.error : null);

  const mutate = useMutation({
    mutationFn: async (operation: {
      kind: "save" | "delete";
      body?: JsonObject;
      fields?: Record<string, Record<string, string>>;
      id?: number;
      picture?: PictureUpload | null;
      removePicture?: string | null;
    }) => {
      if (operation.kind === "delete") return api.deleteObject(entity, operation.id!);

      const removal =
        pictureGroup && operation.removePicture
          ? request(filePath(pictureGroup, operation.removePicture), { method: "DELETE" }).catch(
              (error: Error) => error,
            )
          : undefined;

      const body = { ...operation.body };
      const purchaseFactor = body.qu_factor_purchase_to_stock;

      if (entity === "products") delete body.qu_factor_purchase_to_stock;
      let id = editing!;

      if (editing === null) {
        const created = await api.createObject(entity, body);
        id = Number(created.created_object_id);
        setEditing(id);
      } else await api.updateObject(entity, id, body);

      if (
        entity === "products" &&
        purchaseFactor != null &&
        body.qu_id_purchase !== body.qu_id_stock
      ) {
        const conversions = await api.objects("quantity_unit_conversions");

        const conversion = conversions.find(
          (row) =>
            row.product_id === id &&
            row.from_qu_id === body.qu_id_purchase &&
            row.to_qu_id === body.qu_id_stock,
        );

        if (conversion)
          await api.updateObject("quantity_unit_conversions", conversion.id, {
            factor: purchaseFactor,
          });
        else {
          const resolved = await api.objects("quantity_unit_conversions_resolved");

          const current = resolved.find(
            (row) =>
              row.product_id === id &&
              row.from_qu_id === body.qu_id_purchase &&
              row.to_qu_id === body.qu_id_stock,
          );

          if (Number(current?.factor) !== Number(purchaseFactor))
            await api.createObject("quantity_unit_conversions", {
              product_id: id,
              from_qu_id: body.qu_id_purchase,
              to_qu_id: body.qu_id_stock,
              factor: purchaseFactor,
            });
        }
      }

      for (const [namespace, values] of Object.entries(operation.fields ?? {}))
        await request(`/api/userfields/${encodeURIComponent(namespace)}/${id}`, {
          method: "PUT",
          body: JSON.stringify(values),
        });

      if (pictureGroup && operation.picture) {
        await request(filePath(pictureGroup, operation.picture.name), {
          method: "PUT",
          body: operation.picture.file,
        });
      }

      const removalError = await removal;

      if (removalError) throw removalError;

      return { id, body };
    },
    onSuccess: async (result) => {
      if (!editor) setEditing(undefined);
      setDeleteId(null);
      await client.invalidateQueries();

      if (editor && result) await editor.onSaved(result.id, result.body);
    },
  });

  const selectValue = (field: EntityField, value: string) => {
    setValues((previous) => {
      const next =
        field.key === "userentity_id"
          ? Object.fromEntries(
              Object.entries(previous).filter(([key]) => !key.startsWith("custom:")),
            )
          : { ...previous };

      next[field.key] = value;

      if (entity === "products" && field.key === "qu_id_stock" && value) {
        for (const key of ["qu_id_purchase", "qu_id_consume", "qu_id_price"]) {
          if (!next[key]) next[key] = value;
        }
      }

      return next;
    });
  };

  const start = (row?: EntityRow) => {
    mutate.reset();
    setEditing(row?.id ?? null);
    setPicture({
      original: row?.picture_file_name ?? null,
      upload: null,
      remove: false,
    });

    const initialValues = Object.fromEntries(
      [
        ...baseSpec.fields,
        ...(custom.data ?? [])
          .filter(
            (field) =>
              field.entity === entity ||
              (entity === "userobjects" &&
                field.entity ===
                  `userentity-${recordTypes.data?.find((type) => type.id === Number(row?.userentity_id))?.name}`),
          )
          .map(customField),
      ].map((f) => [
        f.key,
        row
          ? f.type === "checkbox"
            ? Number(f.key.startsWith("custom:") ? row.custom_values?.[f.key] : row[f.key])
              ? "1"
              : "0"
            : String(
                f.key.startsWith("custom:")
                  ? (row.custom_values?.[f.key] ?? "")
                  : (row[f.key] ?? ""),
              )
          : (f.value ?? ""),
      ]),
    );

    if (!row && entity === "products") {
      const settings = productSettings.data;

      const references = [
        ["location_id", "product_presets_location_id", "locations"],
        ["product_group_id", "product_presets_product_group_id", "product_groups"],
        ...["qu_id_stock", "qu_id_purchase", "qu_id_consume", "qu_id_price"].map((key) => [
          key,
          "product_presets_qu_id",
          "quantity_units",
        ]),
      ];

      for (const [field, setting, reference] of references) {
        const value = String(settings?.[setting] ?? -1);

        if (value === "-1") continue;
        const rows = options[refs.indexOf(reference)]?.data ?? [];
        initialValues[field] = rows.some((row) => String(row.id) === value) ? value : "";
      }

      initialValues.default_best_before_days = String(
        settings?.product_presets_default_due_days ?? 0,
      );
      const treatOpened = settings?.product_presets_treat_opened_as_out_of_stock;
      initialValues.treat_opened_as_out_of_stock = preferenceEnabled(
        treatOpened === undefined ? true : treatOpened,
      )
        ? "1"
        : "0";
      initialValues.default_stock_label_type = String(
        settings?.product_presets_default_stock_label_type ?? 0,
      );
    }

    if (row && entity === "products" && row.calories == null) initialValues.calories = "1";

    setValues(!row ? { ...initialValues, ...editor?.initialValues } : initialValues);
  };

  const editorRecord = query.data?.find((row) => row.id === editor?.recordId);
  const editorMissing = editor && editor.recordId !== null && query.isSuccess && !editorRecord;

  useEffect(() => {
    if (
      !editor ||
      editorStarted.current ||
      editorMissing ||
      !query.isSuccess ||
      !features.query.isSuccess ||
      custom.isPending ||
      custom.isError ||
      options.some((query) => !query.isSuccess) ||
      (entity === "products" && !productSettings.isSuccess)
    )
      return;

    editorStarted.current = true;
    start(editorRecord);
  });

  const save = (event: FormEvent) => {
    event.preventDefault();
    const body: JsonObject = {};
    Object.assign(body, fixed);

    for (const field of baseSpec.fields) {
      if (!fieldEnabled(field) && field.disabledValue !== undefined) {
        body[field.key] = Number(field.disabledValue);
      }
    }

    if (
      entity === "products" &&
      features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING") &&
      !features.enabled("STOCK_PRODUCT_OPENED_TRACKING")
    ) {
      body.default_best_before_days_after_open = 1;
    }

    const fields: Record<string, Record<string, string>> = {};

    for (const field of spec.fields) {
      if (fixed && field.key in fixed) continue;

      if (field.when && !field.when.values.includes(values[field.when.key])) continue;
      const value = values[field.key] ?? field.value ?? "";

      if (field.key.startsWith("custom:")) {
        const definition = customFields.find(
          (definition) => customField(definition).key === field.key,
        )!;

        const namespace = String(definition.entity);
        (fields[namespace] ??= {})[String(definition.name)] = value;
      } else if (field.type === "checkbox") body[field.key] = value === "1" ? 1 : 0;
      else if (!value) {
        if (editing !== null && !field.required) body[field.key] = null;
      } else
        body[field.key] =
          field.type === "multiple"
            ? value
            : field.type === "number" || field.ref
              ? Number(value)
              : value;
    }

    if (pictureGroup) {
      if (picture.upload) body.picture_file_name = picture.upload.name;
      else if (picture.remove) body.picture_file_name = null;
    }

    mutate.mutate({
      kind: "save",
      body,
      fields,
      picture: picture.upload,
      removePicture: picture.remove ? picture.original : null,
    });
  };

  const rows = (query.data ?? []).filter(
    (row) =>
      (!fixed || Object.entries(fixed).every(([key, value]) => row[key] === value)) &&
      JSON.stringify(row).toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <section className="collection" aria-label={title ?? spec.label}>
      {!editor ? (
        <div className="section-heading">
          <h2>{title ?? spec.label}</h2>
          <button
            className="btn btn-primary"
            disabled={
              entity === "products" &&
              (productSettings.isPending || options.some((query) => query.isPending))
            }
            onClick={() => start()}
          >
            {tr("Add")} {spec.singular}
          </button>
        </div>
      ) : null}
      {editing !== undefined && (
        <form
          onSubmit={save}
          className="panel panel-inner"
          aria-label={
            editing === null
              ? tr("Add %s", String(spec.singular))
              : tr("Edit %s", String(spec.singular))
          }
        >
          {!editor ? (
            <h3>
              {editing === null
                ? tr("New %s", String(spec.singular))
                : tr("Edit %s", String(spec.singular))}
            </h3>
          ) : null}
          <div className="form-grid">
            {pictureGroup ? (
              <EntityPictureField
                group={pictureGroup}
                value={picture}
                onChange={setPicture}
                disabled={mutate.isPending}
                label={tr("%s picture", entity === "products" ? tr("Product") : tr("Recipe"))}
              />
            ) : null}
            {spec.fields
              .filter(
                (f) =>
                  (!fixed || !(f.key in fixed)) &&
                  (!f.when || f.when.values.includes(values[f.when.key])),
              )
              .map((field) => {
                const id = `${prefix}-${field.key}`;

                const optionsQuery = field.ref ? options[refs.indexOf(field.ref)] : undefined;

                return (
                  <div className="field" key={field.key}>
                    <label htmlFor={id}>{field.label}</label>
                    {field.type === "multiple" ? (
                      <div role="group" aria-label={field.label} className="weekday-options">
                        {(
                          field.choices?.map((name) => ({ id: name, name })) ??
                          optionsQuery?.data ??
                          []
                        ).map((row) => {
                          const selected = (values[field.key] ?? "").split(",").filter(Boolean);

                          const value = String(row.id);

                          return (
                            <label key={row.id}>
                              <input
                                type="checkbox"
                                checked={selected.includes(value)}
                                onChange={(e) =>
                                  setValues({
                                    ...values,
                                    [field.key]: (e.target.checked
                                      ? [...selected, value]
                                      : selected.filter((item) => item !== value)
                                    ).join(","),
                                  })
                                }
                              />{" "}
                              {String(
                                "display_name" in row
                                  ? row.display_name
                                  : "username" in row
                                    ? row.username
                                    : (row.name ?? row.id),
                              )}
                            </label>
                          );
                        })}
                        {optionsQuery?.isSuccess && !optionsQuery.data.length && (
                          <span className="muted">
                            {tr("Create a user in Manage to assign this chore.")}
                          </span>
                        )}
                      </div>
                    ) : field.type === "weekdays" ? (
                      <div role="group" aria-label={field.label} className="weekday-options">
                        {[
                          "monday",
                          "tuesday",
                          "wednesday",
                          "thursday",
                          "friday",
                          "saturday",
                          "sunday",
                        ].map((day) => {
                          const days = (values[field.key] ?? "").split(",").filter(Boolean);

                          return (
                            <label key={day}>
                              <input
                                type="checkbox"
                                checked={days.includes(day)}
                                onChange={(e) =>
                                  setValues({
                                    ...values,
                                    [field.key]: (e.target.checked
                                      ? [...days, day]
                                      : days.filter((value) => value !== day)
                                    ).join(","),
                                  })
                                }
                              />{" "}
                              {tr(day[0].toUpperCase() + day.slice(1))}
                            </label>
                          );
                        })}
                      </div>
                    ) : field.ref || field.choices ? (
                      <select
                        id={id}
                        value={values[field.key] ?? field.value ?? ""}
                        required={field.required}
                        onChange={(e) => selectValue(field, e.target.value)}
                      >
                        <option value="">
                          {field.required ? tr("Select an option") : tr("None")}
                        </option>
                        {field.choices?.map((choice) => (
                          <option key={choice} value={choice}>
                            {field.choiceLabels?.[choice] ?? choice}
                          </option>
                        ))}
                        {optionsQuery?.data?.map((row) => (
                          <option key={row.id} value={row.id}>
                            {String(
                              row.display_name ??
                                row.caption ??
                                row.name ??
                                row.username ??
                                `#${row.id}`,
                            )}
                          </option>
                        ))}
                      </select>
                    ) : field.type === "textarea" ? (
                      <textarea
                        id={id}
                        value={values[field.key] ?? field.value ?? ""}
                        required={field.required}
                        onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                      />
                    ) : (
                      <input
                        id={id}
                        autoFocus={!!editor && field.key === "name"}
                        type={field.type ?? "text"}
                        value={
                          field.type === "checkbox"
                            ? undefined
                            : (values[field.key] ?? field.value ?? "")
                        }
                        checked={
                          field.type === "checkbox"
                            ? (values[field.key] ?? field.value) === "1"
                            : undefined
                        }
                        required={field.required}
                        min={field.min}
                        step={field.type === "number" ? "any" : undefined}
                        onChange={(e) =>
                          setValues({
                            ...values,
                            [field.key]:
                              field.type === "checkbox"
                                ? e.target.checked
                                  ? "1"
                                  : "0"
                                : e.target.value,
                          })
                        }
                      />
                    )}
                    {entity === "product_barcodes" && field.key === "barcode" ? (
                      <CameraScanner onScan={(code) => setValues({ ...values, barcode: code })} />
                    ) : null}
                  </div>
                );
              })}
          </div>
          <div className="actions">
            <button
              className="btn btn-primary"
              disabled={mutate.isPending || options.some((q) => q.isPending)}
            >
              {tr("Save")} {spec.singular}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={mutate.isPending}
              onClick={() => (editor ? editor.onCancel() : setEditing(undefined))}
            >
              {tr("Cancel")}
            </button>
          </div>
        </form>
      )}
      {error && <ErrorBlock message={error.message} />}
      {editorMissing ? <ErrorBlock message={tr("Item not found.")} /> : null}
      {mutate.error && <ErrorBlock message={mutate.error.message} />}
      {(query.isPending || (editor && editing === undefined && !error && !editorMissing)) && (
        <LoadingBlock label={tr("Loading %s...", String(spec.label.toLowerCase()))} />
      )}
      {!editor && (query.data?.length ?? 0) > 5 && (
        <div className="field">
          <label htmlFor={`${prefix}-search`}>
            {tr("Search")} {spec.label.toLowerCase()}
          </label>
          <input
            id={`${prefix}-search`}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
      {!editor && query.isSuccess && rows.length === 0 && (
        <p className="empty-state">
          {tr("No")} {spec.label.toLowerCase()} {tr("to show. Use Add")} {spec.singular}{" "}
          {tr("to create one.")}
        </p>
      )}
      {!editor ? (
        <ul className="product-list">
          {rows.map((row) => (
            <li key={row.id} className="product-row management-row">
              <div>
                {pictureGroup && row.picture_file_name ? (
                  <EntityPictureDetails
                    group={pictureGroup}
                    name={row.picture_file_name}
                    label={tr("%s picture", String(row.name ?? spec.singular))}
                  />
                ) : null}
                {detail ? (
                  detail(row)
                ) : (
                  <>
                    <h3>{row.name ?? row.note ?? row.barcode ?? `#${row.id}`}</h3>
                    {row.description && <p>{row.description}</p>}
                    <p className="muted">
                      {spec.fields
                        .filter(
                          (f) =>
                            f.ref ||
                            f.type === "number" ||
                            f.type === "date" ||
                            f.type === "datetime-local",
                        )
                        .flatMap((f) =>
                          row[f.key] == null
                            ? []
                            : [
                                `${f.label}: ${f.ref ? (options[refs.indexOf(f.ref)]?.data?.find((r) => r.id === row[f.key])?.name ?? row[f.key]) : row[f.key]}`,
                              ],
                        )
                        .join("; ")}
                    </p>
                  </>
                )}
              </div>
              <div className="actions">
                {actions?.(row)}
                <button className="btn btn-ghost" onClick={() => start(row)}>
                  {tr("Edit")}
                  <span className="sr-only"> {row.name ?? row.id}</span>
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={mutate.isPending}
                  onClick={() =>
                    deleteId === row.id
                      ? mutate.mutate({ kind: "delete", id: row.id })
                      : setDeleteId(row.id)
                  }
                >
                  {deleteId === row.id ? tr("Confirm delete") : tr("Delete")}
                  <span className="sr-only"> {row.name ?? row.id}</span>
                </button>
                {deleteId === row.id && (
                  <button className="btn btn-ghost" onClick={() => setDeleteId(null)}>
                    {tr("Cancel delete")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
