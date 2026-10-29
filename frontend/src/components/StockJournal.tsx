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
import { matchesTableSearch } from "@/lib/table-search";
import { useTableOptions, type TableColumn } from "@/lib/table-options";
import {
  StockTableCells,
  StockTableOptions,
  StockTableRows,
  StockTableStatus,
} from "./StockTableOptions";

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
  const { t, pluralIndex } = useI18n();
  const features = useFeatures();
  const preferences = usePreferences();
  const client = useQueryClient();
  const id = useId();
  const [text, setText] = useState("");
  const [transaction, setTransaction] = useState("");
  const [location, setLocation] = useState("");
  const [user, setUser] = useState("");

  const data = useQuery({
    queryKey: ["stock", "journal-view", search.product, search.months],
    queryFn: ({ signal }) => api.getStockJournal(search, signal),
    retry: false,
  });

  const definitions = useQuery(userfieldsQuery);

  const fields =
    definitions.data?.filter(
      (field) => field.entity === "stock" && field.show_as_column_in_tables === 1,
    ) ?? [];

  const undo = useMutation({
    mutationFn: (identity: number) => api.action(`/api/stock/bookings/${identity}/undo`),
    onSuccess: () => client.invalidateQueries({ queryKey: ["stock"] }),
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

  const value = (row: JournalRow, key: string): string => {
    switch (key) {
      case "amount":
        return `${amount(row)} ${unit(row)}`;
      case "product_name":
        return row.product_name ?? "";
      case "row_created_timestamp":
        return row.row_created_timestamp ?? "";
      case "transaction_type":
        return type(row);
      case "location_name":
        return row.location_name ?? "";
      case "user_display_name":
        return row.user_display_name ?? "";
      case "note":
        return row.note ?? "";
      default:
        return row.custom_values[key.slice(7)] ?? "";
    }
  };

  const rows = (() => {
    const locationName =
      data.data?.locations.find((item) => String(item.id) === location)?.name ?? "";

    const userName = data.data?.users.find((item) => String(item.id) === user)?.name ?? "";

    const filtered = (data.data?.rows ?? []).filter((row) => {
      const content = [
        row.product_name,
        `${amount(row)} ${unit(row)}`,
        row.row_created_timestamp,
        type(row),
        row.location_name,
        row.user_display_name,
        row.note,
        row.undone ? `${t("Undone on")} ${row.undone_timestamp}` : "",
        ...fields.map((field) => row.custom_values[field.name]),
      ].join("  ");

      return (
        matchesTableSearch(type(row), transaction ? t(transaction) : "") &&
        matchesTableSearch(row.location_name ?? "", locationName) &&
        matchesTableSearch(row.user_display_name ?? "", userName) &&
        matchesTableSearch(content, text === "all" ? "" : text)
      );
    });

    return filtered.sort((a, b) => {
      for (const sort of options.sorters) {
        const order = value(a, sort.key).localeCompare(value(b, sort.key));

        if (order) return sort.descending ? -order : order;
      }

      return 0;
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
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        {search.embedded === undefined ? (
          <label className="field">
            <span>{t("Product")}</span>
            <select
              value={search.product ?? ""}
              onChange={(event) =>
                onChange({ ...search, product: event.target.value || undefined })
              }
            >
              <option value="">{t("All")}</option>
              {search.product !== undefined &&
              !data.data?.products.some((item) => String(item.id) === search.product) ? (
                <option value={search.product} hidden />
              ) : null}
              {data.data?.products.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field">
          <span>{t("Transaction type")}</span>
          <select value={transaction} onChange={(event) => setTransaction(event.target.value)}>
            <option value="">{t("All")}</option>
            {data.data?.transaction_types.map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </select>
        </label>
        {features.enabled("STOCK_LOCATION_TRACKING") ? (
          <label className="field">
            <span>{t("Location")}</span>
            <select value={location} onChange={(event) => setLocation(event.target.value)}>
              <option value="">{t("All")}</option>
              {data.data?.locations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field">
          <span>{t("Done by")}</span>
          <select value={user} onChange={(event) => setUser(event.target.value)}>
            <option value="">{t("All")}</option>
            {data.data?.users.map((item) => (
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
            onChange({
              ...search,
              months: undefined,
              product: search.embedded === undefined ? undefined : search.product,
            });
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
            void Promise.all([data.refetch(), definitions.refetch()]);
          }}
        >
          {t("Retry journal")}
        </button>
      ) : null}
      {data.isPending || definitions.isPending ? (
        <LoadingBlock label={t("Loading journal…")} />
      ) : null}
      {data.isSuccess && definitions.isSuccess && options.ready ? (
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
                groups={rows.map((row) => value(row, options.groupColumn ?? ""))}
              >
                {rows.map((row) => (
                  <tr key={row.id} data-undone={row.undone ? true : undefined}>
                    <StockTableCells options={options}>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={undo.isPending || !!row.undone}
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
                          {row.undone ? <s>{row.product_name}</s> : row.product_name}
                        </Link>
                        {row.undone ? (
                          <small>
                            {t("Undone on")} {row.undone_timestamp}
                          </small>
                        ) : null}
                      </th>
                      <td>
                        {amount(row)} {unit(row)}
                      </td>
                      <td>{row.row_created_timestamp}</td>
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
