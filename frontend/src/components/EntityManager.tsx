import { useId, useState, type ReactNode, type FormEvent } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, request } from "@/lib/api";
import { entities, type EntityRow, type EntitySpec } from "@/lib/entities";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

type Props = {
  entity: string;
  detail?: (row: EntityRow) => ReactNode;
  actions?: (row: EntityRow) => ReactNode;
  fixed?: Record<string, unknown>;
  title?: string;
};
export function EntityManager({
  entity,
  detail,
  actions,
  fixed,
  title,
}: Props) {
  const baseSpec = entities[entity];
  const custom = useQuery({
    queryKey: ["objects", "userfields"],
    queryFn: () => api.objects("userfields"),
    enabled: !["userfields", "userentities"].includes(entity),
  });
  const customFields = (custom.data ?? []).filter(
    (row) => row.entity === entity,
  );
  const spec: EntitySpec = {
    ...baseSpec,
    fields: [
      ...baseSpec.fields,
      ...customFields.map((row) => ({
        key: `custom:${row.name}`,
        label: String(row.caption),
        type:
          row.type === "number"
            ? ("number" as const)
            : row.type === "date"
              ? ("date" as const)
              : ("textarea" as const),
      })),
    ],
  };
  const prefix = useId();
  const client = useQueryClient();
  const [editing, setEditing] = useState<number | null | undefined>(undefined);
  const [values, setValues] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ["objects", entity],
    queryFn: () => api.objects(entity),
  });
  const refs = [...new Set(spec.fields.flatMap((f) => (f.ref ? [f.ref] : [])))];
  const options = useQueries({
    queries: refs.map((ref) => ({
      queryKey: ["objects", ref],
      queryFn: () =>
        ref === "users" ? request<EntityRow[]>("/api/users") : api.objects(ref),
    })),
  });
  const error = query.error || options.find((q) => q.error)?.error;
  const mutate = useMutation({
    mutationFn: async (operation: {
      kind: "save" | "delete";
      body?: Record<string, unknown>;
      id?: number;
    }) => {
      if (operation.kind === "delete")
        return api.deleteObject(entity, operation.id!);
      return editing === null
        ? api.createObject(entity, operation.body!)
        : api.updateObject(entity, editing!, operation.body!);
    },
    onSuccess: async () => {
      setEditing(undefined);
      setDeleteId(null);
      await client.invalidateQueries();
    },
  });
  const start = (row?: EntityRow) => {
    mutate.reset();
    setEditing(row?.id ?? null);
    setValues(
      Object.fromEntries(
        spec.fields.map((f) => [
          f.key,
          row
            ? f.type === "checkbox"
              ? row[f.key]
                ? "1"
                : "0"
              : String(
                  f.key.startsWith("custom:")
                    ? ((row.userfields as Record<string, string> | undefined)?.[
                        f.key.slice(7)
                      ] ?? "")
                    : (row[f.key] ?? ""),
                )
            : (f.value ?? ""),
        ]),
      ),
    );
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    const body: Record<string, unknown> = { ...fixed };
    for (const field of spec.fields) {
      if (fixed && field.key in fixed) continue;
      if (field.when && !field.when.values.includes(values[field.when.key]))
        continue;
      const value = values[field.key] ?? "";
      if (field.key.startsWith("custom:")) {
        const fields = (body.userfields ?? {}) as Record<string, string>;
        fields[field.key.slice(7)] = value;
        body.userfields = fields;
      } else if (field.type === "checkbox")
        body[field.key] = value === "1" ? 1 : 0;
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
    mutate.mutate({ kind: "save", body });
  };
  const rows = (query.data ?? []).filter(
    (row) =>
      (!fixed ||
        Object.entries(fixed).every(([key, value]) => row[key] === value)) &&
      JSON.stringify(row).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="collection" aria-label={title ?? spec.label}>
      <div className="section-heading">
        <h2>{title ?? spec.label}</h2>
        <button className="btn btn-primary" onClick={() => start()}>
          Add {spec.singular}
        </button>
      </div>
      {editing !== undefined && (
        <form
          onSubmit={save}
          className="panel panel-inner"
          aria-label={
            editing === null ? `Add ${spec.singular}` : `Edit ${spec.singular}`
          }
        >
          <h3>
            {editing === null
              ? `New ${spec.singular}`
              : `Edit ${spec.singular}`}
          </h3>
          <div className="form-grid">
            {spec.fields
              .filter(
                (f) =>
                  (!fixed || !(f.key in fixed)) &&
                  (!f.when || f.when.values.includes(values[f.when.key])),
              )
              .map((field) => {
                const id = `${prefix}-${field.key}`;
                const optionsQuery = field.ref
                  ? options[refs.indexOf(field.ref)]
                  : undefined;
                return (
                  <div className="field" key={field.key}>
                    <label htmlFor={id}>{field.label}</label>
                    {field.type === "multiple" ? (
                      <div
                        role="group"
                        aria-label={field.label}
                        className="weekday-options"
                      >
                        {optionsQuery?.data?.map((row) => {
                          const selected = (values[field.key] ?? "")
                            .split(",")
                            .filter(Boolean);
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
                                      : selected.filter(
                                          (item) => item !== value,
                                        )
                                    ).join(","),
                                  })
                                }
                              />{" "}
                              {String(
                                row.display_name ??
                                  row.name ??
                                  row.username ??
                                  row.id,
                              )}
                            </label>
                          );
                        })}
                        {optionsQuery?.isSuccess &&
                          !optionsQuery.data.length && (
                            <span className="muted">
                              Create a user in Manage to assign this chore.
                            </span>
                          )}
                      </div>
                    ) : field.type === "weekdays" ? (
                      <div
                        role="group"
                        aria-label={field.label}
                        className="weekday-options"
                      >
                        {[
                          "monday",
                          "tuesday",
                          "wednesday",
                          "thursday",
                          "friday",
                          "saturday",
                          "sunday",
                        ].map((day) => {
                          const days = (values[field.key] ?? "")
                            .split(",")
                            .filter(Boolean);
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
                              {day[0].toUpperCase() + day.slice(1)}
                            </label>
                          );
                        })}
                      </div>
                    ) : field.ref || field.choices ? (
                      <select
                        id={id}
                        value={values[field.key] ?? ""}
                        required={field.required}
                        onChange={(e) =>
                          setValues({ ...values, [field.key]: e.target.value })
                        }
                      >
                        <option value="">
                          {field.required ? "Select an option" : "None"}
                        </option>
                        {field.choices?.map((choice) => (
                          <option key={choice}>{choice}</option>
                        ))}
                        {optionsQuery?.data?.map((row) => (
                          <option key={row.id} value={row.id}>
                            {String(
                              row.display_name ??
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
                        value={values[field.key] ?? ""}
                        onChange={(e) =>
                          setValues({ ...values, [field.key]: e.target.value })
                        }
                      />
                    ) : (
                      <input
                        id={id}
                        type={field.type ?? "text"}
                        value={
                          field.type === "checkbox"
                            ? undefined
                            : (values[field.key] ?? "")
                        }
                        checked={
                          field.type === "checkbox"
                            ? values[field.key] === "1"
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
                  </div>
                );
              })}
          </div>
          <div className="actions">
            <button
              className="btn btn-primary"
              disabled={mutate.isPending || options.some((q) => q.isPending)}
            >
              Save {spec.singular}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={mutate.isPending}
              onClick={() => setEditing(undefined)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <ErrorBlock message={error.message} />}
      {mutate.error && <ErrorBlock message={mutate.error.message} />}
      {query.isPending && (
        <LoadingBlock label={`Loading ${spec.label.toLowerCase()}...`} />
      )}
      {(query.data?.length ?? 0) > 5 && (
        <div className="field">
          <label htmlFor={`${prefix}-search`}>
            Search {spec.label.toLowerCase()}
          </label>
          <input
            id={`${prefix}-search`}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
      {query.isSuccess && rows.length === 0 && (
        <p className="empty-state">
          No {spec.label.toLowerCase()} to show. Use Add {spec.singular} to
          create one.
        </p>
      )}
      <ul className="product-list">
        {rows.map((row) => (
          <li key={row.id} className="product-row management-row">
            <div>
              {detail ? (
                detail(row)
              ) : (
                <>
                  <h3>
                    {row.name ??
                      (row.note as string) ??
                      (row.barcode as string) ??
                      `#${row.id}`}
                  </h3>
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
                Edit<span className="sr-only"> {row.name ?? row.id}</span>
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
                {deleteId === row.id ? "Confirm delete" : "Delete"}
                <span className="sr-only"> {row.name ?? row.id}</span>
              </button>
              {deleteId === row.id && (
                <button
                  className="btn btn-ghost"
                  onClick={() => setDeleteId(null)}
                >
                  Cancel delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
