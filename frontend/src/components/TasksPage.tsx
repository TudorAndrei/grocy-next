import { useNativeDocumentReload } from "@/lib/native-document";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, queryKeys, request } from "@/lib/api";
import type { Task } from "@/lib/types";
import {
  getTasksPage,
  deleteNativeTask,
  invalidateTasksPage,
  markTaskDeleteStale,
  showDoneTasks,
  taskStatistics,
  taskTableCells,
  type TaskPageRow,
} from "@/lib/tasks-page";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/permissions";
import { useFeatures } from "@/lib/features";
import { usePreferences } from "@/lib/preferences";
import { userfieldsQuery } from "@/lib/userfields";
import { useTableOptions, type TableColumn } from "@/lib/table-options";
import { useTableOrder } from "@/lib/table-order";
import { useTableSnapshot } from "@/lib/table-snapshot";
import { matchesTableSearch } from "@/lib/table-search";
import { tableDate, tablePlainText } from "@/lib/native-table-cell";
import { localTimestampText } from "@/lib/header-clock";
import { useModalDialog } from "@/hooks/useModalDialog";
import { PageHeader } from "./PageHeader";
import { LoadingBlock } from "./LoadingBlock";
import { ErrorBlock } from "./ErrorBlock";
import { EmbeddedEditorLink } from "./EmbeddedEditorLink";
import {
  StockTableCells,
  StockTableOptions,
  StockTableRows,
  StockTableStatus,
} from "./StockTableOptions";
import { StockTableDate } from "./StockTableDate";
import { UserfieldValue } from "./UserfieldValue";
import { useNotify } from "./Toaster";

class TaskActionRequestError extends Error {
  constructor(cause: Error) {
    super("Task action request failed", { cause });
  }
}

type TaskDeleteAnimation = {
  id: number;
  attach: (row: HTMLElement) => void;
  dispose: () => void;
};

// Native Delete removes the row DOM, retaining its cached RowGroup slot until draw.
function DeletedTaskRow() {
  return null;
}

export function TasksPage({
  search,
  onShowDone,
}: {
  search: string;
  onShowDone: (show: boolean) => void;
}) {
  const { t, n, ready: translated } = useI18n();
  const reloadDocument = useNativeDocumentReload("/tasks");
  const can = usePermissions();
  const features = useFeatures();
  const preferences = usePreferences();
  const client = useQueryClient();
  const notify = useNotify();
  const filtersId = useId();
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const alive = useRef(true);
  const actionGeneration = useRef(0);
  const deleteAnimations = useRef(new Set<TaskDeleteAnimation>());
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [showDone, setShowDone] = useState(() => showDoneTasks(search));
  const [deleting, setDeleting] = useState<TaskPageRow>();
  const [reloading, setReloading] = useState(false);
  const [statisticsFailure, setStatisticsFailure] = useState<Error>();

  const [changes, setChanges] = useState({
    version: -1,
    completed: new Set<number>(),
    removed: new Map<number, number>(),
    deleted: new Map<number, number>(),
  });

  useEffect(() => {
    alive.current = true;
    const animations = deleteAnimations.current;

    return () => {
      alive.current = false;

      for (const animation of animations) animation.dispose();
      document.body.classList.remove("cursor-busy");
    };
  }, []);

  const data = useQuery({
    queryKey: ["tasks-page", search],
    queryFn: ({ signal }) => getTasksPage(search, signal),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const statistics = useQuery({
    queryKey: queryKeys.tasks,
    queryFn: () => request<Task[]>("/api/tasks"),
    refetchOnWindowFocus: false,
    enabled: false,
  });

  const refreshStatistics = useCallback(() => {
    const requestedGeneration = actionGeneration.current;
    // Native requests are independent: every reply updates statistics in arrival order.
    void request<Task[]>("/api/tasks")
      .then((value) => {
        if (!alive.current || requestedGeneration !== actionGeneration.current) return;
        client.setQueryData(queryKeys.tasks, value);
        setStatisticsFailure(undefined);
      })
      .catch((error: Error) => {
        if (alive.current && requestedGeneration === actionGeneration.current)
          setStatisticsFailure(error);
      });
  }, [client]);

  useEffect(() => {
    refreshStatistics();
  }, [refreshStatistics]);

  const definitions = useQuery(userfieldsQuery);

  const fields =
    definitions.data?.filter(
      (field) => field.entity === "tasks" && field.show_as_column_in_tables === 1,
    ) ?? [];

  const columns: TableColumn[] = [
    { key: "actions", label: "", configurable: false },
    { key: "name", label: "Task" },
    { key: "due", label: "Due", groupable: true },
    { key: "category", label: "Category", groupable: true, groupIndex: 6 },
    { key: "assigned", label: "Assigned to", groupable: true },
    { key: "status", label: "Hidden status", configurable: false, rendered: false },
    { key: "category_group", label: "Hidden category_id", configurable: false, rendered: false },
    ...fields.map((field) => ({
      key: `custom:${field.name}`,
      label: field.caption,
      labelIsLiteral: true,
      groupable: true,
    })),
  ];

  const options = useTableOptions(
    "tasks-table",
    columns,
    { key: "due", descending: false },
    data.isSuccess && definitions.isSuccess,
  );

  const drawVersion = useRef(options.drawVersion);

  useLayoutEffect(() => {
    drawVersion.current = options.drawVersion;
  });

  const initial = useTableSnapshot(
    data.data,
    data.isSuccess &&
      !data.isFetching &&
      definitions.isSuccess &&
      options.ready &&
      translated &&
      !reloading,
    options.resetVersion,
    data.dataUpdatedAt,
  );

  const nextDays = Number(initial?.value.next_days ?? data.data?.next_days ?? 0);
  const count = taskStatistics(statistics.data ?? [], statistics.dataUpdatedAt, nextDays);

  const cells = new Map(
    (initial?.value.rows ?? []).map((row) => [
      row,
      taskTableCells(row, fields, {
        at: initial?.at ?? 0,
        locale: t("moment_locale"),
        pricePrecision: preferences.priceDisplayPrecision,
        currency: String(features.query.data?.CURRENCY ?? "USD"),
        config: features.query.data,
        t,
      }),
    ]),
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

  const changed = changes.version === options.resetVersion;
  const completed = (row: TaskPageRow) => changed && changes.completed.has(row.id);

  const removed = (row: TaskPageRow) =>
    changed && changes.removed.get(row.id) === options.drawVersion;

  const deleted = (row: TaskPageRow) =>
    changed && changes.deleted.get(row.id) === options.drawVersion;

  const rows = ordered.filter((row) => {
    if (removed(row)) return false;
    const values = cells.get(row)!;

    return (
      matchesTableSearch(values.status.search, status) &&
      matchesTableSearch(values.category.search, category) &&
      matchesTableSearch(
        Object.values(values)
          .map((cell) => cell.search)
          .join("  "),
        text === "all" ? "" : text,
      )
    );
  });

  const changeRow = (
    identity: number,
    change: "complete" | "remove" | "delete",
    draw = options.drawVersion,
  ) =>
    setChanges((current) => {
      const next =
        current.version === options.resetVersion
          ? {
              version: current.version,
              completed: new Set(current.completed),
              removed: new Map(current.removed),
              deleted: new Map(current.deleted),
            }
          : {
              version: options.resetVersion,
              completed: new Set<number>(),
              removed: new Map<number, number>(),
              deleted: new Map<number, number>(),
            };

      if (change === "complete") next.completed.add(identity);
      else if (change === "delete") next.deleted.set(identity, draw);
      else next.removed.set(identity, draw);

      return next;
    });

  const reload = async () => {
    if (reloadDocument()) return;
    // A native page reload discards callbacks owned by the previous table.
    ++actionGeneration.current;
    action.reset();

    for (const animation of deleteAnimations.current) animation.dispose();
    setStatisticsFailure(undefined);
    document.body.classList.remove("cursor-busy");
    setDeleting(undefined);
    setReloading(true);

    try {
      const result = await data.refetch();

      if (alive.current && result.isSuccess) {
        setText("");
        setStatus("");
        setCategory("");
        setShowDone(showDoneTasks(search));
        setDeleting(undefined);
        options.reload();
        refreshStatistics();
      }
    } finally {
      if (alive.current) setReloading(false);
    }
  };

  const action = useMutation({
    onMutate: (operation) => {
      if (alive.current && operation.generation === actionGeneration.current)
        document.body.classList.add("cursor-busy");
    },
    mutationFn: async (operation: {
      row: TaskPageRow;
      kind: "complete" | "undo";
      time: string;
      generation: number;
    }) => {
      await request(`/api/tasks/${operation.row.id}/${operation.kind}`, {
        method: "POST",
        body: JSON.stringify(operation.kind === "complete" ? { done_time: operation.time } : {}),
      }).catch((error: Error) => {
        if (error instanceof ApiError && (error.status === 200 || error.status === 204))
          throw error;

        throw new TaskActionRequestError(error);
      });

      return operation;
    },
    onSuccess: (operation) => {
      void invalidateTasksPage(client);

      if (!alive.current || operation.generation !== actionGeneration.current) return;

      if (operation.kind === "undo") {
        void reload();

        return;
      }

      changeRow(operation.row.id, showDone ? "complete" : "remove");
      document.body.classList.remove("cursor-busy");
      notify({
        message: t("Marked task %s as completed on %s", operation.row.name, operation.time),
      });
      refreshStatistics();
    },
    onError: (error, operation) => {
      if (!alive.current || operation.generation !== actionGeneration.current) return;

      if (error instanceof TaskActionRequestError) {
        document.body.classList.remove("cursor-busy");
        console.error(error.cause);
      } else {
        // Native success-callback exceptions use the browser error channel.
        window.queueMicrotask(() => {
          if (alive.current && operation.generation === actionGeneration.current) throw error;
        });
      }
    },
  });

  const remove = (row: TaskPageRow) => {
    const generation = actionGeneration.current;
    const current = () => alive.current && generation === actionGeneration.current;
    setDeleting(undefined);

    void deleteNativeTask(row.id).then(
      () => {
        if (!current()) {
          markTaskDeleteStale(client);

          return;
        }

        void invalidateTasksPage(client);
        window.queueMicrotask(() => {
          if (!current()) return;
          const element = document.getElementById(`task-${row.id}-row`);

          // A filtered source row has no matching node and no completion listener.
          if (!element) return;
          const nodes = new Set<HTMLElement>();
          let active = true;

          const dispose = () => {
            if (!active) return;
            active = false;
            deleteAnimations.current.delete(animation);

            for (const node of nodes) {
              node.classList.remove("task-delete-fade");
              node.removeEventListener("animationend", finish);
            }
          };

          const finish = () => {
            dispose();

            // Native completion queries the current row ID again, after any draw.
            if (current() && document.getElementById(`task-${row.id}-row`))
              changeRow(row.id, "delete", drawVersion.current);
          };

          const animation: TaskDeleteAnimation = {
            id: row.id,
            dispose,
            attach: (node) => {
              if (!active || nodes.has(node)) return;
              nodes.add(node);
              node.classList.add("task-delete-fade");
              node.addEventListener("animationend", finish);
            },
          };

          deleteAnimations.current.add(animation);
          animation.attach(element);
        });
      },
      (error: Error) => {
        // Even uncertain writes invalidate readers without touching a new page.
        markTaskDeleteStale(client);
        window.queueMicrotask(() => {
          if (!current()) return;

          if (error instanceof ApiError && (error.status === 200 || error.status === 204))
            throw error;
          console.error(error);
        });
      },
    );
  };

  const error = data.error || definitions.error || statistics.error || statisticsFailure;

  const pending = reloading;

  const clear = () => {
    setText("");
    setStatus("");
    setCategory("");
    options.draw();
  };

  const dueFilter = (value: string) => {
    setStatus(value);
    options.draw();
  };

  return (
    <>
      <PageHeader
        title={t("Tasks")}
        actions={
          <>
            {can("MASTER_DATA_EDIT") ? (
              <EmbeddedEditorLink to="/task/new">{t("Add")}</EmbeddedEditorLink>
            ) : null}
            <Link to="/taskcategories" className="btn">
              {t("Task categories")}
            </Link>
          </>
        }
      />
      <div className="tasks-statistics" aria-label={t("Tasks")}>
        {initial && statistics.isSuccess ? (
          <>
            <button
              id="info-overdue-tasks"
              type="button"
              className="btn btn-ghost"
              data-tone="danger"
              onClick={() => dueFilter("overdue")}
            >
              {n(count.overdue, "%s task is overdue to be done", "%s tasks are overdue to be done")}
            </button>
            <button
              id="info-due-today-tasks"
              type="button"
              className="btn btn-ghost"
              onClick={() => dueFilter("duetoday")}
            >
              {n(
                count.dueToday,
                "%s task is due to be done today",
                "%s tasks are due to be done today",
              )}
            </button>
            {nextDays > 0 ? (
              <button
                id="info-due-soon-tasks"
                type="button"
                className="btn btn-ghost"
                data-tone="warn"
                onClick={() => dueFilter("duesoon")}
              >
                {n(count.dueSoon, "%s task is due to be done", "%s tasks are due to be done")}{" "}
                {n(nextDays, "within the next day", "within the next %s days")}
              </button>
            ) : null}
          </>
        ) : null}
        <button type="button" className="btn" onClick={clear}>
          {t("Clear filter")}
        </button>
        <button
          type="button"
          className="btn household-journal-filter-toggle"
          aria-controls={filtersId}
          aria-expanded={filtersExpanded}
          onClick={() => setFiltersExpanded((expanded) => !expanded)}
        >
          {t("Filter")}
        </button>
      </div>
      <div
        id={filtersId}
        className="toolbar journal-filters household-journal-filters"
        data-expanded={filtersExpanded}
      >
        <label className="field">
          <span>{t("Search")}</span>
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
          <span>{t("Status")}</span>
          <select value={status} onChange={(event) => dueFilter(event.target.value)}>
            <option value="">{t("All")}</option>
            <option value="overdue">{t("Overdue")}</option>
            <option value="duetoday">{t("Due today")}</option>
            {nextDays > 0 ? <option value="duesoon">{t("Due soon")}</option> : null}
          </select>
        </label>
        <label className="field">
          <span>{t("Category")}</span>
          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value === "all" ? "" : event.target.value);
              options.draw();
            }}
          >
            <option value="">{t("All")}</option>
            {initial?.value.categories.map((category) => (
              <option key={category.id} value={category.name ?? ""}>
                {category.name}
              </option>
            ))}
            <option value={t("Uncategorized")}>{t("Uncategorized")}</option>
          </select>
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(event) => {
              setShowDone(event.target.checked);
              onShowDone(event.target.checked);
            }}
          />
          {t("Show done tasks")}
        </label>
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
          {t("Retry")}
        </button>
      ) : null}
      {!initial && !data.error && !definitions.error ? (
        <LoadingBlock label={t("Loading tasks…")} />
      ) : null}
      {initial ? (
        <>
          <div className="journal-table-scroll" tabIndex={0} role="region" aria-label={t("Tasks")}>
            <table className="stock-table tasks-table">
              <caption className="sr-only">{t("Tasks")}</caption>
              <thead>
                <tr>
                  <StockTableCells options={options} headers>
                    <th scope="col">
                      <StockTableOptions
                        options={options}
                        onReset={() => {
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
                {rows.map((row) =>
                  deleted(row) ? (
                    <DeletedTaskRow key={row.id} />
                  ) : (
                    <tr
                      key={row.id}
                      id={`task-${row.id}-row`}
                      ref={(element) => {
                        if (!element) return;

                        // React recreates filtered rows; source keeps their pending listeners.
                        for (const animation of deleteAnimations.current)
                          if (animation.id === row.id) animation.attach(element);
                      }}
                      data-due={row.due_type || undefined}
                      data-done={row.done === 1 || completed(row) ? true : undefined}
                      data-local-complete={completed(row) ? true : undefined}
                    >
                      <StockTableCells options={options}>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              aria-label={`${t(row.done === 1 ? "Undo task" : "Mark task as completed")}: ${row.name}`}
                              disabled={
                                pending ||
                                completed(row) ||
                                !can(
                                  row.done === 1 ? "TASKS_UNDO_EXECUTION" : "TASKS_MARK_COMPLETED",
                                )
                              }
                              onClick={() =>
                                action.mutate({
                                  row,
                                  kind: row.done === 1 ? "undo" : "complete",
                                  time: localTimestampText(new Date(), t("moment_locale")),
                                  generation: actionGeneration.current,
                                })
                              }
                            >
                              {t(row.done === 1 ? "Undo" : "Complete")}
                            </button>
                            {can("MASTER_DATA_EDIT") ? (
                              <EmbeddedEditorLink
                                className="btn btn-ghost btn-sm"
                                to={`/task/${row.id}`}
                              >
                                {t("Edit this item")}
                              </EmbeddedEditorLink>
                            ) : null}
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              aria-label={`${t("Delete this item")}: ${row.name}`}
                              disabled={pending}
                              onClick={() => setDeleting(row)}
                            >
                              {t("Delete this item")}
                            </button>
                          </div>
                        </td>
                        <th scope="row">
                          {row.done === 1 || completed(row) ? <s>{row.name}</s> : row.name}
                        </th>
                        <td>
                          <StockTableDate
                            value={tableDate(
                              row.due_date,
                              new Date(initial.at),
                              t("moment_locale"),
                              t,
                            )}
                          />
                        </td>
                        <td>
                          {row.has_category ? row.category_name : <em>{t("Uncategorized")}</em>}
                        </td>
                        <td>{row.assigned_name}</td>
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
                  ),
                )}
              </StockTableRows>
            </table>
          </div>
          {!rows.length ? (
            <p className="empty-state">
              {t(
                text || status || category || showDone
                  ? "No tasks match this filter."
                  : "No open tasks.",
              )}
            </p>
          ) : null}
        </>
      ) : null}
      {deleting ? (
        <DeleteTaskDialog
          row={deleting}
          onClose={() => setDeleting(undefined)}
          onDelete={() => remove(deleting)}
        />
      ) : null}
    </>
  );
}

function DeleteTaskDialog({
  row,
  onClose,
  onDelete,
}: {
  row: TaskPageRow;
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
      <p>{t('Are you sure you want to delete task "%s"?', row.name)}</p>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={onDelete}>
          {t("Yes")}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {t("No")}
        </button>
      </div>
    </dialog>
  );
}
