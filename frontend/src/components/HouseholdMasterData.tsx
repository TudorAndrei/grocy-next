import { nativeObjectUserfieldPresent } from "@/lib/native-userfield-values";
import { useNativeDocumentReload } from "@/lib/native-document";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useFeatures } from "@/lib/features";
import { usePreferences } from "@/lib/preferences";
import { usePermissions } from "@/lib/permissions";
import { request } from "@/lib/api";
import {
  householdMasterRecords,
  householdEditPath,
  type HouseholdMasterEntity,
  type HouseholdMasterRecord,
} from "@/lib/household-master";
import { useTableOptions, type TableColumn } from "@/lib/table-options";
import { useTableOrder } from "@/lib/table-order";
import { useTableSnapshot } from "@/lib/table-snapshot";
import { matchesTableSearch } from "@/lib/table-search";
import {
  nativeTableCell,
  nativeNumberCell,
  tableText,
  tablePlainText,
  type NativeTableRow,
} from "@/lib/native-table-cell";
import { userfieldTableCell } from "@/lib/userfield-table-cell";
import { userfieldsQuery } from "@/lib/userfields";
import { useGenericError } from "@/hooks/useGenericError";
import { useModalDialog } from "@/hooks/useModalDialog";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { UserfieldValue } from "./UserfieldValue";
import { EmbeddedPageDialog, type EmbeddedPage } from "./EmbeddedPageDialog";
import {
  StockTableCells,
  StockTableOptions,
  StockTableRows,
  StockTableStatus,
} from "./StockTableOptions";

type Props = {
  entity: HouseholdMasterEntity;
  includeDisabled: boolean;
  initiallyChecked?: boolean;
  onShowDisabled: (checked: boolean) => void;
};

export function HouseholdMasterData({
  entity,
  includeDisabled,
  initiallyChecked = includeDisabled,
  onShowDisabled,
}: Props) {
  const { t, ready: translated } = useI18n();

  const reloadDocument = useNativeDocumentReload(
    entity === "task_categories" ? "/taskcategories" : "/" + entity,
  );

  const features = useFeatures();
  const preferences = usePreferences();
  const can = usePermissions();
  const editable = can("MASTER_DATA_EDIT");
  const client = useQueryClient();
  const active = useRef(true);
  const [search, setSearch] = useState("");
  const [showDisabled, setShowDisabled] = useState(initiallyChecked);
  const [deleting, setDeleting] = useState<HouseholdMasterRecord>();
  const [merging, setMerging] = useState<HouseholdMasterRecord>();
  const [embedded, setEmbedded] = useState<EmbeddedPage>();
  const [reloading, setReloading] = useState(false);
  const genericError = useGenericError();

  const title =
    entity === "chores" ? "Chores" : entity === "batteries" ? "Batteries" : "Task categories";

  const records = useQuery({
    queryKey: ["household-master", entity],
    queryFn: () => householdMasterRecords(entity),
  });

  const definitions = useQuery(userfieldsQuery);

  const fields =
    definitions.data?.filter(
      (field) => field.entity === entity && field.show_as_column_in_tables === 1,
    ) ?? [];

  const columns: TableColumn[] = [
    { key: "actions", label: "", configurable: false },
    { key: "name", label: "Name" },
    ...(entity === "chores" ? [{ key: "period_type", label: "Period type", groupable: true }] : []),
    { key: "description", label: "Description" },
    ...(entity === "batteries"
      ? [
          { key: "used_in", label: "Used in", groupable: true },
          { key: "charge_interval_days", label: "Charge cycle interval (days)", groupable: true },
        ]
      : []),
    ...fields.map((field) => ({
      key: "custom:" + field.name,
      label: field.caption,
      labelIsLiteral: true,
      groupable: true,
    })),
  ];

  const options = useTableOptions(
    entity === "task_categories" ? "taskcategories-table" : entity + "-table",
    columns,
    { key: "name", descending: false },
    records.isSuccess && definitions.isSuccess,
  );

  const selected = records.data?.filter((row) => includeDisabled || row.active === 1);

  const snapshot = useTableSnapshot(
    selected,
    records.isSuccess &&
      !records.isFetching &&
      definitions.isSuccess &&
      translated &&
      options.ready &&
      !reloading,
    options.resetVersion,
    records.dataUpdatedAt,
  );

  const values = new Map(
    (snapshot?.value ?? []).map((row) => {
      const cell: NativeTableRow = {
        name: nativeTableCell(tableText(row.name)),
        description: nativeTableCell(tableText(row.description)),
        ...Object.fromEntries(
          fields.map((field) => [
            "custom:" + field.name,
            userfieldTableCell(
              field,
              row.userfields?.[field.name] ?? null,
              preferences.priceDisplayPrecision,
              String(features.query.data?.CURRENCY ?? "USD"),
              features.query.data,
              nativeObjectUserfieldPresent(row.userfields, field.name),
            ),
          ]),
        ),
      };

      if (entity === "chores")
        cell.period_type = nativeTableCell(tableText(t(row.period_type ?? "")));

      if (entity === "batteries") {
        cell.used_in = nativeTableCell(tableText(row.used_in));
        cell.charge_interval_days = nativeNumberCell(
          tableText(row.charge_interval_days),
          row.charge_interval_days ?? 0,
        );
      }

      return [row, cell] as const;
    }),
  );

  const ordered = useTableOrder(
    (snapshot?.value ?? []).map((row) => ({ key: String(row.id), row, cells: values.get(row)! })),
    options,
    !!snapshot,
  );

  const rows = ordered.filter((row) =>
    matchesTableSearch(
      Object.values(values.get(row) ?? {})
        .map((cell) => cell.search)
        .join("  "),
      search === "all" ? "" : search,
    ),
  );

  useEffect(() => {
    active.current = true;

    return () => {
      active.current = false;
    };
  }, []);

  const reload = async () => {
    if (reloadDocument()) return;
    setReloading(true);

    try {
      const result = await records.refetch();

      if (result.isSuccess && active.current) options.reload();
    } finally {
      if (active.current) setReloading(false);
    }
  };

  const afterWrite = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["objects", entity] }),
      client.invalidateQueries({ queryKey: [entity] }),
      client.invalidateQueries({ queryKey: ["household-current", entity] }),
      client.invalidateQueries({ queryKey: ["tracking-records"] }),
      client.invalidateQueries({ queryKey: ["calendar"] }),
    ]);

    if (!active.current) return;
    await reload();

    if (!active.current) return;
    setDeleting(undefined);
    setMerging(undefined);
    setSearch("");
    setShowDisabled(false);
    onShowDisabled(false);
  };

  const remove = useMutation({
    mutationFn: (id: number) => request("/api/objects/" + entity + "/" + id, { method: "DELETE" }),
    onSuccess: afterWrite,
  });

  const merge = useMutation({
    mutationFn: ({ keep, discard }: { keep: string; discard: string }) =>
      request("/api/chores/" + keep + "/merge/" + discard, { method: "POST", body: "{}" }),
    onSuccess: afterWrite,
    onError: (error) => genericError("Error while merging", error),
  });

  const openEditor = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      entity === "chores" ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    setEmbedded({ id: Date.now(), url: event.currentTarget.href, dialogType: "" });
  };

  const error = records.error ?? definitions.error;

  return (
    <>
      <PageHeader
        title={t(title)}
        actions={
          <>
            {entity !== "task_categories" ? (
              <Link
                className="btn"
                to={entity === "chores" ? "/choresoverview" : "/batteriesoverview"}
              >
                {t(entity === "chores" ? "Chores overview" : "Batteries overview")}
              </Link>
            ) : null}
            {editable ? (
              <Link
                className="btn btn-primary"
                to={householdEditPath(entity, "new")}
                search={entity === "chores" ? {} : { embedded: "" }}
                onClick={openEditor}
              >
                {t("Add")}
              </Link>
            ) : null}
          </>
        }
      />
      <div className="toolbar journal-filters">
        <label className="field">
          <span>{t("Search")}</span>
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              options.draw();
            }}
          />
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            checked={showDisabled}
            onChange={(event) => {
              setShowDisabled(event.target.checked);
              onShowDisabled(event.target.checked);
            }}
          />
          {t("Show disabled")}
        </label>
        <button
          className="btn"
          type="button"
          onClick={() => {
            setSearch("");
            setShowDisabled(false);
            options.draw();
          }}
        >
          {t("Clear filter")}
        </button>
      </div>
      <StockTableStatus options={options} />
      {error ? (
        <>
          <ErrorBlock message={error.message} />
          <button
            type="button"
            className="btn"
            onClick={() => {
              void reload();
              void definitions.refetch();
            }}
          >
            {t("Retry")}
          </button>
        </>
      ) : null}
      {!snapshot && !error ? <LoadingBlock /> : null}
      {snapshot ? (
        <>
          <div className="journal-table-scroll" tabIndex={0} role="region" aria-label={t(title)}>
            <table className="stock-table household-master-table">
              <caption className="sr-only">{t(title)}</caption>
              <thead>
                <tr>
                  <StockTableCells options={options} headers>
                    <th scope="col">
                      <StockTableOptions
                        options={options}
                        onReset={() => {
                          setSearch("");
                          void reload();
                        }}
                      />
                    </th>
                    {columns.slice(1).map((column) => (
                      <th
                        scope="col"
                        key={column.key}
                        aria-sort={
                          options.sort.key === column.key
                            ? options.sort.descending
                              ? "descending"
                              : "ascending"
                            : "none"
                        }
                      >
                        <button
                          className="journal-sort"
                          type="button"
                          onClick={(event) => options.sortBy(column.key, event.shiftKey)}
                        >
                          {column.labelIsLiteral ? column.label : t(column.label)}
                        </button>
                      </th>
                    ))}
                  </StockTableCells>
                </tr>
              </thead>
              <StockTableRows
                options={options}
                groups={rows.map((row) => {
                  const groupedField = fields.find(
                    (field) => options.groupColumn === `custom:${field.name}`,
                  );

                  const groupedValues = row.userfields ?? {};
                  const cell = values.get(row)?.[options.groupColumn ?? ""];
                  const name = cell ? tablePlainText(cell.html) : "";

                  return {
                    key: cell?.html ?? "",
                    name,
                    label: name,
                    userfield:
                      groupedField &&
                      ["link", "link-with-title", "file", "image"].includes(groupedField.type)
                        ? {
                            field: groupedField,
                            value: groupedValues[groupedField.name] ?? null,
                            present: nativeObjectUserfieldPresent(groupedValues, groupedField.name),
                          }
                        : undefined,
                  };
                })}
              >
                {rows.map((row) => (
                  <tr key={row.id} data-disabled={row.active === 0 ? true : undefined}>
                    <StockTableCells options={options}>
                      <td className="row-actions">
                        {editable ? (
                          <>
                            <Link
                              className="btn btn-ghost btn-sm"
                              to={householdEditPath(entity, row.id)}
                              search={entity === "chores" ? {} : { embedded: "" }}
                              onClick={openEditor}
                            >
                              {t("Edit this item")}
                            </Link>
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              onClick={() => {
                                remove.reset();
                                setDeleting(row);
                              }}
                            >
                              {t("Delete this item")}
                            </button>
                            {entity === "chores" ? (
                              <button
                                className="btn btn-ghost btn-sm"
                                type="button"
                                onClick={() => {
                                  merge.reset();
                                  setMerging(row);
                                }}
                              >
                                {t("Merge")}
                              </button>
                            ) : null}
                          </>
                        ) : null}
                      </td>
                      <th scope="row">{row.name}</th>
                      {entity === "chores" ? <td>{t(row.period_type ?? "")}</td> : null}
                      <td>{row.description}</td>
                      {entity === "batteries" ? (
                        <>
                          <td>{row.used_in}</td>
                          <td>{row.charge_interval_days}</td>
                        </>
                      ) : null}
                      {fields.map((field) => (
                        <td key={field.id}>
                          <UserfieldValue
                            nativeTable
                            field={field}
                            value={row.userfields?.[field.name] ?? null}
                            present={nativeObjectUserfieldPresent(row.userfields, field.name)}
                          />
                        </td>
                      ))}
                    </StockTableCells>
                  </tr>
                ))}
              </StockTableRows>
            </table>
          </div>
          {!rows.length ? <p className="empty-state">{t("No items found.")}</p> : null}
        </>
      ) : null}
      {deleting ? (
        <DeleteDialog
          record={deleting}
          entity={entity}
          pending={remove.isPending}
          error={remove.error}
          onClose={() => setDeleting(undefined)}
          onDelete={() => remove.mutate(deleting.id)}
        />
      ) : null}
      {merging ? (
        <MergeDialog
          record={merging}
          records={snapshot?.value ?? []}
          pending={merge.isPending}
          error={merge.error}
          onClose={() => setMerging(undefined)}
          onMerge={(keep, discard) => merge.mutate({ keep, discard })}
        />
      ) : null}
      {embedded ? (
        <EmbeddedPageDialog page={embedded} onClose={() => setEmbedded(undefined)} />
      ) : null}
    </>
  );
}

function DeleteDialog({
  record,
  entity,
  pending,
  error,
  onClose,
  onDelete,
}: {
  record: HouseholdMasterRecord;
  entity: HouseholdMasterEntity;
  pending: boolean;
  error: Error | null;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();

  const question =
    entity === "chores"
      ? 'Are you sure you want to delete chore "%s"?'
      : entity === "batteries"
        ? 'Are you sure you want to delete battery "%s"?'
        : 'Are you sure you want to delete task category "%s"?';

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
      <p>{t(question, record.name ?? "")}</p>
      {error ? <ErrorBlock message={error.message} /> : null}
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={pending} onClick={onDelete}>
          {t("Yes")}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {t("No")}
        </button>
      </div>
    </dialog>
  );
}

function MergeDialog({
  record,
  records,
  pending,
  error,
  onClose,
  onMerge,
}: {
  record: HouseholdMasterRecord;
  records: HouseholdMasterRecord[];
  pending: boolean;
  error: Error | null;
  onClose: () => void;
  onMerge: (keep: string, discard: string) => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const [keep, setKeep] = useState(String(record.id));
  const [discard, setDiscard] = useState("");

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog"
      aria-label={t("Merge chores")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2>{t("Merge chores")}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();

          if (event.currentTarget.reportValidity()) onMerge(keep, discard);
        }}
      >
        <fieldset disabled={pending}>
          <label className="field">
            {t("Chore to keep")}
            <select required value={keep} onChange={(event) => setKeep(event.target.value)}>
              <option value="" />
              {records.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t("Chore to remove")}
            <select required value={discard} onChange={(event) => setDiscard(event.target.value)}>
              <option value="" />
              {records.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        {error ? <ErrorBlock message={error.message} /> : null}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {t("OK")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
