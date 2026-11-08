import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  chargeBattery,
  BatteryChargeRequestError,
  getBatteriesOverview,
  getBatteryStatistics,
  initialBatteryTone,
  refreshedBatteryTone,
  type BatteryOverviewRow,
  type BatteryTone,
} from "@/lib/batteries-overview";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/permissions";
import { useFeatures } from "@/lib/features";
import { usePreferences } from "@/lib/preferences";
import { userfieldsQuery } from "@/lib/userfields";
import { userfieldTableCell } from "@/lib/userfield-table-cell";
import {
  nativeTableCell,
  tableDate,
  tableText,
  tablePlainText,
  type NativeTableRow,
} from "@/lib/native-table-cell";
import { useTableOptions, type TableColumn } from "@/lib/table-options";
import { useTableSnapshot } from "@/lib/table-snapshot";
import { useTableOrder } from "@/lib/table-order";
import { matchesTableSearch } from "@/lib/table-search";
import { downloadApiDocument } from "@/lib/open-document";
import { printLabel } from "@/lib/printing";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { Icon } from "./Icon";
import { HouseholdRowMenu } from "./HouseholdRowMenu";
import { BatteryOverviewCard, type BatteryCardRequest } from "./BatteryOverviewCard";
import { EmbeddedPageDialog, type EmbeddedPage } from "./EmbeddedPageDialog";
import { UserfieldValue } from "./UserfieldValue";
import { StockTableDate } from "./StockTableDate";
import {
  StockTableCells,
  StockTableOptions,
  StockTableRows,
  StockTableStatus,
} from "./StockTableOptions";
import { useNotify } from "./Toaster";

type Statistics = Awaited<ReturnType<typeof getBatteryStatistics>>;

type ChargeInput = { row: BatteryOverviewRow; signal: AbortSignal };

type Patch = {
  revision: number;
  tone: BatteryTone;
  last: ReturnType<typeof tableDate>;
  next: ReturnType<typeof tableDate> | null;
};

export function BatteriesOverview() {
  const { t, n, ready: translated } = useI18n();
  const features = useFeatures();
  const preferences = usePreferences();
  const can = usePermissions();
  const client = useQueryClient();
  const notify = useNotify();
  const filtersId = useId();
  const relatedId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [reloading, setReloading] = useState(false);
  const [stats, setStats] = useState<Statistics>();
  const [statsError, setStatsError] = useState<Error>();
  const [dialog, setDialog] = useState<EmbeddedPage>();
  const [cardRequest, setCardRequest] = useState<BatteryCardRequest | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const cardSequence = useRef(0);
  const scope = useRef<AbortController>(undefined);
  const alive = useRef(true);
  const [patches, setPatches] = useState({ version: -1, rows: new Map<number, Patch>() });

  const data = useQuery({
    queryKey: ["batteries-overview"],
    queryFn: ({ signal }) => getBatteriesOverview(signal),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const definitions = useQuery(userfieldsQuery);

  const fields =
    definitions.data?.filter(
      (field) => field.entity === "batteries" && field.show_as_column_in_tables === 1,
    ) ?? [];

  const columns: TableColumn[] = [
    { key: "actions", label: "", configurable: false },
    { key: "name", label: "Battery" },
    { key: "used_in", label: "Used in", groupable: true },
    { key: "last_tracked_time", label: "Last charged" },
    { key: "next_estimated_charge_time", label: "Next planned charge cycle" },
    { key: "status", label: "Hidden status", rendered: false, configurable: false },
    ...fields.map((field) => ({
      key: "custom:" + field.name,
      label: field.caption,
      labelIsLiteral: true,
      groupable: true,
    })),
  ];

  const options = useTableOptions(
    "batteries-overview-table",
    columns,
    { key: "next_estimated_charge_time", descending: false },
    data.isSuccess && definitions.isSuccess,
  );

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

  const days = initial?.value.next_x_days ?? 0;

  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;

    return () => {
      controller.abort();
      document.body.classList.remove("cursor-busy");
    };
  }, [options.resetVersion]);

  const refreshStatistics = useCallback(() => {
    const signal = scope.current?.signal;
    void getBatteryStatistics(days, signal)
      .then((value) => {
        if (!signal?.aborted) {
          setStats(value);
          setStatsError(undefined);
        }
      })
      .catch((error: Error) => {
        if (!signal?.aborted) setStatsError(error);
      });
  }, [days]);

  const initialVersion = initial?.version;
  useEffect(() => {
    if (initialVersion !== undefined) refreshStatistics();
  }, [initialVersion, refreshStatistics]);

  const now = new Date(initial?.at ?? 0);

  const dates = new Map(
    (initial?.value.rows ?? []).map((row) => [
      row,
      {
        last: tableDate(row.last_tracked_time, now, t("moment_locale"), t, {
          id: "battery-" + row.id + "-last-tracked-time",
        }),
        next:
          row.charge_interval_days > 0
            ? tableDate(row.next_estimated_charge_time, now, t("moment_locale"), t, {
                id: "battery-" + row.id + "-next-charge-time",
              })
            : null,
      },
    ]),
  );

  const cells = new Map(
    (initial?.value.rows ?? []).map((row) => {
      const date = dates.get(row)!;

      const value: NativeTableRow = {
        name: nativeTableCell(tableText(row.name)),
        used_in: nativeTableCell(tableText(row.used_in)),
        last_tracked_time: nativeTableCell(date.last.html, "html"),
        next_estimated_charge_time: nativeTableCell(date.next?.html ?? "...", "html"),
        status: nativeTableCell(row.due_type + (row.due_type === "duetoday" ? " duesoon" : "")),
        ...Object.fromEntries(
          fields.map((field) => [
            "custom:" + field.name,
            userfieldTableCell(
              field,
              row.custom_values[field.name] ?? null,
              preferences.priceDisplayPrecision,
              String(features.query.data?.CURRENCY ?? "USD"),
              features.query.data,
              Object.hasOwn(row.custom_values, field.name),
            ),
          ]),
        ),
      };

      return [row, value] as const;
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

  const rows = ordered.filter((row) => {
    const value = cells.get(row)!;

    return (
      (!status || value.status.search.includes(status)) &&
      matchesTableSearch(
        Object.values(value)
          .map((cell) => cell.search)
          .join("  "),
        text === "all" ? "" : text,
      )
    );
  });

  const currentPatch = (id: number) =>
    patches.version === options.resetVersion ? patches.rows.get(id) : undefined;

  const track = useMutation({
    mutationFn: (input: ChargeInput) => {
      document.body.classList.add("cursor-busy");

      return chargeBattery(input.row.id, input.signal);
    },
    onSuccess: (value, input) => {
      if (input.signal.aborted) return;
      document.body.classList.remove("cursor-busy");
      const row = input.row;
      const date = dates.get(row);

      if (!date) return;
      setPatches((current) => {
        const next =
          current.version === options.resetVersion
            ? new Map(current.rows)
            : new Map<number, Patch>();

        const previous = next.get(row.id);
        const showNext = row.charge_interval_days > 0 && value.interval !== 0;
        next.set(row.id, {
          revision: (previous?.revision ?? 0) + 1,
          tone: refreshedBatteryTone(previous?.tone ?? initialBatteryTone(row), value, days),
          last: tableDate(value.trackedTime, new Date(value.at), t("moment_locale"), t),
          next: showNext
            ? tableDate(value.next, new Date(value.at), t("moment_locale"), t)
            : (previous?.next ?? date.next),
        });

        return { version: options.resetVersion, rows: next };
      });
      notify({
        message: t("Tracked charge cycle of battery %1$s on %2$s", row.name, value.trackedTime),
      });
      refreshStatistics();
      void Promise.all([
        client.invalidateQueries({ queryKey: ["batteries"] }),
        client.invalidateQueries({ queryKey: ["household-current", "batteries"] }),
        client.invalidateQueries({ queryKey: ["household-journal", "battery"] }),
        client.invalidateQueries({ queryKey: ["objects", "battery_charge_cycles"] }),
        client.invalidateQueries({ queryKey: ["calendar"] }),
      ]);
    },
    onError: (error, input) => {
      if (input.signal.aborted) return;

      if (error instanceof BatteryChargeRequestError) {
        document.body.classList.remove("cursor-busy");
        console.error(error.cause);
      } else {
        // Native success-callback exceptions use the browser error channel.
        window.queueMicrotask(() => {
          if (!input.signal.aborted) throw error;
        });
      }
    },
  });

  const download = useMutation({
    mutationFn: (id: number) =>
      downloadApiDocument("/battery/" + id + "/grocycode?download=true", "Grocycode.png"),
  });

  const print = useMutation({
    mutationFn: (id: number) =>
      printLabel(
        "/api/batteries/" + id + "/printlabel",
        features.query.data ?? {},
        scope.current?.signal,
      ),
  });

  const openDialog = (event: MouseEvent<HTMLAnchorElement>, type: string) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    setDialog({ id: Date.now(), url: event.currentTarget.href, dialogType: type });
  };

  const showCard = (id: number) => {
    setCardRequest({ id, sequence: ++cardSequence.current });
    setCardOpen(true);
  };

  const reload = async () => {
    setReloading(true);

    try {
      const result = await data.refetch();

      if (alive.current && result.isSuccess) options.reload();
    } finally {
      if (alive.current) setReloading(false);
    }
  };

  const chooseStatus = (value: string) => {
    setStatus(value);
    options.draw();
  };

  const error = data.error ?? definitions.error ?? download.error ?? print.error;

  return (
    <>
      <PageHeader
        title={t("Batteries overview")}
        actions={
          <>
            <button
              type="button"
              className="btn household-related-toggle"
              aria-label={t("Related links")}
              aria-controls={relatedId}
              aria-expanded={relatedOpen}
              onClick={() => setRelatedOpen((open) => !open)}
            >
              <Icon name="more" />
            </button>
            <div id={relatedId} className="household-related-links" data-expanded={relatedOpen}>
              <Link className="btn" to="/batteries">
                {t("Batteries")}
              </Link>
              <Link className="btn" to="/batterytracking">
                {t("Battery tracking")}
              </Link>
              <Link className="btn" to="/batteriesjournal">
                {t("Journal")}
              </Link>
              <Link className="btn btn-ghost" to="/batteriessettings">
                {t("Batteries settings")}
              </Link>
            </div>
          </>
        }
      />
      <div className="household-statistics chips" role="group" aria-label={t("Battery status")}>
        {stats ? (
          <>
            <button
              type="button"
              className="chip"
              data-tone="overdue"
              aria-pressed={status === "overdue"}
              onClick={() => chooseStatus("overdue")}
            >
              {n(
                stats.overdue,
                "%s battery is overdue to be charged",
                "%s batteries are overdue to be charged",
              )}
            </button>
            <button
              type="button"
              className="chip"
              data-tone="today"
              aria-pressed={status === "duetoday"}
              onClick={() => chooseStatus("duetoday")}
            >
              {n(
                stats.dueToday,
                "%s battery is due to be charged today",
                "%s batteries are due to be charged today",
              )}
            </button>
            {days !== 0 ? (
              <button
                type="button"
                className="chip"
                data-tone="due"
                aria-pressed={status === "duesoon"}
                onClick={() => chooseStatus("duesoon")}
              >
                {n(
                  stats.dueSoon,
                  "%s battery is due to be charged",
                  "%s batteries are due to be charged",
                ) +
                  " " +
                  n(days, "within the next day", "within the next %s days")}
              </button>
            ) : null}
          </>
        ) : null}
        <button
          type="button"
          className="btn household-overview-filter-toggle"
          aria-controls={filtersId}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          {t("Filter")}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setText("");
            setStatus("");
            options.draw();
          }}
        >
          {t("Clear filter")}
        </button>
      </div>
      {statsError ? (
        <>
          <ErrorBlock message={statsError.message} />
          <button className="btn" type="button" onClick={refreshStatistics}>
            {t("Retry statistics")}
          </button>
        </>
      ) : null}
      <div
        id={filtersId}
        className="toolbar journal-filters household-overview-filters"
        data-expanded={filtersOpen}
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
          <select value={status} onChange={(event) => chooseStatus(event.target.value)}>
            <option value="">{t("All")}</option>
            <option value="overdue">{t("Overdue")}</option>
            <option value="duetoday">{t("Due today")}</option>
            {days > 0 ? <option value="duesoon">{t("Due soon")}</option> : null}
          </select>
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
      {!initial && !error ? <LoadingBlock /> : null}
      {initial ? (
        <>
          <div
            className="journal-table-scroll"
            role="region"
            aria-label={t("Batteries overview")}
            tabIndex={0}
          >
            <table className="stock-table batteries-overview">
              <caption className="sr-only">{t("Batteries overview")}</caption>
              <thead>
                <tr>
                  <StockTableCells options={options} headers>
                    <th scope="col">
                      <StockTableOptions
                        options={options}
                        onReset={() => {
                          setText("");
                          setStatus("");
                          setCardOpen(false);
                          setCardRequest(null);
                          setDialog(undefined);
                          setStatsError(undefined);
                          track.reset();
                          print.reset();
                          download.reset();
                          void reload();
                        }}
                      />
                    </th>
                    {columns.flatMap((column) =>
                      column.key !== "actions" && column.rendered !== false
                        ? [
                            <th
                              key={column.key}
                              scope="col"
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
                          ]
                        : [],
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
                  const patch = currentPatch(row.id);
                  const tone = patch?.tone ?? initialBatteryTone(row);
                  const date = dates.get(row)!;

                  return (
                    <tr
                      key={row.id}
                      data-battery-id={row.id}
                      data-flash={patch ? (patch.revision % 2 ? "odd" : "even") : undefined}
                      data-info={tone.info ? true : undefined}
                      data-warning={tone.warning ? true : undefined}
                      data-danger={tone.danger ? true : undefined}
                    >
                      <StockTableCells options={options}>
                        <td className="row-actions">
                          {can("BATTERIES_TRACK_CHARGE_CYCLE") ? (
                            <button
                              type="button"
                              className="btn btn-sm"
                              title={t("Track charge cycle")}
                              aria-label={t("Track charge cycle") + " " + row.name}
                              onClick={() => {
                                const signal = scope.current?.signal;

                                if (signal && !signal.aborted) track.mutate({ row, signal });
                              }}
                            >
                              <Icon name="batteries" />
                            </button>
                          ) : null}
                          <HouseholdRowMenu label={t("Actions for %s", row.name)}>
                            <button
                              type="button"
                              role="menuitem"
                              className="btn btn-ghost"
                              onClick={() => showCard(row.id)}
                            >
                              {t("Battery overview")}
                            </button>
                            <Link
                              role="menuitem"
                              className="btn btn-ghost"
                              to="/batteriesjournal"
                              search={{ embedded: "", battery: String(row.id) }}
                              onClick={(event) => openDialog(event, "table")}
                            >
                              {t("Battery journal")}
                            </Link>
                            {can("MASTER_DATA_EDIT") ? (
                              <Link
                                role="menuitem"
                                className="btn btn-ghost"
                                to="/battery/$batteryId"
                                params={{ batteryId: String(row.id) }}
                                search={{ embedded: "" }}
                                onClick={(event) => openDialog(event, "")}
                              >
                                {t("Edit battery")}
                              </Link>
                            ) : null}
                            <button
                              role="menuitem"
                              className="btn btn-ghost"
                              type="button"
                              onClick={() => download.mutate(row.id)}
                            >
                              {t("Download %s Grocycode", t("Battery"))}
                            </button>
                            {features.enabled("LABEL_PRINTER") ? (
                              <button
                                role="menuitem"
                                className="btn btn-ghost"
                                type="button"
                                onClick={() => print.mutate(row.id)}
                              >
                                {t("Print %s Grocycode on label printer", t("Battery"))}
                              </button>
                            ) : null}
                          </HouseholdRowMenu>
                        </td>
                        <th scope="row">
                          <button
                            type="button"
                            className="stock-product-trigger"
                            onClick={() => showCard(row.id)}
                          >
                            {row.name}
                          </button>
                        </th>
                        <td>{row.used_in}</td>
                        <td>
                          <StockTableDate value={patch?.last ?? date.last} />
                        </td>
                        <td>
                          {patch?.next || date.next ? (
                            <StockTableDate value={(patch?.next ?? date.next)!} />
                          ) : (
                            "..."
                          )}
                        </td>
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
                  );
                })}
              </StockTableRows>
            </table>
          </div>
          {!rows.length ? <p className="empty-state">{t("No items found.")}</p> : null}
        </>
      ) : null}
      <BatteryOverviewCard
        key={options.resetVersion}
        request={cardRequest}
        open={cardOpen}
        onClose={() => setCardOpen(false)}
      />
      {dialog ? <EmbeddedPageDialog page={dialog} onClose={() => setDialog(undefined)} /> : null}
    </>
  );
}
