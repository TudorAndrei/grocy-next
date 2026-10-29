import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { unitLabel } from "@/lib/format";
import { userfieldsQuery } from "@/lib/userfields";
import type { JournalSearch, JournalRow } from "@/lib/stock-journal";
import { useModalDialog } from "@/hooks/useModalDialog";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { GrocycodeActions } from "./GrocycodeActions";
import { UserfieldValue } from "./UserfieldValue";
import {
  nativeTableCell,
  quantityCell,
  tableDate,
  tableLine,
  tablePlainText,
  tableText,
  tableTime,
  type NativeTableCell,
  type NativeTableRow,
} from "@/lib/native-table-cell";
import { StockTableDate } from "./StockTableDate";
import { useTableSnapshot } from "@/lib/table-snapshot";
import { localTimestampText } from "@/lib/header-clock";
import { useNotify } from "./Toaster";
import { matchesTableSearch } from "@/lib/table-search";
import { useTableOrder } from "@/lib/table-order";
import { useTableOptions, type TableColumn } from "@/lib/table-options";
import {
  StockTableCells,
  StockTableOptions,
  StockTableRows,
  StockTableStatus,
} from "./StockTableOptions";

type JournalUndo = { timestamp: string; at: number; contextual: boolean };

async function undoBooking(identity: number) {
  await api.action(`/api/stock/bookings/${identity}/undo`);

  return Date.now();
}

const ranges = [
  ["1", "1 month"],
  ["6", "6 months"],
  ["12", "1 year"],
  ["24", "2 years"],
  ["9999", "All"],
];

export function StockJournal({
  search,
  onChange,
}: {
  search: JournalSearch;
  onChange: (search: JournalSearch) => void;
}) {
  const { t, pluralIndex, ready: translationsReady } = useI18n();
  const features = useFeatures();
  const preferences = usePreferences();
  const client = useQueryClient();
  const notify = useNotify();
  const id = useId();
  const [text, setText] = useState("");
  const [transaction, setTransaction] = useState("");
  const [location, setLocation] = useState("");
  const [user, setUser] = useState("");
  const [reloading, setReloading] = useState(false);

  const [undoDisplay, setUndoDisplay] = useState<{
    version: number;
    cellVersion: number;
    rows: Map<number, JournalUndo>;
  }>({ version: -1, cellVersion: -1, rows: new Map() });

  const data = useQuery({
    queryKey: ["stock", "journal-view", search.product, search.months],
    queryFn: ({ signal }) => api.getStockJournal(search, signal),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const definitions = useQuery(userfieldsQuery);

  const fields =
    definitions.data?.filter(
      (field) => field.entity === "stock" && field.show_as_column_in_tables === 1,
    ) ?? [];

  const undo = useMutation({
    mutationFn: undoBooking,
    onSuccess: async (at, identity) => {
      const view = initial?.value;
      const clicked = view?.rows.find((row) => row.id === identity);

      if (clicked && view) {
        const timestamp = localTimestampText(new Date(at), t("moment_locale"));
        setUndoDisplay((current) => {
          const rows =
            current.version === options.resetVersion && current.cellVersion === options.cellVersion
              ? new Map(current.rows)
              : new Map<number, JournalUndo>();

          for (const row of view.rows) {
            if (
              row.id === identity ||
              (clicked.correlation_id && row.correlation_id === clicked.correlation_id)
            ) {
              rows.set(row.id, { timestamp, at, contextual: row.id === identity });
            }
          }

          return { version: options.resetVersion, cellVersion: options.cellVersion, rows };
        });
      }

      notify({ message: t("Booking successfully undone") });
      await client.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "stock" && query.queryKey[1] !== "journal-view",
      });
    },
  });

  const unit = (row: JournalRow) =>
    unitLabel(
      { name: row.qu_name ?? "", name_plural: row.qu_name_plural },
      row.amount,
      pluralIndex,
      false,
    );

  const type = (row: JournalRow) =>
    t(row.transaction_type ?? "") + (row.spoiled ? ` ${t("Spoiled")}` : "");

  const amount = (row: JournalRow) =>
    row.amount.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: preferences.amountPrecision,
    });

  const tableColumns: TableColumn[] = [
    { key: "actions", label: "", configurable: false },
    { key: "product_name", label: "Product", groupable: true },
    { key: "amount", label: "Amount" },
    { key: "row_created_timestamp", label: "Transaction time" },
    { key: "transaction_type", label: "Transaction type", groupable: true },
    {
      key: "location_name",
      label: "Location",
      groupable: true,
      rendered: features.enabled("STOCK_LOCATION_TRACKING"),
    },
    { key: "user_display_name", label: "Done by", groupable: true },
    { key: "note", label: "Note" },
    ...fields.map((field) => ({
      key: `custom:${field.name}`,
      label: field.caption,
      groupable: true,
    })),
  ];

  const options = useTableOptions(
    "stock-journal-table",
    tableColumns,
    { key: "row_created_timestamp", descending: true },
    data.isSuccess && definitions.isSuccess,
  );

  const sort = options.sort;

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

  const reload = async () => {
    setReloading(true);

    try {
      const result = await data.refetch();

      if (result.isSuccess) options.reload();
    } finally {
      setReloading(false);
    }
  };

  const changed = (row: JournalRow) =>
    undoDisplay.version === options.resetVersion && undoDisplay.cellVersion === options.cellVersion
      ? undoDisplay.rows.get(row.id)
      : undefined;

  const isUndone = (row: JournalRow) => !!row.undone || !!changed(row);

  const undoDate = (row: JournalRow) => {
    const update = changed(row);

    if (!update) return dates.get(row)!.undone;

    const value = tableDate(update.timestamp, new Date(update.at), t("moment_locale"), t, {
      plain: true,
    });

    return update.contextual ? value : { ...value, relative: "" };
  };

  const dates = new Map(
    (initial?.value.rows ?? []).map((row) => [
      row,
      {
        transaction: tableDate(row.row_created_timestamp, now, t("moment_locale"), t, {
          plain: true,
        }),
        undone: tableDate(row.undone_timestamp, now, t("moment_locale"), t, { plain: true }),
      },
    ]),
  );

  const cells = new Map(
    (initial?.value.rows ?? []).map((row) => {
      const context = dates.get(row)!;

      const product =
        `<span class="name-anchor ${row.undone ? " text-strike-through " : ""}">${tableText(row.product_name)}</span>` +
        (row.undone
          ? `${tableLine}${"\t".repeat(6)}<br>${tableLine}${tableText(t("Undone on"))} ${tableText(row.undone_timestamp)}${tableLine}${tableTime(row.undone_timestamp, context.undone.relative)}`
          : "");

      const transaction =
        tableText(t(row.transaction_type ?? "")) +
        (row.spoiled
          ? `${tableLine}${"\t".repeat(6)}<span class="font-italic text-muted">${tableText(t("Spoiled"))}</span>`
          : "");

      const values: NativeTableRow = {
        product_name: nativeTableCell(product),
        amount: quantityCell(amount(row), unit(row)),
        row_created_timestamp: nativeTableCell(context.transaction.html),
        transaction_type: nativeTableCell(transaction),
        location_name: nativeTableCell(tableText(row.location_name)),
        user_display_name: nativeTableCell(tableText(row.user_display_name)),
        note: nativeTableCell(tableText(row.note)),
        ...Object.fromEntries(
          fields.map((field) => [
            `custom:${field.name}`,
            nativeTableCell(tableText(row.custom_values[field.name] ?? null)),
          ]),
        ),
      };

      return [row, values] as const;
    }),
  );

  const value = (row: JournalRow, key: string): NativeTableCell =>
    cells.get(row)?.[key] ?? nativeTableCell("");

  const ordered = useTableOrder(
    (initial?.value.rows ?? []).map((row) => ({
      key: String(row.id),
      row,
      cells: cells.get(row)!,
    })),
    options,
    !!initial,
  );

  const rows = (() => {
    const locationName =
      initial?.value.locations.find((item) => String(item.id) === location)?.name ?? "";

    const userName = initial?.value.users.find((item) => String(item.id) === user)?.name ?? "";

    return ordered.filter((row) => {
      const content = Object.values(cells.get(row) ?? {})
        .map((cell) => cell.search)
        .join("  ");

      return (
        matchesTableSearch(
          value(row, "transaction_type").search,
          transaction ? t(transaction) : "",
        ) &&
        matchesTableSearch(value(row, "location_name").search, locationName) &&
        matchesTableSearch(value(row, "user_display_name").search, userName) &&
        matchesTableSearch(content, text === "all" ? "" : text)
      );
    });
  })();

  const error = data.error || definitions.error || undo.error;

  const columns = tableColumns.flatMap((c) =>
    c.key !== "actions" && c.rendered !== false ? [[c.key, c.label]] : [],
  );

  return (
    <>
      {search.embedded === undefined ? (
        <div className="actions">
          <Link to="/stockjournal/summary" className="btn">
            {t("Journal summary")}
          </Link>
        </div>
      ) : null}
      <div className="toolbar journal-filters">
        <label className="field">
          <span>{t("Search journal")}</span>
          <input
            id={`${id}-search`}
            type="search"
            value={text}
            onChange={(event) => {
              options.draw();
              setText(event.target.value);
            }}
            onKeyUp={options.draw}
          />
        </label>
        {search.embedded === undefined ? (
          <label className="field">
            <span>{t("Product")}</span>
            <select
              value={search.product ?? ""}
              onChange={(event) => {
                options.draw();
                onChange({ ...search, product: event.target.value || undefined });
              }}
            >
              <option value="">{t("All")}</option>
              {search.product !== undefined &&
              !initial?.value.products.some((item) => String(item.id) === search.product) ? (
                <option value={search.product} hidden />
              ) : null}
              {initial?.value.products.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field">
          <span>{t("Transaction type")}</span>
          <select
            value={transaction}
            onChange={(event) => {
              options.draw();
              setTransaction(event.target.value);
            }}
          >
            <option value="">{t("All")}</option>
            {initial?.value.transaction_types.map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </select>
        </label>
        {features.enabled("STOCK_LOCATION_TRACKING") ? (
          <label className="field">
            <span>{t("Location")}</span>
            <select
              value={location}
              onChange={(event) => {
                options.draw();
                setLocation(event.target.value);
              }}
            >
              <option value="">{t("All")}</option>
              {initial?.value.locations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field">
          <span>{t("Done by")}</span>
          <select
            value={user}
            onChange={(event) => {
              options.draw();
              setUser(event.target.value);
            }}
          >
            <option value="">{t("All")}</option>
            {initial?.value.users.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("Date range")}</span>
          <select
            value={search.months ?? "6"}
            onChange={(event) => onChange({ ...search, months: event.target.value })}
          >
            {search.months !== undefined && !ranges.some(([value]) => value === search.months) ? (
              <option value={search.months} hidden />
            ) : null}
            {ranges.map(([value, name]) => (
              <option key={value} value={value}>
                {t(name)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setText("");
            setTransaction("");
            setLocation("");
            setUser("");

            const next = {
              ...search,
              months: undefined,
              product: search.embedded === undefined ? undefined : search.product,
            };

            onChange(next);

            if (next.product === search.product && next.months === search.months) void reload();
          }}
        >
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
            void Promise.all([reload(), definitions.refetch()]);
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
            aria-label={t("Stock journal")}
          >
            <table className="stock-table journal-table">
              <caption className="sr-only">{t("Stock journal")}</caption>
              <thead>
                <tr>
                  <StockTableCells options={options} headers>
                    <th scope="col">
                      <StockTableOptions
                        options={options}
                        onReset={() => {
                          setText("");
                          setTransaction("");
                          setLocation("");
                          setUser("");
                          void reload();
                        }}
                      />
                    </th>
                    {columns.map(([key, label]) => (
                      <th
                        key={key}
                        scope="col"
                        aria-sort={
                          sort.key === key ? (sort.descending ? "descending" : "ascending") : "none"
                        }
                      >
                        <button
                          type="button"
                          className="journal-sort"
                          onClick={(event) => options.sortBy(key, event.shiftKey)}
                        >
                          {t(label)}
                        </button>
                      </th>
                    ))}
                  </StockTableCells>
                </tr>
              </thead>
              <StockTableRows
                options={options}
                groups={rows.map((row) => {
                  const cell = value(row, options.groupColumn ?? "");
                  const name = tablePlainText(cell.html);

                  const label =
                    options.groupColumn === "product_name" && row.undone ? (
                      <span>
                        <s>{row.product_name}</s>
                        <br />
                        {t("Undone on")} <StockTableDate value={dates.get(row)!.undone} />
                      </span>
                    ) : (
                      name
                    );

                  return { key: cell.html, label, name };
                })}
              >
                {rows.map((row) => (
                  <tr key={row.id} data-undone={isUndone(row) ? true : undefined}>
                    <StockTableCells options={options}>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={undo.isPending || isUndone(row)}
                            aria-label={t("Undo transaction %s", String(row.id))}
                            onClick={() => undo.mutate(row.id)}
                          >
                            {t("Undo")}
                          </button>
                          <GrocycodeActions
                            kind="product"
                            id={row.product_id}
                            name={row.product_name ?? ""}
                            compact
                          />
                        </div>
                      </td>
                      <th scope="row">
                        <Link
                          to="/products/$productId"
                          params={{ productId: String(row.product_id) }}
                        >
                          {isUndone(row) ? <s>{row.product_name}</s> : row.product_name}
                        </Link>
                        {isUndone(row) ? (
                          <small>
                            {t("Undone on")} <StockTableDate value={undoDate(row)} />
                          </small>
                        ) : null}
                      </th>
                      <td>
                        {amount(row)} {unit(row)}
                      </td>
                      <td>
                        <StockTableDate value={dates.get(row)!.transaction} />
                      </td>
                      <td>{type(row)}</td>
                      {features.enabled("STOCK_LOCATION_TRACKING") ? (
                        <td>{row.location_name}</td>
                      ) : null}
                      <td>{row.user_display_name}</td>
                      <td>{row.note}</td>
                      {fields.map((field) => (
                        <td key={field.id}>
                          <UserfieldValue
                            field={field}
                            value={row.custom_values[field.name] ?? null}
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
            <p className="empty-state">{t("No stock bookings match this filter.")}</p>
          ) : null}
        </>
      ) : null}
    </>
  );
}

export function ProductJournal({
  productId,
  name,
  disabled,
}: {
  productId: number;
  name: string;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const features = useFeatures();
  const [open, setOpen] = useState(false);

  if (!features.enabled("STOCK")) return null;

  return (
    <>
      <button type="button" className="btn" disabled={disabled} onClick={() => setOpen(true)}>
        {t("Stock journal")}
      </button>
      {open ? (
        <JournalDialog productId={productId} name={name} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function JournalDialog({
  productId,
  name,
  onClose,
}: {
  productId: number;
  name: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const title = useId();
  const [search, setSearch] = useState<JournalSearch>({ product: String(productId), embedded: "" });

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog stock-journal-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="section-heading">
        <h2 id={title}>{t("Stock journal")}</h2>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
      <p>{name}</p>
      <StockJournal
        key={`${search.product}:${search.months}`}
        search={search}
        onChange={setSearch}
      />
    </dialog>
  );
}
