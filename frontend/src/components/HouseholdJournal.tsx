import { useNativeDocumentReload } from "@/lib/native-document";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getHouseholdJournal,
  undoNativeHouseholdJournal,
  type HouseholdJournalRow,
  type HouseholdJournalSearch,
} from "@/lib/household-journal";
import { invalidateNativeTracking, type TrackingKind } from "@/lib/household-tracking";
import { ApiError } from "@/lib/api";
import { useDocumentTasks } from "@/lib/document-tasks";
import { useI18n } from "@/lib/i18n";
import { useFeatures } from "@/lib/features";
import { usePermissions } from "@/lib/permissions";
import { usePreferences } from "@/lib/preferences";
import { localTimestampText } from "@/lib/header-clock";
import { userfieldsQuery } from "@/lib/userfields";
import { userfieldTableCell } from "@/lib/userfield-table-cell";
import { useTableOptions, type TableColumn } from "@/lib/table-options";
import { useTableOrder } from "@/lib/table-order";
import { useTableSnapshot } from "@/lib/table-snapshot";
import { matchesTableSearch } from "@/lib/table-search";
import {
  nativeTableCell,
  tableDate,
  tablePlainText,
  tableText,
  tableTime,
  type NativeTableRow,
} from "@/lib/native-table-cell";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { StockTableDate } from "./StockTableDate";
import {
  StockTableCells,
  StockTableOptions,
  StockTableRows,
  StockTableStatus,
} from "./StockTableOptions";
import { UserfieldValue } from "./UserfieldValue";
import { useNotify } from "./Toaster";

const ranges = [
  ["1", "1 month"],
  ["6", "6 months"],
  ["12", "1 year"],
  ["24", "2 years"],
  ["9999", "All"],
];

type UndoMarker = { timestamp: string; sequence: number };

type UndoClock = { at: number; cellVersion: number; sequence: number };

const timeColumns = [
  "record_name",
  "tracked_time",
  "scheduled_execution_time",
  "row_created_timestamp",
] as const;

type TimeColumn = (typeof timeColumns)[number];

function journalCallback(signal: AbortSignal, callback: () => void) {
  window.queueMicrotask(() => {
    if (!signal.aborted) callback();
  });
}

export function HouseholdJournal({
  kind,
  search,
  onChange,
}: {
  kind: TrackingKind;
  search: HouseholdJournalSearch;
  onChange: (search: HouseholdJournalSearch) => void;
}) {
  const { t, ready: translationsReady } = useI18n();

  const reloadDocument = useNativeDocumentReload(
    kind === "chore" ? "/choresjournal" : "/batteriesjournal",
  );

  const features = useFeatures();
  const preferences = usePreferences();
  const can = usePermissions();
  const client = useQueryClient();
  const documentTasks = useDocumentTasks();
  const notify = useNotify();
  const table = useRef<HTMLDivElement>(null);
  const scope = useRef<AbortController>(undefined);
  const undoSequence = useRef(0);
  const attachedRows = useRef(new Set<number>());
  const [text, setText] = useState("");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const filtersId = useId();
  const [reloading, setReloading] = useState(false);

  const [undoDisplay, setUndoDisplay] = useState({
    version: -1,
    cellVersion: -1,
    rows: new Map<number, UndoMarker[]>(),
    muted: new Set<number>(),
    disabled: new Set<number>(),
    refreshed: new Map<number, Partial<Record<TimeColumn, UndoClock>>>(),
  });

  const title = t(kind === "chore" ? "Chores journal" : "Batteries journal");
  const assignments = kind === "chore" && features.enabled("CHORES_ASSIGNMENTS");
  const canUndo = can(kind === "chore" ? "CHORE_UNDO_EXECUTION" : "BATTERIES_UNDO_CHARGE_CYCLE");

  const data = useQuery({
    queryKey: ["household-journal", kind, search[kind], search.months],
    queryFn: () => getHouseholdJournal(kind, search),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const definitions = useQuery(userfieldsQuery);

  const fields =
    definitions.data?.filter(
      (field) =>
        field.entity === (kind === "chore" ? "chores_log" : "battery_charge_cycles") &&
        field.show_as_column_in_tables === 1,
    ) ?? [];

  const columns: TableColumn[] = [
    { key: "actions", label: "", configurable: false },
    { key: "record_name", label: kind === "chore" ? "Chore" : "Battery", groupable: true },
    { key: "tracked_time", label: "Tracked time" },
    ...(kind === "chore"
      ? [
          { key: "scheduled_execution_time", label: "Scheduled tracking time" },
          { key: "row_created_timestamp", label: "Time of tracking", defaultVisible: false },
          { key: "done_by", label: "Done by", groupable: true, rendered: assignments },
        ]
      : []),
    ...fields.map((field) => ({
      key: `custom:${field.name}`,
      label: field.caption,
      labelIsLiteral: true,
      groupable: true,
    })),
  ];

  const options = useTableOptions(
    kind === "chore" ? "chores-journal-table" : "batteries-journal-table",
    columns,
    { key: "tracked_time", descending: true },
    data.isSuccess && definitions.isSuccess,
  );

  const currentCells = useRef({
    version: options.cellVersion,
    visible: new Set(options.visibleColumns.map((column) => column.key)),
  });

  useLayoutEffect(() => {
    currentCells.current = {
      version: options.cellVersion,
      visible: new Set(options.visibleColumns.map((column) => column.key)),
    };
  });

  useLayoutEffect(() => {
    const owner = new AbortController();
    scope.current = owner;

    return () => {
      owner.abort();

      if (scope.current === owner) scope.current = undefined;
    };
  }, [kind, options.resetVersion]);

  const initial = useTableSnapshot(
    data.data,
    data.isSuccess &&
      !data.isFetching &&
      definitions.isSuccess &&
      options.ready &&
      translationsReady &&
      !reloading,
    options.resetVersion,
    data.dataUpdatedAt,
  );

  const now = new Date(initial?.at ?? 0);

  const changed = (row: HouseholdJournalRow) =>
    undoDisplay.version === options.resetVersion && undoDisplay.cellVersion === options.cellVersion
      ? undoDisplay.rows.get(row.id)
      : undefined;

  const isUndone = (row: HouseholdJournalRow) => row.undone === 1 || !!changed(row)?.length;

  const isMuted = (row: HouseholdJournalRow) =>
    row.undone === 1 ||
    (undoDisplay.version === options.resetVersion && undoDisplay.muted.has(row.id));

  const refreshedAt = (row: HouseholdJournalRow, column: TimeColumn) => {
    const update =
      undoDisplay.version === options.resetVersion
        ? undoDisplay.refreshed.get(row.id)?.[column]
        : undefined;

    return update?.cellVersion === options.cellVersion ? update : undefined;
  };

  const undoneDate = (timestamp: string | null, at = now) =>
    tableDate(timestamp, at, t("moment_locale"), t, { plain: true });

  const markers = (row: HouseholdJournalRow) => [
    ...(changed(row) ?? []).map((marker) => ({ ...marker, key: marker.sequence })),
    ...(row.undone === 1 ? [{ timestamp: row.undone_timestamp, sequence: 0, key: "initial" }] : []),
  ];

  const markerDate = (
    row: HouseholdJournalRow,
    marker: { timestamp: string | null; sequence: number },
  ) => {
    const refreshed = refreshedAt(row, "record_name");
    const date = undoneDate(marker.timestamp, refreshed ? new Date(refreshed.at) : now);

    return marker.sequence === 0 || (refreshed && marker.sequence <= refreshed.sequence)
      ? date
      : { ...date, relative: "" };
  };

  const actionDisabled = (row: HouseholdJournalRow) =>
    row.undone === 1 ||
    (kind === "battery" &&
      undoDisplay.version === options.resetVersion &&
      undoDisplay.cellVersion === options.cellVersion &&
      undoDisplay.disabled.has(row.id));

  const dated = (source: string | null, dateOnly = false, at = now) => {
    const value = tableDate(source, at, t("moment_locale"), t);

    if (dateOnly) value.date = value.date.slice(0, 10);

    return {
      ...value,
      html: `<span>${tableText(value.date)}</span> ${tableTime(value.timestamp, value.relative)}`,
    };
  };

  const doneBy = (row: HouseholdJournalRow) => {
    const user = initial?.value.users.find((user) => user.id === row.done_by_user_id);

    return user ? user.display_name || user.username : t("Unknown");
  };

  const dates = new Map(
    (initial?.value.rows ?? []).map((row) => [
      row,
      {
        tracked: dated(row.tracked_time, row.track_date_only === 1),
        scheduled: dated(row.scheduled_execution_time, row.track_date_only === 1),
        created: dated(row.row_created_timestamp),
      },
    ]),
  );

  // Native timeago refresh touches the captured row, while table search/order stay cached.
  const displayDates = new Map(
    (initial?.value.rows ?? []).map((row) => {
      const at = (column: TimeColumn) => {
        const refreshed = refreshedAt(row, column);

        return refreshed ? new Date(refreshed.at) : now;
      };

      return [
        row,
        {
          tracked: dated(row.tracked_time, row.track_date_only === 1, at("tracked_time")),
          scheduled: dated(
            row.scheduled_execution_time,
            row.track_date_only === 1,
            at("scheduled_execution_time"),
          ),
          created: dated(row.row_created_timestamp, false, at("row_created_timestamp")),
        },
      ];
    }),
  );

  const cells = new Map(
    (initial?.value.rows ?? []).map((row) => {
      const date = dates.get(row)!;

      const name =
        `<span>${tableText(row.record_name)}</span>` +
        (row.undone === 1
          ? `<br>${tableText(t("Undone on"))} ${tableText(row.undone_timestamp)} ${tableTime(row.undone_timestamp, undoneDate(row.undone_timestamp).relative)}`
          : "");

      const values: NativeTableRow = {
        record_name: nativeTableCell(name),
        tracked_time: nativeTableCell(
          date.tracked.html + (row.skipped === 1 ? ` ${tableText(t("Skipped"))}` : ""),
        ),
      };

      if (kind === "chore") {
        values.scheduled_execution_time = nativeTableCell(date.scheduled.html);
        values.row_created_timestamp = nativeTableCell(date.created.html);
        values.done_by = nativeTableCell(tableText(doneBy(row)));
      }

      for (const field of fields) {
        values[`custom:${field.name}`] = userfieldTableCell(
          field,
          row.custom_values[field.name] ?? null,
          preferences.priceDisplayPrecision,
          String(features.query.data?.CURRENCY ?? "USD"),
          features.query.data,
          Object.hasOwn(row.custom_values, field.name),
        );
      }

      return [row, values] as const;
    }),
  );

  const ordered = useTableOrder(
    (initial?.value.rows ?? []).map((row) => ({
      key: String(row.id),
      row,
      cells: cells.get(row)!,
    })),
    options,
    !!initial,
  );

  const rows = ordered.filter((row) =>
    matchesTableSearch(
      Object.values(cells.get(row) ?? {})
        .map((cell) => cell.search)
        .join("  "),
      text === "all" ? "" : text,
    ),
  );

  useLayoutEffect(() => {
    // Filtering detaches source rows; CSS-collapsed groups remain attached.
    attachedRows.current = new Set(rows.map((row) => row.id));
  });

  const undo = (identity: number) => {
    const owner = scope.current;

    if (!owner || owner.signal.aborted) return;
    const signal = AbortSignal.any([owner.signal, documentTasks.capture().signal]);
    const version = options.resetVersion;
    const cellVersion = options.cellVersion;

    // Do not abort a sent write: settlement must stale caches even after departure.
    void undoNativeHouseholdJournal(kind, identity)
      .then(
        () =>
          journalCallback(signal, () => {
            const at = Date.now();

            const marker: UndoMarker = {
              timestamp: localTimestampText(new Date(at), t("moment_locale")),
              sequence: ++undoSequence.current,
            };

            const cells = currentCells.current;
            const currentCellVersion = cells.version;
            const attached = attachedRows.current.has(identity);

            setUndoDisplay((current) => {
              const sameTable = current.version === version;

              const next =
                sameTable && current.cellVersion === currentCellVersion
                  ? new Map(current.rows)
                  : new Map<number, UndoMarker[]>();

              const muted = sameTable ? new Set(current.muted) : new Set<number>();

              const disabled =
                sameTable && current.cellVersion === currentCellVersion
                  ? new Set(current.disabled)
                  : new Set<number>();

              const refreshed = sameTable
                ? new Map(current.refreshed)
                : new Map<number, Partial<Record<TimeColumn, UndoClock>>>();

              // Reorder replaces cached cell descendants, but retains the row itself.
              if (cellVersion === currentCellVersion) {
                if (cells.visible.has("record_name"))
                  next.set(identity, [marker, ...(next.get(identity) ?? [])]);
                muted.add(identity);
                disabled.add(identity);
              }

              // Row-ID refresh visits attached visible cells, even for an old button.
              if (attached) {
                const clocks = { ...refreshed.get(identity) };

                for (const column of timeColumns)
                  if (cells.visible.has(column))
                    clocks[column] = {
                      at,
                      cellVersion: currentCellVersion,
                      sequence: marker.sequence,
                    };

                refreshed.set(identity, clocks);
              }

              return {
                version,
                cellVersion: currentCellVersion,
                rows: next,
                muted,
                disabled,
                refreshed,
              };
            });
            notify({
              message: t(
                kind === "chore"
                  ? "Chore execution successfully undone"
                  : "Charge cycle successfully undone",
              ),
            });
          }),
        (error: Error) =>
          journalCallback(signal, () => {
            if (error instanceof ApiError && (error.status === 200 || error.status === 204))
              throw error;
            console.error(error);
          }),
      )
      .finally(() => invalidateNativeTracking(client, kind));
  };

  const reload = async () => {
    if (reloadDocument()) return;
    setReloading(true);

    try {
      const result = await data.refetch();

      if (result.isSuccess) options.reload();
    } finally {
      setReloading(false);
    }
  };

  const clear = () => {
    setText("");

    const next = {
      ...search,
      months: undefined,
      [kind]: kind === "chore" && search.embedded !== undefined ? search.chore : undefined,
    };

    onChange(next);

    if (next.months === search.months && next[kind] === search[kind]) void reload();
  };

  const error = data.error || definitions.error;

  return (
    <>
      <PageHeader
        title={title}
        actions={
          <button
            type="button"
            className="btn household-journal-filter-toggle"
            aria-controls={filtersId}
            aria-expanded={filtersExpanded}
            onClick={() => setFiltersExpanded((expanded) => !expanded)}
          >
            {t("Filter")}
          </button>
        }
      />
      <div
        id={filtersId}
        className="toolbar journal-filters household-journal-filters"
        data-expanded={filtersExpanded}
      >
        <label className="field">
          <span>{t("Search journal")}</span>
          <input
            type="search"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              options.draw();
            }}
          />
        </label>
        <label className="field">
          <span>{t(kind === "chore" ? "Chore" : "Battery")}</span>
          <select
            value={search[kind] ?? ""}
            onChange={(event) => onChange({ ...search, [kind]: event.target.value || undefined })}
          >
            <option value="">{t("All")}</option>
            {search[kind] !== undefined &&
            !initial?.value.records.some((record) => String(record.id) === search[kind]) ? (
              <option value={search[kind]} hidden />
            ) : null}
            {initial?.value.records.map((record) => (
              <option key={record.id} value={record.id}>
                {record.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("Date range")}</span>
          <select
            value={search.months ?? (kind === "chore" ? "12" : "24")}
            onChange={(event) => onChange({ ...search, months: event.target.value })}
          >
            {search.months !== undefined && !ranges.some(([value]) => value === search.months) ? (
              <option value={search.months} hidden />
            ) : null}
            {ranges.map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" onClick={clear}>
          {t("Clear filter")}
        </button>
      </div>
      <StockTableStatus options={options} />
      {error ? <ErrorBlock message={error.message} /> : null}
      {data.error || definitions.error ? (
        <button
          type="button"
          className="btn"
          onClick={() => {
            void reload();
            void definitions.refetch();
          }}
        >
          {t("Retry journal")}
        </button>
      ) : null}
      {!initial && !data.error && !definitions.error ? (
        <LoadingBlock label={t("Loading journal…")} />
      ) : null}
      {initial ? (
        <>
          <p className="toolbar-note" role="status">
            {t("%s rows", String(rows.length))}
          </p>
          <div
            className="journal-table-scroll"
            tabIndex={0}
            role="region"
            aria-label={title}
            ref={table}
          >
            <table className="stock-table journal-table household-journal">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr>
                  <StockTableCells options={options} headers>
                    <th scope="col">
                      <StockTableOptions
                        options={options}
                        onReset={() => {
                          setText("");
                          void reload();
                        }}
                      />
                    </th>
                    {columns.flatMap((column) =>
                      column.key === "actions" || column.rendered === false
                        ? []
                        : [
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
                                type="button"
                                className="journal-sort"
                                onClick={(event) => options.sortBy(column.key, event.shiftKey)}
                              >
                                {column.labelIsLiteral ? column.label : t(column.label)}
                              </button>
                            </th>,
                          ],
                    )}
                  </StockTableCells>
                </tr>
              </thead>
              <StockTableRows
                options={options}
                groups={rows.map((row) => {
                  const groupedField = fields.find(
                    (field) => options.groupColumn === `custom:${field.name}`,
                  );

                  const groupedValues = row.custom_values;
                  const cell = cells.get(row)?.[options.groupColumn ?? ""];
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
                            present: Object.hasOwn(groupedValues, groupedField.name),
                          }
                        : undefined,
                  };
                })}
              >
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    data-undone={isMuted(row) ? true : undefined}
                    data-skipped={row.skipped === 1 ? true : undefined}
                    data-late={
                      kind === "chore" &&
                      row.skipped === 0 &&
                      !!row.scheduled_execution_time &&
                      (row.tracked_time ?? "") > row.scheduled_execution_time
                        ? true
                        : undefined
                    }
                  >
                    <StockTableCells options={options}>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-label={`${t(kind === "chore" ? "Undo chore execution" : "Undo charge cycle")} ${row.id}`}
                          disabled={!canUndo || actionDisabled(row)}
                          onClick={() => undo(row.id)}
                        >
                          {t("Undo")}
                        </button>
                      </td>
                      <th scope="row">
                        <span className="household-journal-name">
                          {isUndone(row) ? <s>{row.record_name}</s> : row.record_name}
                        </span>
                        {markers(row).map((marker) => (
                          <small key={marker.key}>
                            {t("Undone on")} <StockTableDate value={markerDate(row, marker)} />
                          </small>
                        ))}
                      </th>
                      <td>
                        <StockTableDate value={displayDates.get(row)!.tracked} />
                        {row.skipped === 1 ? (
                          <>
                            {" "}
                            <span>{t("Skipped")}</span>
                          </>
                        ) : null}
                      </td>
                      {kind === "chore" ? (
                        <>
                          <td>
                            {row.scheduled_execution_time ? (
                              <StockTableDate value={displayDates.get(row)!.scheduled} />
                            ) : null}
                          </td>
                          <td>
                            <StockTableDate value={displayDates.get(row)!.created} />
                          </td>
                          {assignments ? <td>{doneBy(row)}</td> : null}
                        </>
                      ) : null}
                      {fields.map((field) => (
                        <td key={field.id}>
                          <UserfieldValue
                            nativeTable
                            field={field}
                            value={row.custom_values[field.name] ?? null}
                            present={Object.hasOwn(row.custom_values, field.name)}
                          />
                        </td>
                      ))}
                    </StockTableCells>
                  </tr>
                ))}
              </StockTableRows>
            </table>
          </div>
          {!rows.length ? (
            <p className="empty-state">{t("No journal entries match this filter.")}</p>
          ) : null}
        </>
      ) : null}
    </>
  );
}
