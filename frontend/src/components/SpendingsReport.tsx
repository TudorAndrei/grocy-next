import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import moment from "moment/min/moment-with-locales.js";
import { useI18n } from "@/lib/i18n";
import { useFeatures } from "@/lib/features";
import { usePreferences } from "@/lib/preferences";
import { getSpendings, type SpendingsSearch, type SpendingsView } from "@/lib/spendings";
import {
  nativeTableCell,
  nativeNumberCell,
  type NativeTableRow,
  tablePlainText,
  tableText,
} from "@/lib/native-table-cell";
import { matchesTableSearch } from "@/lib/table-search";
import { useTableOptions, type TableColumn } from "@/lib/table-options";
import { useTableOrder } from "@/lib/table-order";
import {
  StockTableCells,
  StockTableOptions,
  StockTableRows,
  StockTableStatus,
} from "./StockTableOptions";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

type Props = { search: SpendingsSearch; onChange: (search: SpendingsSearch) => void };

const groupingLabels = {
  product: "Product",
  productgroup: "Product group",
  store: "Store",
} as const;

function hasGroupName(value: string | null) {
  return value !== null && value !== "" && value !== "0";
}

const presetKeys = [
  "today",
  "yesterday",
  "7",
  "14",
  "30",
  "month",
  "last-month",
  "year",
  "last-year",
];

function rangeBounds(value: string): [string, string] {
  const from = moment();
  const to = moment();

  if (value === "yesterday") {
    from.subtract(1, "day");
    to.subtract(1, "day");
  } else if (["7", "14", "30"].includes(value)) from.subtract(Number(value) - 1, "days");
  else if (value === "month") {
    from.startOf("month");
    to.endOf("month");
  } else if (value === "last-month") {
    from.subtract(1, "month").startOf("month");
    to.subtract(1, "month").endOf("month");
  } else if (value === "year") {
    from.startOf("year");
    to.endOf("year");
  } else if (value === "last-year") {
    from.subtract(1, "year").startOf("year");
    to.subtract(1, "year").endOf("year");
  }

  return [from.format("YYYY-MM-DD"), to.format("YYYY-MM-DD")];
}

export function SpendingsReport({ search, onChange }: Props) {
  const { t, n } = useI18n();
  const features = useFeatures();
  const preferences = usePreferences();
  const [text, setText] = useState("");
  const [custom, setCustom] = useState(false);
  const start = moment(search.start_date, "YYYY-MM-DD", true);
  const end = moment(search.end_date, "YYYY-MM-DD", true);

  const appliedStart = start.isValid() ? start.format("YYYY-MM-DD") : rangeBounds("month")[0];
  const appliedEnd = end.isValid() ? end.format("YYYY-MM-DD") : rangeBounds("month")[1];
  const [draftStart, setDraftStart] = useState(appliedStart);
  const [draftEnd, setDraftEnd] = useState(appliedEnd);

  const preset =
    presetKeys.find((key) => {
      const [from, to] = rangeBounds(key);

      return from === appliedStart && to === appliedEnd;
    }) ?? "custom";

  const data = useQuery({
    queryKey: ["stock", "spendings", search],
    queryFn: ({ signal }) => getSpendings(search, signal),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const grouping =
    data.data?.group_by ??
    (search["group-by"] === "store" || search["group-by"] === "productgroup"
      ? search["group-by"]
      : "product");

  const columns: TableColumn[] = [
    { key: "name", label: "Name" },
    { key: "total", label: "Total", groupable: false },
  ];

  if (grouping === "product") columns.push({ key: "group", label: "Product group" });

  const options = useTableOptions(
    "metrics-table",
    columns,
    { key: "name", descending: false },
    data.isSuccess,
  );

  const currency = String(features.query.data?.CURRENCY ?? "EUR");
  const money = (value: number) => preferences.formatCurrency(value, currency);
  const ungrouped = `<span class="font-italic font-weight-light">${tableText(t("Ungrouped"))}</span>`;

  const records = (data.data?.rows ?? []).map((row) => {
    const cells: NativeTableRow = {
      name: nativeTableCell(
        grouping === "productgroup" && !hasGroupName(row.name) ? ungrouped : tableText(row.name),
      ),
      total: nativeNumberCell(
        `<span class="locale-number locale-number-currency number-parsing-done">${tableText(money(row.total))}</span>`,
        row.total,
      ),
      group: nativeTableCell(hasGroupName(row.group_name) ? tableText(row.group_name) : ungrouped),
    };

    return { ...row, cells };
  });

  const ordered = useTableOrder(
    records.map((row) => ({ key: String(row.id), row, cells: row.cells })),
    options,
    data.isSuccess,
  );

  const rows = ordered.filter((row) =>
    matchesTableSearch(
      columns.map((column) => row.cells[column.key]?.search ?? "").join("  "),
      text,
    ),
  );

  function range(value: string) {
    if (value === "custom") {
      setCustom(true);

      return;
    }

    const [start_date, end_date] = rangeBounds(value);

    onChange({
      ...search,
      start_date,
      end_date,
    });
  }

  function apply(event: FormEvent) {
    event.preventDefault();
    onChange({ ...search, start_date: draftStart, end_date: draftEnd });
    setCustom(false);
  }

  function clear() {
    setText("");
    setCustom(false);
    options.reload();

    if (
      search.start_date === undefined &&
      search.end_date === undefined &&
      search["product-group"] === undefined
    )
      void data.refetch();
    onChange({ ...search, start_date: undefined, end_date: undefined, "product-group": undefined });
  }

  return (
    <>
      <div className="toolbar spending-grouping" role="group" aria-label={t("Group by")}>
        <span>{t("Group by")}:</span>
        {Object.entries(groupingLabels).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="btn"
            aria-pressed={grouping === value}
            onClick={() => onChange({ ...search, "group-by": value })}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <div className="toolbar spending-filters">
        <label className="field">
          <span>{t("Date range")}</span>
          <select
            value={custom ? "custom" : preset}
            onChange={(event) => range(event.target.value)}
          >
            <option value="today">{t("Today")}</option>
            <option value="yesterday">{t("Yesterday")}</option>
            {[7, 14, 30].map((days) => (
              <option key={days} value={days}>
                {n(days, "Last %1$s day", "Last %1$s days")}
              </option>
            ))}
            <option value="month">{t("This month")}</option>
            <option value="last-month">{t("Last month")}</option>
            <option value="year">{t("This year")}</option>
            <option value="last-year">{t("Last year")}</option>
            <option value="custom">{t("Custom range")}</option>
          </select>
        </label>
        <button
          type="button"
          className="btn"
          onClick={() => setCustom(!custom)}
          aria-expanded={custom}
        >
          {appliedStart} – {appliedEnd}
        </button>
        {grouping === "product" ? (
          <label className="field">
            <span>{t("Product group")}</span>
            <select
              value={search["product-group"] ?? "all"}
              onChange={(event) => onChange({ ...search, "product-group": event.target.value })}
            >
              <option value="all">{t("All")}</option>
              {data.data?.product_groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
              <option value="ungrouped">{t("Ungrouped")}</option>
            </select>
          </label>
        ) : null}
        <button type="button" className="btn" onClick={clear}>
          {t("Clear filter")}
        </button>
      </div>
      {custom ? (
        <form className="toolbar spending-date-range" onSubmit={apply}>
          <label className="field">
            <span>{t("Start date")}</span>
            <input
              type="date"
              required
              value={draftStart}
              onChange={(event) => setDraftStart(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{t("End date")}</span>
            <input
              type="date"
              required
              value={draftEnd}
              onChange={(event) => setDraftEnd(event.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary">
            {t("Apply")}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraftStart(appliedStart);
              setDraftEnd(appliedEnd);
              setCustom(false);
            }}
          >
            {t("Cancel")}
          </button>
        </form>
      ) : null}
      {data.isPending ? <LoadingBlock label={t("Loading…")} /> : null}
      {data.error ? (
        <>
          <ErrorBlock message={data.error.message} />
          <button type="button" className="btn" onClick={() => void data.refetch()}>
            {t("Retry")}
          </button>
        </>
      ) : null}
      <StockTableStatus options={options} />
      {data.isSuccess && options.ready ? (
        <>
          <SpendingChart data={data.data} currency={currency} />
          <div className="toolbar">
            <label className="field">
              <span>{t("Search")}</span>
              <input
                type="search"
                value={text}
                onChange={(event) => {
                  options.draw();
                  setText(event.target.value);
                }}
                onKeyUp={options.draw}
              />
            </label>
            <StockTableOptions
              options={options}
              onReset={() => {
                setText("");
                options.reload();
                void data.refetch();
              }}
            />
          </div>
          <div
            className="journal-table-scroll"
            role="region"
            tabIndex={0}
            aria-label={t("Spendings")}
          >
            <table className="stock-table journal-table spending-table">
              <caption className="sr-only">{t("Spendings")}</caption>
              <thead>
                <tr>
                  <StockTableCells options={options} headers>
                    {columns.map((column) => (
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
                          {t(column.label)}
                        </button>
                      </th>
                    ))}
                  </StockTableCells>
                </tr>
              </thead>
              <StockTableRows
                options={options}
                groups={rows.map((row) => {
                  const cell = row.cells[options.groupColumn ?? "name"] ?? nativeTableCell("");

                  return {
                    key: cell.html,
                    label: tablePlainText(cell.html),
                    name: tablePlainText(cell.html),
                  };
                })}
              >
                {rows.map((row) => (
                  <tr key={row.id ?? "null"}>
                    <StockTableCells options={options}>
                      <th scope="row">
                        {grouping === "productgroup" && !hasGroupName(row.name) ? (
                          <i>{t("Ungrouped")}</i>
                        ) : (
                          row.name
                        )}
                      </th>
                      <td className="num">{money(row.total)}</td>
                      {grouping === "product" ? (
                        <td>
                          {hasGroupName(row.group_name) ? row.group_name : <i>{t("Ungrouped")}</i>}
                        </td>
                      ) : null}
                    </StockTableCells>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length}>{t("No entries found")}</td>
                  </tr>
                ) : null}
              </StockTableRows>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}

// Retain the pinned report's ring chart; its table supplies exact comparisons.
function SpendingChart({ data, currency }: { data: SpendingsView; currency: string }) {
  const { t } = useI18n();

  const colors = [
    "#a6cee3",
    "#1f78b4",
    "#b2df8a",
    "#33a02c",
    "#fb9a99",
    "#e31a1c",
    "#fdbf6f",
    "#ff7f00",
    "#cab2d6",
    "#6a3d9a",
    "#ffff99",
    "#b15928",
  ];

  const total = data.rows.reduce((sum, row) => sum + row.total, 0);
  const slices = [];
  let offset = 0;

  for (const [index, row] of data.rows.entries()) {
    const amount = total ? row.total / total : 0;
    slices.push({ row, index, amount, start: offset });
    offset += amount;
  }

  return (
    <figure className="spending-chart" aria-label={t("Spendings")}>
      <svg
        viewBox="0 0 280 280"
        role="img"
        aria-label={`${t("Total")}: ${total.toLocaleString(undefined, { style: "currency", currency })}`}
      >
        {slices.map(({ row, index, amount, start }) => (
          <circle
            key={row.id ?? "null"}
            cx="140"
            cy="140"
            r="100"
            fill="none"
            stroke={colors[index % colors.length]}
            strokeWidth="42"
            pathLength="1"
            strokeDasharray={`${amount} ${1 - amount}`}
            strokeDashoffset={-start}
            transform="rotate(-90 140 140)"
          />
        ))}
        <text x="140" y="138" textAnchor="middle" className="spending-chart-total">
          {total.toLocaleString(undefined, { style: "currency", currency })}
        </text>
        <text x="140" y="161" textAnchor="middle">
          {t("Total")}
        </text>
      </svg>
      <figcaption>
        <ul>
          {data.rows.map((row, index) => (
            <li key={row.id ?? "null"}>
              <span
                className="spending-chart-key"
                style={{ backgroundColor: colors[index % colors.length] }}
                aria-hidden="true"
              />
              <span>
                {data.group_by === "productgroup" && !hasGroupName(row.name)
                  ? t("Ungrouped")
                  : row.name}
              </span>
              <span className="num">{((row.total / total) * 100).toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
