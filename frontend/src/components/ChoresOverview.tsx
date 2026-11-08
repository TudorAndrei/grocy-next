import { useNativeDocumentReload } from "@/lib/native-document";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import moment from "moment/min/moment-with-locales.js";
import { z } from "zod";
import { userSettingsQuery } from "@/hooks/queries";
import { useGenericError } from "@/hooks/useGenericError";
import { useModalDialog } from "@/hooks/useModalDialog";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { nativeMainDateFormat } from "@/lib/native-userfield-dates";
import { usePermissions } from "@/lib/permissions";
import { usePreferences } from "@/lib/preferences";
import { ApiError } from "@/lib/api";
import {
  getChoresOverview,
  requestChoreOverviewDetails,
  decodeChoreOverviewDetails,
  requestChoreOverviewCard,
  decodeChoreOverviewCard,
  getChoreStatistics,
  trackChoreOverview,
  rescheduleChoreOverview,
  calculateChoreOverviewAssignments,
  refreshedChoreDue,
  type ChoreOverviewRow,
  type ChoresOverviewSearch,
  type ChoresOverviewContext,
} from "@/lib/chores-overview";
import { invalidateTracking } from "@/lib/household-tracking";
import { userfieldsQuery } from "@/lib/userfields";
import { useTableOptions, type TableColumn } from "@/lib/table-options";
import { useTableSnapshot } from "@/lib/table-snapshot";
import { useTableOrder } from "@/lib/table-order";
import { matchesTableSearch } from "@/lib/table-search";
import {
  nativeTableCell,
  tableDate,
  tableText,
  tablePlainText,
  type NativeTableRow,
} from "@/lib/native-table-cell";
import { userfieldTableCell } from "@/lib/userfield-table-cell";
import { downloadApiDocument } from "@/lib/open-document";
import { printLabel } from "@/lib/printing";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { NativeMainDateInput, type NativeMainDateHandle } from "./NativeMainDateInput";
import {
  StockTableCells,
  StockTableOptions,
  StockTableRows,
  StockTableStatus,
} from "./StockTableOptions";
import { StockTableDate } from "./StockTableDate";
import { UserfieldValue } from "./UserfieldValue";
import { UserPicker } from "./UserPicker";
import { RichText } from "./RichDescription";
import { EmbeddedPageDialog, type EmbeddedPage } from "./EmbeddedPageDialog";
import { useNotify } from "./Toaster";
import { HouseholdRowMenu } from "./HouseholdRowMenu";

type Update = {
  next: string | null;
  last: string;
  assigned: string;
  status: ChoreOverviewRow["due_type"];
  at: number;
};

type Updates = { version: number; rows: Map<number, Update> };

type ChoreCardRequest = { id: number; sequence: number };

type ChoreRescheduleRequest = { id: number; sequence: number; version: number };

type ChoreCardData = { value: ReturnType<typeof decodeChoreOverviewCard>; at: number };

type TrackingInput = {
  row: ChoreOverviewRow;
  now: boolean;
  skipped: boolean;
  alternate?: boolean;
};

type TrackingOperation = TrackingInput & { signal: AbortSignal };

class ChoreTrackingRequestError extends Error {
  constructor(cause: Error) {
    super("Chore tracking request failed", { cause });
  }
}

function trackingRequestFailure(error: Error): never {
  if (error instanceof ApiError && (error.status === 200 || error.status === 204)) throw error;

  throw new ChoreTrackingRequestError(error);
}

export function ChoresOverview({
  search,
  onChange,
}: {
  search: ChoresOverviewSearch;
  onChange: (search: ChoresOverviewSearch) => void;
}) {
  const { t, n, ready: translated } = useI18n();
  const locale = t("moment_locale");
  const reloadDocument = useNativeDocumentReload("/choresoverview");
  const features = useFeatures();
  const assignments = features.enabled("CHORES_ASSIGNMENTS");
  const can = usePermissions();
  const preferences = usePreferences();
  const client = useQueryClient();
  const notify = useNotify();
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [user, setUser] = useState(search.user ?? "");
  const [cardRequest, setCardRequest] = useState<ChoreCardRequest | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const cardSequence = useRef(0);

  const showCard = (id: number) => {
    setCardRequest({ id, sequence: ++cardSequence.current });
    setCardOpen(true);
  };

  const [reschedule, setReschedule] = useState<ChoreRescheduleRequest | null>(null);
  const rescheduleId = useRef<number>(undefined);

  const showReschedule = (id: number) => {
    rescheduleId.current = id;
    setReschedule((current) => ({
      id,
      sequence: (current?.sequence ?? 0) + 1,
      version: options.resetVersion,
    }));
  };

  const [embedded, setEmbedded] = useState<EmbeddedPage>();
  const [reloading, setReloading] = useState(false);
  const [updates, setUpdates] = useState<Updates>({ version: -1, rows: new Map() });
  const [cachedUpdates, setCachedUpdates] = useState<Updates>({ version: -1, rows: new Map() });
  const timers = useRef(new Set<number>());
  const tableVersion = useRef(0);
  const controller = useRef<AbortController>(undefined);
  const pageController = useRef<AbortController>(undefined);
  const startup = useRef(true);
  useEffect(() => {
    const scope = new AbortController();
    pageController.current = scope;

    const timer = window.setTimeout(() => {
      startup.current = false;
    }, 1000);

    return () => {
      scope.abort();
      window.clearTimeout(timer);
    };
  }, []);

  const data = useQuery({
    queryKey: ["chores-overview"],
    queryFn: ({ signal }) => getChoresOverview(signal),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const [statistics, setStatistics] = useState<{
    data?: Awaited<ReturnType<typeof getChoreStatistics>>;
    dataUpdatedAt: number;
    error?: Error;
    isSuccess: boolean;
  }>({
    dataUpdatedAt: 0,
    isSuccess: false,
  });

  const settings = useQuery(userSettingsQuery());
  const definitions = useQuery(userfieldsQuery);

  const fields =
    definitions.data?.filter(
      (field) => field.entity === "chores" && field.show_as_column_in_tables === 1,
    ) ?? [];

  const columns: TableColumn[] = [
    { key: "actions", label: "", configurable: false },
    { key: "name", label: "Chore" },
    { key: "next", label: "Next estimated tracking" },
    { key: "last", label: "Last tracked" },
    { key: "assigned", label: "Assigned to", groupable: true, rendered: assignments },
    { key: "status", label: "Hidden status", rendered: false, configurable: false },
    { key: "user", label: "Hidden assigned to user id", rendered: false, configurable: false },
    ...fields.map((field) => ({
      key: "custom:" + field.name,
      label: field.caption,
      labelIsLiteral: true,
      groupable: true,
    })),
  ];

  const options = useTableOptions(
    "chores-overview-table",
    columns,
    { key: "next", descending: false },
    data.isSuccess && definitions.isSuccess,
  );

  useLayoutEffect(() => {
    const scope = new AbortController();
    const pendingTimers = timers.current;
    controller.current = scope;

    return () => {
      scope.abort();
      document.body.classList.remove("cursor-busy");

      for (const timer of pendingTimers) window.clearTimeout(timer);
      pendingTimers.clear();
    };
  }, [options.resetVersion]);

  const refreshStatistics = useCallback(async () => {
    const signal = controller.current?.signal;

    try {
      const data = await getChoreStatistics(signal);

      if (!signal?.aborted) setStatistics({ data, dataUpdatedAt: Date.now(), isSuccess: true });
    } catch (error) {
      if (!signal?.aborted)
        setStatistics((current) => ({
          ...current,
          error: error instanceof Error ? error : new Error(String(error)),
        }));
    }
  }, []);

  useEffect(() => {
    void refreshStatistics();
  }, [options.resetVersion, refreshStatistics]);

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

  const source = initial?.value;
  useLayoutEffect(() => {
    tableVersion.current = options.resetVersion;
  }, [options.resetVersion]);
  const users = source?.users ?? [];
  const activeUser = assignments && users.some((row) => String(row.id) === user) ? user : "";

  const changed = (row: ChoreOverviewRow) =>
    updates.version === options.resetVersion ? updates.rows.get(row.chore_id) : undefined;

  const cached = (row: ChoreOverviewRow) =>
    cachedUpdates.version === options.resetVersion
      ? cachedUpdates.rows.get(row.chore_id)
      : undefined;

  const dated = (value: string | null, row: ChoreOverviewRow, at: number) => {
    const date = tableDate(value || "-", new Date(at), t("moment_locale"), t);

    if (row.track_date_only === 1) date.date = date.date.slice(0, 10);

    return {
      ...date,
      html: `<span>${tableText(date.date)}</span> ${date.relative ? `<time>${tableText(date.relative)}</time>` : ""}`,
    };
  };

  const rowDates = new Map(
    (source?.rows ?? []).map((row) => {
      const update = changed(row);

      return [
        row,
        {
          next: dated(
            update ? update.next : row.next_estimated_execution_time,
            row,
            update?.at ?? initial?.at ?? 0,
          ),
          last: dated(
            update ? update.last : row.last_tracked_time,
            row,
            update?.at ?? initial?.at ?? 0,
          ),
        },
      ];
    }),
  );

  const assignedName = (row: ChoreOverviewRow) =>
    changed(row)?.assigned ??
    users.find((user) => String(user.id) === String(row.next_execution_assigned_to_user_id))
      ?.display_name ??
    "-";

  const cells = new Map(
    (source?.rows ?? []).map((row) => {
      const update = cached(row);
      const at = update?.at ?? initial?.at ?? 0;

      const dates = {
        next: dated(update ? update.next : row.next_estimated_execution_time, row, at),
        last: dated(update ? update.last : row.last_tracked_time, row, at),
      };

      const assigned =
        update?.assigned ??
        users.find((user) => String(user.id) === String(row.next_execution_assigned_to_user_id))
          ?.display_name ??
        "-";

      const values: NativeTableRow = {
        name: nativeTableCell(tableText(row.name)),
        next: nativeTableCell(dates.next.html, "html"),
        last: nativeTableCell(dates.last.html, "html"),
        assigned: nativeTableCell(`<span>${tableText(assigned)}</span>`, "html"),
        // Native refresh changes status text, but never changes the hidden assignment token.
        status: nativeTableCell(
          update ? update.status : row.due_type + (row.due_type === "duetoday" ? " duesoon" : ""),
          "html",
        ),
        user: nativeTableCell(
          row.next_execution_assigned_to_user_id
            ? `xx${row.next_execution_assigned_to_user_id}xx`
            : "",
        ),
      };

      for (const field of fields)
        values["custom:" + field.name] = userfieldTableCell(
          field,
          row.custom_values[field.name] ?? null,
          preferences.priceDisplayPrecision,
          String(features.query.data?.CURRENCY ?? "USD"),
          features.query.data,
          Object.hasOwn(row.custom_values, field.name),
        );

      return [row, values];
    }),
  );

  const ordered = useTableOrder(
    (source?.rows ?? []).map((row) => ({ key: String(row.chore_id), row, cells: cells.get(row)! })),
    options,
    !!initial,
  );

  const rows = ordered.filter((row) => {
    const value = cells.get(row)!;

    return (
      matchesTableSearch(
        Object.values(value)
          .map((cell) => cell.search)
          .join("  "),
        text === "all" ? "" : text,
      ) &&
      matchesTableSearch(value.status.search, status) &&
      matchesTableSearch(value.user.search, activeUser ? `xx${activeUser}xx` : "")
    );
  });

  const rawSwap = settings.data?.chores_overview_swap_tracking_buttons;

  const swap =
    rawSwap !== undefined &&
    rawSwap !== null &&
    rawSwap !== false &&
    rawSwap !== 0 &&
    rawSwap !== "" &&
    rawSwap !== "0";

  const download = useMutation({
    mutationFn: (id: number) =>
      downloadApiDocument(`/chore/${id}/grocycode?download=true`, "Grocycode.png"),
  });

  const label = useMutation({
    mutationFn: async (id: number) => {
      const signal = controller.current?.signal;
      await printLabel(`/api/chores/${id}/printlabel`, features.query.data ?? {}, signal);

      return signal;
    },
    onSuccess: (signal) => {
      if (!signal?.aborted) notify({ message: t("Label request sent") });
    },
  });

  const track = useMutation({
    mutationFn: async ({ row, now, skipped, alternate, signal }: TrackingOperation) => {
      signal.throwIfAborted();
      document.body.classList.add("cursor-busy");

      const rawDetail = await requestChoreOverviewDetails(row.chore_id, signal).catch(
        trackingRequestFailure,
      );

      signal.throwIfAborted();
      const detail = decodeChoreOverviewDetails(rawDetail);

      const next =
        (skipped || !now) && detail.next_estimated_execution_time
          ? moment(detail.next_estimated_execution_time, undefined, locale)
          : moment().locale(locale);

      const tracked = next.format(
        detail.chore.track_date_only === 1 ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm:ss",
      );

      await trackChoreOverview(row.chore_id, tracked, skipped, signal).catch(
        trackingRequestFailure,
      );
      signal.throwIfAborted();

      const rawResult = await requestChoreOverviewDetails(row.chore_id, signal).catch(
        trackingRequestFailure,
      );

      signal.throwIfAborted();
      const result = decodeChoreOverviewDetails(rawResult);

      return {
        id: row.chore_id,
        name: alternate ? "undefined" : (row.name ?? ""),
        tracked,
        result,
        at: Date.now(),
        signal,
      };
    },
    onSuccess: async ({ id, name, tracked, result, at, signal }) => {
      if (signal.aborted) return;
      const version = options.resetVersion;

      const update: Update = {
        next: result.next_estimated_execution_time,
        last: tracked,
        assigned:
          result.chore.next_execution_assigned_to_user_id !== null
            ? (result.next_execution_assigned_user?.display_name ?? "-")
            : "-",
        status: refreshedChoreDue(
          result.next_estimated_execution_time,
          new Date(at),
          source?.next_x_days ?? 0,
          locale,
        ),
        at,
      };

      const apply = (current: Updates) => {
        const rows =
          current.version === version ? new Map(current.rows) : new Map<number, Update>();

        rows.set(id, update);

        return { version, rows };
      };

      setUpdates(apply);
      document.body.classList.remove("cursor-busy");
      notify({ message: t("Tracked execution of chore %1$s on %2$s", name, tracked) });
      const refreshed = Promise.all([refreshStatistics(), invalidateTracking(client, "chore")]);

      // Native FormFocusDelay becomes zero after this document's first second.
      const timer = window.setTimeout(
        () => {
          timers.current.delete(timer);

          if (signal.aborted || tableVersion.current !== version) return;
          setCachedUpdates(apply);
          options.draw();
        },
        startup.current ? 500 : 0,
      );

      timers.current.add(timer);
      await refreshed;
    },
    onError: (error, operation) => {
      if (operation.signal.aborted) return;

      if (error instanceof ChoreTrackingRequestError) {
        document.body.classList.remove("cursor-busy");
        console.error(error.cause);
      } else {
        window.queueMicrotask(() => {
          if (!operation.signal.aborted) throw error;
        });
      }
    },
  });

  const dispatchTrack = (input: TrackingInput) => {
    const signal = controller.current?.signal;

    if (!signal || signal.aborted) return;
    track.mutate({ ...input, signal });
  };

  const resetTrack = track.reset;
  const resetLabel = label.reset;
  const resetDownload = download.reset;
  useLayoutEffect(() => {
    resetTrack();
    resetLabel();
    resetDownload();
  }, [options.resetVersion, resetTrack, resetLabel, resetDownload]);

  const counts = useMemo(() => {
    const counts = { overdue: 0, today: 0, soon: 0, mine: 0 };
    const now = moment(statistics.dataUpdatedAt).locale(locale);

    for (const row of statistics.data ?? []) {
      const date = moment(row.next_estimated_execution_time, undefined, locale);

      if (date.isBefore(now)) counts.overdue++;
      else if (date.isSameOrBefore(now.clone().endOf("day"))) {
        counts.today++;
        counts.soon++;
      } else if (date.isSameOrBefore(now.clone().add(source?.next_x_days ?? 0, "days")))
        counts.soon++;

      if (Number(row.next_execution_assigned_to_user_id) === source?.current_user_id) counts.mine++;
    }

    return counts;
  }, [
    statistics.data,
    statistics.dataUpdatedAt,
    source?.next_x_days,
    source?.current_user_id,
    locale,
  ]);

  const chooseUser = (value: string) => {
    setUser(value);
    options.draw();

    if (value) onChange({ ...search, user: value });
  };

  const clear = () => {
    setText("");
    setStatus("");
    setUser("");
    options.draw();
    onChange({ ...search, user: undefined });
  };

  const reload = async () => {
    if (reloadDocument()) return;
    const signal = pageController.current?.signal;
    setCardOpen(false);
    setCardRequest(null);
    setReschedule(null);
    setEmbedded(undefined);
    setReloading(true);

    try {
      const result = await data.refetch();

      if (signal?.aborted) return;

      if (result.isSuccess) {
        setText("");
        setStatus("");
        setUser(search.user ?? "");
        options.reload();
      }
    } finally {
      if (!signal?.aborted) setReloading(false);
    }
  };

  const openJournal = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.shiftKey || event.metaKey || event.altKey)
      return;
    event.preventDefault();
    setEmbedded({ id: Date.now(), url: event.currentTarget.href, dialogType: "table" });
  };

  const error =
    data.error ?? definitions.error ?? statistics.error ?? download.error ?? label.error;

  return (
    <>
      <PageHeader
        title={t("Chores overview")}
        actions={
          <Link className="btn" to="/choresjournal">
            {t("Journal")}
          </Link>
        }
      />
      <fieldset className="picker-form-lock" disabled={reloading}>
        {statistics.isSuccess && source ? (
          <div className="toolbar overview-messages">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                setStatus("overdue");
                options.draw();
              }}
            >
              {n(
                counts.overdue,
                "%s chore is overdue to be done",
                "%s chores are overdue to be done",
              )}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                setStatus("duetoday");
                options.draw();
              }}
            >
              {n(
                counts.today,
                "%s chore is due to be done today",
                "%s chores are due to be done today",
              )}
            </button>
            {(source?.next_x_days ?? 0) !== 0 ? (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  setStatus("duesoon");
                  options.draw();
                }}
              >
                {n(counts.soon, "%s chore is due to be done", "%s chores are due to be done")}{" "}
                {n(source?.next_x_days ?? 0, "within the next day", "within the next %s days")}
              </button>
            ) : null}
            {assignments ? (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => chooseUser(String(source?.current_user_id ?? ""))}
              >
                {n(counts.mine, "%s chore is assigned to me", "%s chores are assigned to me")}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="toolbar journal-filters">
          <label className="field">
            {t("Search")}
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
            {t("Status")}
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                options.draw();
              }}
            >
              <option value="">{t("All")}</option>
              <option value="overdue">{t("Overdue")}</option>
              <option value="duetoday">{t("Due today")}</option>
              {(source?.next_x_days ?? 0) > 0 ? (
                <option value="duesoon">{t("Due soon")}</option>
              ) : null}
            </select>
          </label>
          {assignments ? (
            <label className="field">
              {t("Assignment")}
              <select value={activeUser} onChange={(event) => chooseUser(event.target.value)}>
                <option value="" />
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.display_name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button className="btn" type="button" onClick={clear}>
            {t("Clear filter")}
          </button>
        </div>
        <StockTableStatus options={options} />
        {error ? <ErrorBlock message={error.message} /> : null}
        {data.error || definitions.error || statistics.error ? (
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
        {!initial && !error ? <LoadingBlock /> : null}
        {initial ? (
          <>
            <p className="toolbar-note" role="status">
              {t("%s rows", String(rows.length))}
            </p>
            <div
              className="journal-table-scroll"
              tabIndex={0}
              role="region"
              aria-label={t("Chores overview")}
            >
              <table className="stock-table overview-table chores-overview">
                <caption className="sr-only">{t("Chores overview")}</caption>
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
                  {rows.map((row) => {
                    const update = changed(row);
                    const dates = rowDates.get(row)!;

                    return (
                      <tr key={row.chore_id} data-status={update?.status ?? row.due_type}>
                        <StockTableCells options={options}>
                          <td className="row-actions">
                            <button
                              type="button"
                              className="btn btn-sm"
                              aria-label={t(
                                swap ? "Track chore execution now" : "Track next chore schedule",
                              )}
                              disabled={!can("CHORE_TRACK_EXECUTION")}
                              onClick={() => dispatchTrack({ row, now: swap, skipped: false })}
                            >
                              {t("Track")}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm"
                              aria-label={t("Skip next chore schedule")}
                              disabled={
                                !can("CHORE_TRACK_EXECUTION") || row.period_type === "manually"
                              }
                              onClick={() => dispatchTrack({ row, now: false, skipped: true })}
                            >
                              {t("Skip")}
                            </button>
                            <HouseholdRowMenu label={t("More")}>
                              <button
                                type="button"
                                role="menuitem"
                                className="btn btn-ghost"
                                disabled={!can("CHORE_TRACK_EXECUTION")}
                                onClick={() =>
                                  dispatchTrack({
                                    row,
                                    now: !swap,
                                    skipped: false,
                                    alternate: true,
                                  })
                                }
                              >
                                {t(
                                  swap ? "Track next chore schedule" : "Track chore execution now",
                                )}
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="btn btn-ghost"
                                disabled={!can("CHORE_TRACK_EXECUTION")}
                                onClick={() => showReschedule(row.chore_id)}
                              >
                                {t("Reschedule next execution")}
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="btn btn-ghost"
                                onClick={() => showCard(row.chore_id)}
                              >
                                {t("Chore overview")}
                              </button>
                              <Link
                                role="menuitem"
                                className="btn btn-ghost"
                                to="/choresjournal"
                                search={{ chore: String(row.chore_id), embedded: "" }}
                                onClick={openJournal}
                              >
                                {t("Chore journal")}
                              </Link>
                              {can("MASTER_DATA_EDIT") ? (
                                <Link
                                  role="menuitem"
                                  className="btn btn-ghost"
                                  to="/chore/$choreId"
                                  params={{ choreId: String(row.chore_id) }}
                                >
                                  {t("Edit chore")}
                                </Link>
                              ) : null}
                              <button
                                role="menuitem"
                                type="button"
                                className="btn btn-ghost"
                                disabled={download.isPending}
                                onClick={() => download.mutate(row.chore_id)}
                              >
                                {t("Download %s Grocycode", t("Chore"))}
                              </button>
                              {features.enabled("LABEL_PRINTER") ? (
                                <button
                                  role="menuitem"
                                  type="button"
                                  className="btn btn-ghost"
                                  disabled={label.isPending}
                                  onClick={() => label.mutate(row.chore_id)}
                                >
                                  {t("Print %s Grocycode on label printer", t("Chore"))}
                                </button>
                              ) : null}
                            </HouseholdRowMenu>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => showCard(row.chore_id)}
                            >
                              {row.name}
                            </button>
                          </td>
                          <td>
                            <StockTableDate value={dates.next} />
                            {!update && row.is_rescheduled === 1 ? (
                              <span title={t("Rescheduled")}>{t("Rescheduled")}</span>
                            ) : null}
                          </td>
                          <td>
                            <StockTableDate value={dates.last} />
                          </td>
                          {assignments ? (
                            <td>
                              {assignedName(row)}
                              {!update && row.is_reassigned === 1 ? (
                                <span title={t("Reassigned")}>{t("Reassigned")}</span>
                              ) : null}
                            </td>
                          ) : null}
                          {fields.map((field) => (
                            <td key={field.name}>
                              <UserfieldValue
                                nativeTable
                                field={field}
                                value={row.custom_values[field.name]}
                                present={Object.hasOwn(row.custom_values, field.name)}
                              />
                            </td>
                          ))}
                        </StockTableCells>
                      </tr>
                    );
                  })}
                </StockTableRows>
              </table>
            </div>
          </>
        ) : null}
      </fieldset>
      <ChoreCard
        key={options.resetVersion}
        request={cardRequest}
        open={cardOpen}
        onClose={() => setCardOpen(false)}
      />
      {source ? (
        <ChoreReschedule
          key={`reschedule-${options.resetVersion}`}
          request={reschedule?.version === options.resetVersion ? reschedule : null}
          selectedId={rescheduleId}
          users={source.users}
          onSaved={reload}
        />
      ) : null}
      {embedded ? (
        <EmbeddedPageDialog page={embedded} onClose={() => setEmbedded(undefined)} />
      ) : null}
    </>
  );
}

function ChoreCard({
  request,
  open,
  onClose,
}: {
  request: ChoreCardRequest | null;
  open: boolean;
  onClose: () => void;
}) {
  const scope = useRef<AbortController>(undefined);
  const [data, setData] = useState<ChoreCardData>();
  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;

    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!request) return;
    const signal = scope.current?.signal;
    // Native callbacks belong to the page, including hidden and replaced cards.
    void requestChoreOverviewCard(request.id, signal).then(
      (response) => {
        // A successful HTTP read has its own browser callback error channel.
        window.queueMicrotask(() => {
          if (signal?.aborted) return;
          setData({ value: decodeChoreOverviewCard(response), at: Date.now() });
        });
      },
      (error: Error) => {
        if (signal?.aborted) return;

        if (error instanceof ApiError && (error.status === 200 || error.status === 204)) {
          window.queueMicrotask(() => {
            if (!signal?.aborted) throw error;
          });
        } else console.error(error);
      },
    );
  }, [request]);

  return open ? <ChoreCardDialog data={data} onClose={onClose} /> : null;
}

function ChoreCardDialog({
  data,
  onClose,
}: {
  data: ChoreCardData | undefined;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const features = useFeatures();
  const dialog = useModalDialog();
  const [embedded, setEmbedded] = useState<EmbeddedPage>();

  const last = tableDate(
    data?.value.last_tracked ?? t("never"),
    new Date(data?.at ?? 0),
    t("moment_locale"),
    t,
  );

  if (data?.value.chore.track_date_only === 1) last.date = last.date.slice(0, 10);

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog"
      aria-label={t("Chore overview")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="section-heading">
        <h2>{t("Chore overview")}</h2>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
      <h3>{data?.value.chore.name ?? ""}</h3>
      <RichText html={data?.value.description_html ?? ""} />
      <dl className="product-overview-facts">
        <div>
          <dt>{t("Tracked count")}</dt>
          <dd>{data ? data.value.tracked_count || 0 : ""}</dd>
        </div>
        <div>
          <dt>{t("Average execution frequency")}</dt>
          <dd>
            {!data
              ? ""
              : data.value.average_execution_frequency_hours === null
                ? t("Unknown")
                : moment
                    .duration(data.value.average_execution_frequency_hours, "hours")
                    .locale(t("moment_locale"))
                    .humanize()}
          </dd>
        </div>
        <div>
          <dt>{t("Last tracked")}</dt>
          <dd>{data ? <StockTableDate value={last} /> : null}</dd>
        </div>
        {features.enabled("CHORES_ASSIGNMENTS") ? (
          <div>
            <dt>{t("Last done by")}</dt>
            <dd>{data ? data.value.last_done_by?.display_name || t("Unknown") : ""}</dd>
          </div>
        ) : null}
      </dl>
      {data ? (
        <>
          <Link
            className="btn"
            to="/chore/$choreId"
            params={{ choreId: String(data.value.chore.id) }}
          >
            {t("Edit chore")}
          </Link>
          <Link
            className="btn"
            to="/choresjournal"
            search={{ chore: String(data.value.chore.id), embedded: "" }}
            onClick={(event) => {
              if (
                event.button !== 0 ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              setEmbedded({ id: Date.now(), url: event.currentTarget.href, dialogType: "table" });
            }}
          >
            {t("Chore journal")}
          </Link>
        </>
      ) : (
        <>
          <a
            className="btn"
            href="#"
            aria-disabled="true"
            tabIndex={-1}
            onClick={(event) => event.preventDefault()}
          >
            {t("Edit chore")}
          </a>
          <a
            className="btn"
            href="#"
            aria-disabled="true"
            tabIndex={-1}
            onClick={(event) => event.preventDefault()}
          >
            {t("Chore journal")}
          </a>
        </>
      )}
      {embedded ? (
        <EmbeddedPageDialog page={embedded} onClose={() => setEmbedded(undefined)} />
      ) : null}
    </dialog>
  );
}

// Native XHR callbacks report application exceptions through the browser channel.
function rescheduleCallback(signal: AbortSignal, callback: () => void) {
  window.queueMicrotask(() => {
    if (!signal.aborted) callback();
  });
}

function rescheduleFailure(signal: AbortSignal, error: Error, receive?: (error: Error) => void) {
  rescheduleCallback(signal, () => {
    if (error instanceof ApiError && (error.status === 200 || error.status === 204)) throw error;
    receive?.(error);
  });
}

function ChoreReschedule({
  request,
  selectedId,
  users,
  onSaved,
}: {
  request: ChoreRescheduleRequest | null;
  selectedId: RefObject<number | undefined>;
  users: ChoresOverviewContext["users"];
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const genericError = useGenericError();
  const [open, setOpen] = useState(false);
  const dialog = useModalDialog(open);
  const datePicker = useRef<NativeMainDateHandle>(null);
  const controller = useRef<AbortController>(undefined);
  const [name, setName] = useState<string | null>("");
  const [values, setValues] = useState({ date: "", user: "" });

  useLayoutEffect(() => {
    const scope = new AbortController();
    controller.current = scope;

    return () => scope.abort();
  }, []);

  useEffect(() => {
    const signal = controller.current?.signal;

    if (!request || !signal || signal.aborted) return;

    // Each selection has an independent callback, even while the modal is hidden.
    void requestChoreOverviewDetails(request.id, signal).then(
      (response) => {
        rescheduleCallback(signal, () => {
          const source = decodeChoreOverviewDetails(response);
          const dateOnly = source.chore.track_date_only === 1;
          datePicker.current?.ChangeFormat(dateOnly ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm:ss");
          datePicker.current?.SetValue(
            nativeMainDateFormat(
              source.chore.rescheduled_date || source.next_estimated_execution_time || new Date(),
              t("moment_locale"),
              !dateOnly,
            ),
          );
          const user = z.string().catch("").parse(source.chore.next_execution_assigned_to_user_id);
          setValues((current) => ({ ...current, user }));
          setName(source.chore.name);
          setOpen(true);
        });
      },
      (error: Error) => rescheduleFailure(signal, error),
    );
  }, [request, t]);

  const save = (reset: boolean) => {
    const signal = controller.current?.signal;
    const id = selectedId.current;

    if (!signal || signal.aborted || id === undefined) return;
    const date = reset ? null : (datePicker.current?.GetValue() ?? values.date);
    const user = reset ? null : values.user;

    // PUT captures click-time fields/ID; the source calculation rereads its live ID.
    void rescheduleChoreOverview(id, date, user, signal).then(
      () => {
        rescheduleCallback(signal, () => {
          const currentId = selectedId.current;

          if (currentId === undefined) return;
          void calculateChoreOverviewAssignments(String(currentId), signal).then(
            () => {
              rescheduleCallback(signal, () => {
                setOpen(false);
                void onSaved().catch((error: Error) => {
                  rescheduleCallback(signal, () => {
                    throw error;
                  });
                });
              });
            },
            (error: Error) => rescheduleFailure(signal, error, console.error),
          );
        });
      },
      (error: Error) =>
        rescheduleFailure(signal, error, (failure) => {
          genericError("Error while saving, probably this item already exists", failure);
          // ShowGenericError also logs the original XHR response, not the XHR itself.
          console.error(
            failure instanceof ApiError ? (failure.responseText ?? failure.body) : failure,
          );
        }),
    );
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    form.classList.add("was-validated");
    form.reportValidity();

    if (form.checkValidity()) save(false);
  };

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog"
      aria-label={t("Reschedule next execution")}
      onCancel={(event) => {
        event.preventDefault();
        setOpen(false);
      }}
    >
      <h2>{t("Reschedule next execution")}</h2>
      <h3>{name}</h3>
      <form onSubmit={submit} noValidate>
        <fieldset className="picker-form-lock">
          <NativeMainDateInput
            ref={datePicker}
            id="reschedule-time"
            caption={t("Next estimated tracking")}
            required
            value={values.date}
            onChange={(date) => setValues((current) => ({ ...current, date }))}
          />
          <UserPicker
            label={t("Assigned to")}
            users={users}
            value={values.user}
            onChange={(user) => setValues((current) => ({ ...current, user }))}
          />
        </fieldset>
        <div className="actions">
          <button className="btn" type="button" onClick={() => save(true)}>
            {t("Reset")}
          </button>
          <button className="btn" type="button" onClick={() => setOpen(false)}>
            {t("Cancel")}
          </button>
          <button className="btn btn-primary" type="submit">
            {t("OK")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
