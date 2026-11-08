import { nativeObjectUserfieldPresent } from "@/lib/native-userfield-values";
import { useNativeDocumentReload } from "@/lib/native-document";
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getQuantityUnits,
  invalidateQuantityUnits,
  type QuantityUnit,
} from "@/lib/quantity-unit-form";
import { request } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useFeatures } from "@/lib/features";
import { usePreferences } from "@/lib/preferences";
import { userfieldsQuery } from "@/lib/userfields";
import { userfieldTableCell } from "@/lib/userfield-table-cell";
import { useTableOptions, type TableColumn } from "@/lib/table-options";
import { useTableSnapshot } from "@/lib/table-snapshot";
import { useTableOrder } from "@/lib/table-order";
import { matchesTableSearch } from "@/lib/table-search";
import {
  nativeTableCell,
  tableText,
  tablePlainText,
  type NativeTableRow,
} from "@/lib/native-table-cell";
import { PageHeader } from "./PageHeader";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { UserfieldValue } from "./UserfieldValue";
import {
  StockTableCells,
  StockTableOptions,
  StockTableRows,
  StockTableStatus,
} from "./StockTableOptions";
import { QuantityUnitDeleteDialog } from "./QuantityUnitEditor";

export function QuantityUnitsPage({
  includeDisabled,
  initiallyChecked = includeDisabled,
  onShowDisabled,
}: {
  includeDisabled: boolean;
  initiallyChecked?: boolean;
  onShowDisabled: (value: boolean) => void;
}) {
  const { t, ready: translated } = useI18n();
  const reloadDocument = useNativeDocumentReload("/quantityunits");
  const features = useFeatures();
  const preferences = usePreferences();
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [showDisabled, setShowDisabled] = useState(initiallyChecked);
  const [deleting, setDeleting] = useState<QuantityUnit>();
  const [reloading, setReloading] = useState(false);
  const alive = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  const records = useQuery({
    queryKey: ["quantity-units"],
    queryFn: ({ signal }) => getQuantityUnits(signal),
    refetchOnWindowFocus: false,
  });

  const definitions = useQuery(userfieldsQuery);

  const fields =
    definitions.data?.filter(
      (field) => field.entity === "quantity_units" && field.show_as_column_in_tables === 1,
    ) ?? [];

  const columns: TableColumn[] = [
    { key: "actions", label: "", configurable: false },
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
    ...fields.map((field) => ({
      key: `custom:${field.name}`,
      label: field.caption,
      labelIsLiteral: true,
      groupable: true,
    })),
  ];

  const options = useTableOptions(
    "quantityunits-table",
    columns,
    { key: "name", descending: false },
    records.isSuccess && definitions.isSuccess,
  );

  const selected = records.data?.filter((row) => includeDisabled || row.active === 1);

  const snapshot = useTableSnapshot(
    selected,
    records.isSuccess &&
      !records.isFetching &&
      definitions.isSuccess &&
      translated &&
      options.ready &&
      !reloading,
    options.resetVersion,
    records.dataUpdatedAt,
  );

  const cells = new Map<QuantityUnit, NativeTableRow>(
    (snapshot?.value ?? []).map((row) => [
      row,
      {
        name: nativeTableCell(tableText(row.name)),
        description: nativeTableCell(tableText(row.description)),
        ...Object.fromEntries(
          fields.map((field) => [
            `custom:${field.name}`,
            userfieldTableCell(
              field,
              row.userfields?.[field.name] ?? null,
              preferences.priceDisplayPrecision,
              String(features.query.data?.CURRENCY ?? "USD"),
              features.query.data,
              nativeObjectUserfieldPresent(row.userfields, field.name),
            ),
          ]),
        ),
      } satisfies NativeTableRow,
    ]),
  );

  const ordered = useTableOrder(
    (snapshot?.value ?? []).map((row) => ({ key: String(row.id), row, cells: cells.get(row)! })),
    options,
    !!snapshot,
  );

  const rows = ordered.filter((row) =>
    matchesTableSearch(
      Object.values(cells.get(row) ?? {})
        .map((cell) => cell.search)
        .join("  "),
      text === "all" ? "" : text,
    ),
  );

  const reload = async () => {
    if (reloadDocument()) return;
    generation.current++;
    setReloading(true);
    remove.reset();
    setDeleting(undefined);

    try {
      const result = await records.refetch();

      if (alive.current && result.isSuccess) {
        setText("");
        options.reload();
      }
    } finally {
      if (alive.current) setReloading(false);
    }
  };

  const remove = useMutation({
    mutationFn: ({ id }: { id: number; generation: number }) =>
      request(`/api/objects/quantity_units/${id}`, { method: "DELETE" }),
    onSuccess: async (_result, operation) => {
      await invalidateQuantityUnits(client);

      if (!alive.current || operation.generation !== generation.current) return;
      await reload();

      if (alive.current) {
        setShowDisabled(false);
        onShowDisabled(false);
      }
    },
  });

  const error = records.error || definitions.error;

  return (
    <>
      <PageHeader
        title={t("Quantity units")}
        actions={
          <>
            <Link
              className="btn btn-primary"
              to="/quantityunit/$unitId"
              params={{ unitId: "new" }}
              search={{}}
            >
              {t("Add")}
            </Link>
            <a className="btn" href="/userfields?entity=quantity_units">
              {t("Configure userfields")}
            </a>
          </>
        }
      />
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
        <label className="check-field">
          <input
            type="checkbox"
            checked={showDisabled}
            onChange={(event) => {
              setShowDisabled(event.target.checked);
              onShowDisabled(event.target.checked);
            }}
          />
          {t("Show disabled")}
        </label>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setText("");
            options.draw();
          }}
        >
          {t("Clear filter")}
        </button>
      </div>
      <StockTableStatus options={options} />
      {error ? (
        <>
          <ErrorBlock message={error.message} />
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
        </>
      ) : null}
      {!snapshot && !error ? <LoadingBlock /> : null}
      {snapshot ? (
        <>
          <div
            className="journal-table-scroll"
            tabIndex={0}
            role="region"
            aria-label={t("Quantity units")}
          >
            <table className="stock-table household-master-table">
              <caption className="sr-only">{t("Quantity units")}</caption>
              <thead>
                <tr>
                  <StockTableCells options={options} headers>
                    <th>
                      <StockTableOptions options={options} onReset={() => void reload()} />
                    </th>
                    {columns.slice(1).map((column) => (
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

                  const groupedValues = row.userfields ?? {};
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
                            present: nativeObjectUserfieldPresent(groupedValues, groupedField.name),
                          }
                        : undefined,
                  };
                })}
              >
                {rows.map((row) => (
                  <tr key={row.id} className={row.active === 0 ? "text-muted" : undefined}>
                    <StockTableCells options={options}>
                      <td>
                        <Link
                          className="btn btn-sm"
                          aria-label={`${t("Edit this item")}: ${row.name}`}
                          to="/quantityunit/$unitId"
                          params={{ unitId: String(row.id) }}
                          search={{}}
                        >
                          {t("Edit")}
                        </Link>
                        <button
                          type="button"
                          className="btn btn-sm"
                          aria-label={`${t("Delete this item")}: ${row.name}`}
                          onClick={() => {
                            remove.reset();
                            setDeleting(row);
                          }}
                        >
                          {t("Delete")}
                        </button>
                      </td>
                      <th scope="row">{row.name}</th>
                      <td>{row.description}</td>
                      {fields.map((field) => (
                        <td key={field.name}>
                          <UserfieldValue
                            nativeTable
                            field={field}
                            value={row.userfields?.[field.name] ?? null}
                            present={nativeObjectUserfieldPresent(row.userfields, field.name)}
                          />
                        </td>
                      ))}
                    </StockTableCells>
                  </tr>
                ))}
              </StockTableRows>
            </table>
          </div>
          {!rows.length ? <p className="empty-state">{t("No items")}</p> : null}
        </>
      ) : null}
      {deleting ? (
        <QuantityUnitDeleteDialog
          message={t('Are you sure you want to delete quantity unit "%s"?', deleting.name ?? "")}
          pending={remove.isPending}
          error={remove.error}
          onClose={() => setDeleting(undefined)}
          onDelete={() => remove.mutate({ id: deleting.id, generation: generation.current })}
        />
      ) : null}
    </>
  );
}
