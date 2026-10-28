import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { unitLabel } from "@/lib/format";
import { matchesTableSearch } from "@/lib/table-search";
import type { SummarySearch } from "@/lib/stock-journal";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

const columns = [
  ["product_name", "Product"],
  ["transaction_type", "Transaction type"],
  ["user_display_name", "User"],
  ["amount", "Amount"],
] as const;

export function StockJournalSummary({ search }: { search: SummarySearch }) {
  const { t, pluralIndex } = useI18n();
  const preferences = usePreferences();
  const [text, setText] = useState("");
  const [product, setProduct] = useState("");
  const [transaction, setTransaction] = useState("");
  const [user, setUser] = useState("");

  const [sort, setSort] = useState<{
    key: (typeof columns)[number][0];
    descending: boolean;
  }>({ key: "product_name", descending: false });

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

  const productName = data.data?.products.find((row) => String(row.id) === product)?.name ?? "";
  const userName = data.data?.users.find((row) => String(row.id) === user)?.name ?? "";

  const rows = (data.data?.rows ?? [])
    .map((row) => ({
      ...row,
      transaction_type: t(row.transaction_type ?? ""),
      display_amount: `${row.amount.toLocaleString(undefined, {
        maximumFractionDigits: preferences.amountPrecision,
      })} ${unitLabel(
        { name: row.qu_name ?? "", name_plural: row.qu_name_plural },
        row.amount,
        pluralIndex,
        false,
      )}`,
    }))
    .filter(
      (row) =>
        (!product || (row.product_name ?? "").toLowerCase() === productName.toLowerCase()) &&
        matchesTableSearch(row.transaction_type, transaction ? t(transaction) : "") &&
        matchesTableSearch(row.user_display_name ?? "", userName) &&
        matchesTableSearch(
          [row.product_name, row.transaction_type, row.user_display_name, row.display_amount].join(
            "  ",
          ),
          text === "all" ? "" : text,
        ),
    )
    .sort((left, right) => {
      let order: number;

      if (sort.key === "amount") order = left.amount - right.amount;
      else {
        const first = (left[sort.key] ?? "").trim().toLowerCase();
        const second = (right[sort.key] ?? "").trim().toLowerCase();

        order = first < second ? -1 : first > second ? 1 : 0;
      }

      return sort.descending ? -order : order;
    });

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
        <button
          type="button"
          className="btn"
          onClick={() => {
            setText("");
            setProduct("");
            setTransaction("");
            setUser("");
          }}
        >
          {t("Clear filter")}
        </button>
      </div>
      {data.error ? (
        <>
          <ErrorBlock message={data.error.message} />
          <button type="button" className="btn" onClick={() => void data.refetch()}>
            {t("Retry summary")}
          </button>
        </>
      ) : null}
      {data.isPending ? <LoadingBlock label={t("Loading journal summary…")} /> : null}
      {data.isSuccess ? (
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
                        onClick={() =>
                          setSort({ key, descending: sort.key === key ? !sort.descending : false })
                        }
                      >
                        {t(label)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.product_id}:${row.user_id}:${row.transaction_type}`}>
                    <th scope="row">{row.product_name}</th>
                    <td>{row.transaction_type}</td>
                    <td>{row.user_display_name}</td>
                    <td className="journal-summary-amount">{row.display_amount}</td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4}>{t("No matching records found")}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
