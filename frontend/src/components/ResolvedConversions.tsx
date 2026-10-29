import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { unitLabel } from "@/lib/format";
import { getResolvedConversions } from "@/lib/resolved-conversions";
import {
  nativeTableCell,
  tablePlainText,
  tableText,
  tableNumber,
  type NativeTableRow,
} from "@/lib/native-table-cell";
import { matchesTableSearch } from "@/lib/table-search";
import { useTableOptions, type TableColumn } from "@/lib/table-options";
import { useTableOrder } from "@/lib/table-order";
import { useModalDialog } from "@/hooks/useModalDialog";
import {
  StockTableCells,
  StockTableOptions,
  StockTableRows,
  StockTableStatus,
} from "./StockTableOptions";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

const columns: TableColumn[] = [
  { key: "actions", label: "", configurable: false },
  { key: "from", label: "Quantity unit from", groupable: true },
  { key: "to", label: "Quantity unit to", groupable: true },
  { key: "factor", label: "Factor" },
  { key: "description", label: "Conversion", configurable: false },
];

export function ResolvedConversions({
  product,
  heading = true,
}: {
  product?: string;
  heading?: boolean;
}) {
  const { t, pluralIndex, ready } = useI18n();
  const preferences = usePreferences();
  const table = useRef<HTMLDivElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const focusAfterRead = useRef(false);
  const [unit, setUnit] = useState("");

  const data = useQuery({
    queryKey: ["resolved-conversions", product],
    queryFn: ({ signal }) => getResolvedConversions(product, signal),
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (focusAfterRead.current && !data.isFetching) {
      focusAfterRead.current = false;
      (data.isSuccess ? table.current : retry.current)?.focus();
    }
  }, [data.isFetching, data.isSuccess]);

  const options = useTableOptions(
    "qu-conversions-resolved-table",
    columns,
    { key: "from", descending: false },
    data.isSuccess,
  );

  const units = data.data?.units ?? [];
  const selectedName = units.find((row) => String(row.id) === unit)?.name ?? "";
  const selected = selectedName === t("All") ? "" : selectedName;

  const formatted = (data.data?.rows ?? []).map((row) => {
    const from = units.find((u) => u.id === row.from_qu_id);
    const to = units.find((u) => u.id === row.to_qu_id);
    const factor = tableNumber(row.factor ?? "", preferences.amountPrecision);
    const number = `<span class="locale-number locale-number-quantity-amount number-parsing-done">${tableText(factor)}</span>`;

    const toLabel = unitLabel(
      to ? { ...to, name: to.name ?? "" } : undefined,
      Number.parseFloat(row.factor ?? ""),
      pluralIndex,
      false,
    );

    const description = t(
      "This means 1 %1$s is the same as %2$s %3$s",
      from?.name ?? "",
      factor,
      toLabel,
    );

    const cells: NativeTableRow = {
      actions: nativeTableCell(""),
      from: nativeTableCell(tableText(from?.name ?? "")),
      to: nativeTableCell(tableText(to?.name ?? "")),
      factor: nativeTableCell(number),
      description: nativeTableCell(
        t(
          "This means 1 %1$s is the same as %2$s %3$s",
          tableText(from?.name ?? ""),
          number,
          tableText(toLabel),
        ),
      ),
    };

    return {
      ...row,
      from: from?.name ?? "",
      to: to?.name ?? "",
      displayFactor: factor,
      description,
      cells,
    };
  });

  const ordered = useTableOrder(
    formatted.map((row) => ({ key: String(row.id), row, cells: row.cells })),
    options,
    data.isSuccess && !data.isFetching && ready,
  );

  const rows = ordered.filter((row) => matchesTableSearch(row.cells.from!.search, selected));

  const clear = () => {
    options.draw();
    setUnit("");
  };

  const reload = () => {
    focusAfterRead.current = true;
    options.reload();
    void data.refetch();
  };

  return (
    <>
      {heading ? <PageHeader title={t("QU conversions resolved")} /> : null}
      {data.data?.product ? (
        <p>
          {t("Product")} <strong>{data.data.product.name}</strong>
        </p>
      ) : null}
      <div className="toolbar journal-filters">
        <label className="field">
          <span>{t("Quantity unit")}</span>
          <select
            value={unit}
            onChange={(e) => {
              options.draw();
              setUnit(e.target.value);
            }}
          >
            <option value="">{t("All")}</option>
            {units.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" onClick={clear}>
          {t("Clear filter")}
        </button>
      </div>
      <StockTableStatus options={options} />
      {data.error ? (
        <>
          <ErrorBlock message={data.error.message} />
          <button ref={retry} type="button" className="btn" onClick={reload}>
            {t("Retry")}
          </button>
        </>
      ) : null}
      {data.isPending || data.isFetching || !ready ? <LoadingBlock /> : null}
      {data.isSuccess && !data.isFetching && ready && options.ready ? (
        <>
          <p className="toolbar-note" role="status">
            {t("%s rows", String(rows.length))}
          </p>
          <div
            ref={table}
            className="journal-table-scroll"
            role="region"
            tabIndex={0}
            aria-label={t("QU conversions resolved")}
          >
            <table className="stock-table journal-table">
              <caption className="sr-only">{t("QU conversions resolved")}</caption>
              <thead>
                <tr>
                  <StockTableCells options={options} headers>
                    <th scope="col">
                      <StockTableOptions
                        options={options}
                        onReset={() => {
                          clear();
                          reload();
                        }}
                      />
                    </th>
                    {columns.slice(1).map((column) => (
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
                          aria-label={t(column.label)}
                          onClick={(e) => options.sortBy(column.key, e.shiftKey)}
                        >
                          {column.key === "description" ? null : t(column.label)}
                        </button>
                      </th>
                    ))}
                  </StockTableCells>
                </tr>
              </thead>
              <StockTableRows
                options={options}
                groups={rows.map((row) => {
                  const cell = row.cells[options.groupColumn ?? ""] ?? nativeTableCell("");
                  const label = tablePlainText(cell.html);

                  return { key: cell.html, label, name: label };
                })}
              >
                {rows.map((row) => (
                  <tr key={row.id}>
                    <StockTableCells options={options}>
                      <td />
                      <th scope="row">{row.from}</th>
                      <td>{row.to}</td>
                      <td>{row.displayFactor}</td>
                      <td>
                        <em>{row.description}</em>
                      </td>
                    </StockTableCells>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={Math.max(1, options.visibleColumns.length)}>
                      {t(
                        formatted.length === 0
                          ? "No data available in table"
                          : "No matching records found",
                      )}
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

export function ResolvedConversionsDialog({
  product,
  onClose,
}: {
  product?: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialog = useModalDialog();
  const title = useId();

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog stock-journal-dialog"
      aria-labelledby={title}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="section-heading">
        <h2 id={title}>{t("QU conversions resolved")}</h2>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
      <ResolvedConversions
        product={product === undefined ? undefined : String(product)}
        heading={false}
      />
    </dialog>
  );
}
