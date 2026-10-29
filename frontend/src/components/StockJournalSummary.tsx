import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { unitLabel } from "@/lib/format";
import {
  nativeTableCell,
  quantityCell,
  tablePlainText,
  tableText,
  type NativeTableRow,
} from "@/lib/native-table-cell";
import { matchesTableSearch } from "@/lib/table-search";
import type { SummarySearch } from "@/lib/stock-journal";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { useTableOrder } from "@/lib/table-order";
import { useTableOptions, type TableColumn } from "@/lib/table-options";
import {
  StockTableCells,
  StockTableOptions,
  StockTableRows,
  StockTableStatus,
} from "./StockTableOptions";

const columns = [
  ["product_name", "Product"],
  ["transaction_type", "Transaction type"],
  ["user_display_name", "User"],
  ["amount", "Amount"],
] as const;

const tableColumns: TableColumn[] = [
  { key: "actions", label: "", configurable: false },
  ...columns.map(([key, label]) => ({ key, label, groupable: key !== "amount" })),
];

export function StockJournalSummary({ search }: { search: SummarySearch }) {
  const { t, pluralIndex } = useI18n();
  const preferences = usePreferences();
  const [text, setText] = useState("");
  const [product, setProduct] = useState("");
  const [transaction, setTransaction] = useState("");
  const [user, setUser] = useState("");

  const data = useQuery({
    queryKey: [
      "stock",
      "journal-summary",
      search.product_id,
      search.user_id,
      search.transaction_type,
    ],
    queryFn: ({ signal }) => api.getStockJournalSummary(search, signal),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const options = useTableOptions(
    "stock-journal-summary-table",
    tableColumns,
    { key: "product_name", descending: false },
    data.isSuccess,
  );

  const sort = options.sort;

  const productName = data.data?.products.find((row) => String(row.id) === product)?.name ?? "";
  const userName = data.data?.users.find((row) => String(row.id) === user)?.name ?? "";

  const formatted = (data.data?.rows ?? []).map((row) => {
    const transaction = t(row.transaction_type ?? "");

    const quantity = row.amount.toLocaleString(undefined, {
      maximumFractionDigits: preferences.amountPrecision,
    });

    const unit = unitLabel(
      { name: row.qu_name ?? "", name_plural: row.qu_name_plural },
      row.amount,
      pluralIndex,
      false,
    );

    const cells: NativeTableRow = {
      product_name: nativeTableCell(tableText(row.product_name)),
      transaction_type: nativeTableCell(tableText(transaction)),
      user_display_name: nativeTableCell(tableText(row.user_display_name)),
      amount: quantityCell(quantity, unit),
    };

    return {
      ...row,
      identity: JSON.stringify([row.product_id, row.user_id, row.transaction_type]),
      transaction_type: transaction,
      display_amount: `${quantity} ${unit}`,
      cells,
    };
  });

  const value = (row: (typeof formatted)[number], key: string) =>
    row.cells[key] ?? nativeTableCell("");

  const ordered = useTableOrder(
    formatted.map((row) => ({
      key: row.identity,
      row,
      cells: row.cells,
    })),
    options,
    data.isSuccess,
  );

  const rows = ordered.filter(
    (row) =>
      (!product || (row.product_name ?? "").toLowerCase() === productName.toLowerCase()) &&
      matchesTableSearch(row.cells.transaction_type!.search, transaction ? t(transaction) : "") &&
      matchesTableSearch(row.cells.user_display_name!.search, userName) &&
      matchesTableSearch(
        columns.map(([key]) => value(row, key).search).join("  "),
        text === "all" ? "" : text,
      ),
  );

  const clearFilters = () => {
    setText("");
    setProduct("");
    setTransaction("");
    setUser("");
  };

  return (
    <>
      <div className="toolbar journal-filters">
        <label className="field">
          <span>{t("Search summary")}</span>
          <input type="search" value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        {search.embedded === undefined ? (
          <label className="field">
            <span>{t("Product")}</span>
            <select value={product} onChange={(event) => setProduct(event.target.value)}>
              <option value="">{t("All")}</option>
              {data.data?.products.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
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
        <label className="field">
          <span>{t("User")}</span>
          <select value={user} onChange={(event) => setUser(event.target.value)}>
            <option value="">{t("All")}</option>
            {data.data?.users.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" onClick={clearFilters}>
          {t("Clear filter")}
        </button>
      </div>
      <StockTableStatus options={options} />
      {data.error ? (
        <>
          <ErrorBlock message={data.error.message} />
          <button type="button" className="btn" onClick={() => void data.refetch()}>
            {t("Retry summary")}
          </button>
        </>
      ) : null}
      {data.isPending ? <LoadingBlock label={t("Loading journal summary…")} /> : null}
      {data.isSuccess && options.ready ? (
        <>
          <p className="toolbar-note" role="status">
            {t("%s rows", String(rows.length))}
          </p>
          <div
            className="journal-table-scroll"
            tabIndex={0}
            role="region"
            aria-label={t("Stock journal summary")}
          >
            <table className="stock-table journal-table journal-summary-table">
              <caption className="sr-only">{t("Stock journal summary")}</caption>
              <thead>
                <tr>
                  <StockTableCells options={options} headers>
                    <th scope="col">
                      <StockTableOptions options={options} onReset={clearFilters} />
                    </th>
                    {columns.map(([key, label]) => (
                      <th
                        key={key}
                        className={key === "amount" ? "journal-summary-amount" : undefined}
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
                  const label = tablePlainText(cell.html);

                  return { key: cell.html, label, name: label };
                })}
              >
                {rows.map((row) => (
                  <tr key={row.identity}>
                    <StockTableCells options={options}>
                      <td />
                      <th scope="row">{row.product_name}</th>
                      <td>{row.transaction_type}</td>
                      <td>{row.user_display_name}</td>
                      <td className="journal-summary-amount">{row.display_amount}</td>
                    </StockTableCells>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={Math.max(1, options.visibleColumns.length)}>
                      {t("No matching records found")}
                    </td>
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
