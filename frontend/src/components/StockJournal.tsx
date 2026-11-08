import { useNativeDocumentReload } from "@/lib/native-document";
import { ProductOverview } from "./ProductOverview";
import { useProductCardMemory } from "@/hooks/useProductCardMemory";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { api, request } from "@/lib/api";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { unitLabel } from "@/lib/format";
import { userfieldsQuery } from "@/lib/userfields";
import { userfieldTableCell } from "@/lib/userfield-table-cell";
import type { JournalSearch, JournalRow } from "@/lib/stock-journal";
import { NativeStockPageDialog } from "./NativeStockPageDialog";
import { NativePageDialog } from "./NativePageDialog";
import { NativeStockRowMenu, useNativeStockReturnTo } from "./NativeStockRowMenu";
import { useNativeLabelPrint } from "@/hooks/useNativeLabelPrint";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { usePermissions } from "@/lib/permissions";
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

type JournalUndoOperation = { identity: number; signal: AbortSignal };

async function undoBooking({ identity, signal }: JournalUndoOperation, onSettled: () => void) {
  signal.throwIfAborted();

  try {
    await request(`/api/stock/bookings/${identity}/undo`, {
      method: "POST",
      body: "{}",
      signal,
    });
  } finally {
    onSettled();
  }

  signal.throwIfAborted();

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
  const [overview, setOverview] = useState<number>();
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [page, setPage] = useState<{ url: string; dialogType?: string }>();
  const router = useRouter();
  const returnTo = useNativeStockReturnTo();
  const print = useNativeLabelPrint();
  const can = usePermissions();
  const { t, pluralIndex, ready: translationsReady } = useI18n();
  const reloadDocument = useNativeDocumentReload("/stockjournal");
  const features = useFeatures();
  const preferences = usePreferences();
  const client = useQueryClient();
  const notify = useNotify();
  const id = useId();
  const table = useRef<HTMLDivElement>(null);
  const owner = useRef<AbortController | null>(null);
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
    mutationFn: (operation: JournalUndoOperation) =>
      undoBooking(operation, () => {
        void client.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === "stock" && query.queryKey[1] !== "journal-view",
          refetchType: "none",
        });

        for (const key of [
          "products",
          "recipe-fulfillment",
          "recipe-view",
          "recipe-overview",
          "shopping",
          "mealplan-calendar",
        ])
          void client.invalidateQueries({ queryKey: [key], refetchType: "none" });
      }),
    onSuccess: (at, { identity, signal }) => {
      if (signal.aborted) return;
      const view = initial?.value;
      const clicked = view?.rows.find((row) => row.id === identity);

      if (clicked && view) {
        const timestamp = localTimestampText(new Date(at), t("moment_locale"));
        setUndoDisplay((current) => {
          if (signal.aborted) return current;

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
    },
    onError: (error, { signal }) => {
      if (signal.aborted) return;
      console.error(error);
      notify({ message: error.message, tone: "error" });
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

  useLayoutEffect(() => {
    const controller = new AbortController();
    owner.current = controller;

    return () => {
      controller.abort();

      if (owner.current === controller) owner.current = null;
    };
  }, [options.resetVersion]);

  const overviewMemory = useProductCardMemory({ resetVersion: options.resetVersion });

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
    if (reloadDocument()) return;
    const signal = owner.current?.signal;

    if (!signal || signal.aborted) return;
    setReloading(true);

    try {
      const result = await data.refetch();

      if (!signal.aborted && result.isSuccess) options.reload();
    } finally {
      if (!signal.aborted) setReloading(false);
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
            ["file", "image", "link", "link-with-title"].includes(field.type)
              ? userfieldTableCell(
                  field,
                  row.custom_values[field.name] ?? null,
                  preferences.priceDisplayPrecision,
                  String(features.query.data?.CURRENCY ?? "USD"),
                  features.query.data,
                  Object.hasOwn(row.custom_values, field.name),
                )
              : nativeTableCell(tableText(row.custom_values[field.name] ?? null)),
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

  const error = data.error || definitions.error;

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
            ref={table}
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
                          setOverview(undefined);
                          setOverviewExpanded(false);
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
                  const groupedField = fields.find(
                    (field) => options.groupColumn === `custom:${field.name}`,
                  );

                  const groupedValues = row.custom_values;
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

                  return {
                    key: cell.html,
                    label,
                    name,
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
                  <tr key={row.id} data-undone={isUndone(row) ? true : undefined}>
                    <StockTableCells options={options}>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={isUndone(row)}
                            aria-label={t("Undo transaction %s", String(row.id))}
                            onClick={() => {
                              const signal = owner.current?.signal;

                              if (signal && !signal.aborted)
                                undo.mutate({ identity: row.id, signal });
                            }}
                          >
                            {t("Undo")}
                          </button>
                          {features.enabled("STOCK_LOCATION_TRACKING") ? (
                            <a
                              href={
                                router.buildLocation({ to: "/transfer", search: {} }).publicHref +
                                `?embedded&product=${row.product_id}`
                              }
                              className={`btn btn-ghost btn-sm show-as-dialog-link permission-STOCK_TRANSFER${can("STOCK_TRANSFER") ? "" : " disabled not-allowed"}`}
                              aria-disabled={!can("STOCK_TRANSFER") || undefined}
                              aria-label={t("Transfer transaction product %s", String(row.id))}
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
                                setPage({ url: event.currentTarget.href });
                              }}
                            >
                              {t("Transfer")}
                            </a>
                          ) : null}
                          <NativeStockRowMenu
                            variant="journal"
                            rowId={row.id}
                            productId={row.product_id}
                            productName={row.product_name}
                            can={can}
                            returnTo={returnTo}
                            onDialog={(url, dialogType) => setPage({ url, dialogType })}
                            onOverview={() => setOverview(row.product_id)}
                            onPrint={() =>
                              print(`/api/stock/products/${row.product_id}/printlabel`)
                            }
                          />
                        </div>
                      </td>
                      <th scope="row">
                        <button
                          type="button"
                          className="stock-product-trigger"
                          aria-label={`${t("Product overview")}: ${row.product_name ?? ""}`}
                          onClick={() => setOverview(row.product_id)}
                        >
                          {isUndone(row) ? <s>{row.product_name}</s> : row.product_name}
                        </button>
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
            <p className="empty-state">{t("No stock bookings match this filter.")}</p>
          ) : null}
        </>
      ) : null}
      {page ? <NativePageDialog {...page} onClose={() => setPage(undefined)} /> : null}
      {overview !== undefined ? (
        <ProductOverview
          productId={overview}
          memory={overviewMemory}
          embedded={search.embedded !== undefined}
          expanded={overviewExpanded}
          onExpandedChange={setOverviewExpanded}
          onReturn={async () => {
            const signal = owner.current?.signal;

            if (!signal || signal.aborted) return;
            setText("");
            setTransaction("");
            setLocation("");
            setUser("");
            await reload();
            requestAnimationFrame(() => {
              if (!signal.aborted) table.current?.focus();
            });
          }}
          onClose={() => setOverview(undefined)}
        />
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
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <a
        className={`btn show-as-dialog-link${disabled ? " disabled" : ""}`}
        aria-disabled={disabled || undefined}
        data-dialog-type="table"
        href={
          router.buildLocation({ to: "/stockjournal", search: {} }).publicHref +
          `?embedded&product=${productId}`
        }
        onClick={(event) => {
          if (
            event.button !== 0 ||
            event.ctrlKey ||
            event.shiftKey ||
            event.metaKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        {t("Stock journal")}
      </a>
      {open ? (
        <JournalDialog productId={productId} name={name} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

export function JournalDialog({
  productId,
  onClose,
}: {
  productId: number;
  name: string;
  onClose: () => void;
}) {
  return <NativeStockPageDialog kind="stockjournal" productId={productId} onClose={onClose} />;
}
