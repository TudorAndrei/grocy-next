import { useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, request } from "@/lib/api";
import { useInvalidateStock } from "@/lib/catalog";
import { useFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import { usePreferences } from "@/lib/preferences";
import { unitLabel, isoDay } from "@/lib/format";
import { userfieldsQuery } from "@/lib/userfields";
import type { EntriesSearch, EntryRow } from "@/lib/stock-entries";
import type { Booking } from "@/lib/types";
import { useModalDialog } from "@/hooks/useModalDialog";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";
import { GrocycodeActions } from "./GrocycodeActions";
import { UserfieldValue } from "./UserfieldValue";
import { useNotify } from "./Toaster";
import { StockEntryDialog } from "./StockEntryEditor";
import {
  compareNativeCells,
  nativeNumberCell,
  nativeTableCell,
  tableDate,
  tableLine,
  tablePlainText,
  tableText,
  type NativeTableCell,
  type NativeTableRow,
} from "@/lib/native-table-cell";
import { StockTableDate } from "./StockTableDate";
import { matchesTableSearch } from "@/lib/table-search";
import { useTableOptions, type TableColumn } from "@/lib/table-options";
import {
  StockTableCells,
  StockTableOptions,
  StockTableRows,
  StockTableStatus,
} from "./StockTableOptions";

export function StockEntries({
  search,
  onChange,
}: {
  search: EntriesSearch;
  onChange: (search: EntriesSearch) => void;
}) {
  const { t, pluralIndex } = useI18n();
  const features = useFeatures();
  const preferences = usePreferences();
  const invalidate = useInvalidateStock();
  const notify = useNotify();
  const table = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<number>();
  const [location, setLocation] = useState("");
  const [refreshedProducts, setRefreshedProducts] = useState<number[]>([]);

  const data = useQuery({
    queryKey: ["stock", "entries-view"],
    queryFn: ({ signal }) => api.getStockEntries(signal),
    retry: false,
  });

  const definitions = useQuery(userfieldsQuery);

  const productFields =
    definitions.data?.filter((f) => f.entity === "products" && f.show_as_column_in_tables === 1) ??
    [];

  const stockFields =
    definitions.data?.filter((f) => f.entity === "stock" && f.show_as_column_in_tables === 1) ?? [];

  const unit = (row: EntryRow) =>
    unitLabel(
      { name: row.qu_name ?? "", name_plural: row.qu_name_plural },
      row.amount,
      pluralIndex,
      false,
    );

  const amount = (row: EntryRow) =>
    row.amount.toLocaleString(undefined, { maximumFractionDigits: preferences.amountPrecision });

  const currency = String(features.query.data?.CURRENCY ?? "USD");

  const price = (row: EntryRow) =>
    t(
      "%1$s per %2$s",
      preferences.formatCurrency(
        (row.price ?? 0) *
          (refreshedProducts.includes(row.product_id)
            ? row.qu_factor_purchase_to_stock
            : row.qu_factor_price_to_stock),
        currency,
      ),
      (refreshedProducts.includes(row.product_id) ? row.purchase_qu_name : row.price_qu_name) ?? "",
    );

  const [lastBooking, setLastBooking] = useState<number>();

  const undoBooking = async (id: number) => {
    await api.action(`/api/stock/bookings/${id}/undo`);
    setLastBooking(undefined);
    await invalidate();
    table.current?.focus();
  };

  const action = useMutation({
    mutationFn: ({ row, kind }: { row: EntryRow; kind: "consume" | "spoiled" | "open" }) =>
      request<Booking[]>(
        `/api/stock/products/${row.product_id}/${kind === "spoiled" ? "consume" : kind}`,
        {
          method: "POST",
          body: JSON.stringify(
            kind === "open"
              ? { amount: row.amount, stock_entry_id: row.stock_id }
              : {
                  amount: row.amount,
                  spoiled: kind === "spoiled",
                  location_id: String(row.location_id),
                  stock_entry_id: row.stock_id,
                  exact_amount: true,
                },
          ),
        },
      ),
    onSuccess: async (bookings, { row, kind }) => {
      setRefreshedProducts((current) => [...new Set([...current, row.product_id])]);
      await invalidate();
      const bookingId = bookings[0]?.id;
      notify({
        message:
          t(
            kind === "open" ? "Marked %1$s of %2$s as opened" : "Removed %1$s of %2$s from stock",
            `${amount(row)} ${unit(row)}`,
            row.product_name ?? "",
          ) + (kind === "spoiled" ? ` (${t("Spoiled")})` : ""),
        undo: bookingId === undefined ? undefined : () => undoBooking(bookingId),
      });
      setLastBooking(bookingId);
    },
  });

  const undo = useMutation({
    mutationFn: undoBooking,
  });

  const pending = action.isPending || undo.isPending;

  const product = data.data?.products.some((p) => String(p.id) === search.product)
    ? search.product
    : undefined;

  const locationName = data.data?.locations.find((l) => String(l.id) === location)?.name ?? "";

  const tableColumns: TableColumn[] = [
    { key: "actions", label: "", configurable: false },
    { key: "product_id", label: "", rendered: false, configurable: false },
    { key: "product_name", label: "Product", groupable: true },
    { key: "amount", label: "Amount" },
    {
      key: "best_before_date",
      label: "Due date",
      groupable: true,
      rendered: features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING"),
    },
    {
      key: "location_name",
      label: "Location",
      groupable: true,
      rendered: features.enabled("STOCK_LOCATION_TRACKING"),
    },
    {
      key: "shopping_location_name",
      label: "Store",
      groupable: true,
      rendered: features.enabled("STOCK_PRICE_TRACKING"),
    },
    { key: "price", label: "Price", rendered: features.enabled("STOCK_PRICE_TRACKING") },
    { key: "purchased_date", label: "Purchased date", groupable: true, groupIndex: 9 },
    { key: "purchased_date_group", label: "", rendered: false, configurable: false },
    { key: "row_created_timestamp", label: "Timestamp", defaultVisible: false },
    { key: "note", label: "Note" },
    ...productFields.map((f) => ({ key: `product:${f.name}`, label: f.caption, groupable: true })),
    ...stockFields.map((f) => ({ key: `stock:${f.name}`, label: f.caption, groupable: true })),
  ];

  const options = useTableOptions(
    "stockentries-table",
    tableColumns,
    { key: "product_name", descending: false },
    data.isSuccess && definitions.isSuccess,
  );

  const sort = options.sort;

  const [openedAt] = useState(() => Date.now());
  const now = new Date(Math.max(openedAt, data.dataUpdatedAt));

  const dates = new Map(
    (data.data?.rows ?? []).map((row) => [
      row,
      {
        due: tableDate(row.best_before_date, now, t("moment_locale"), t, {
          dateOnly: true,
          id: `stock-${row.id}-due-date`,
        }),
        purchased: tableDate(row.purchased_date, now, t("moment_locale"), t, {
          dateOnly: true,
          id: `stock-${row.id}-purchased-date`,
        }),
        timestamp: tableDate(row.row_created_timestamp, now, t("moment_locale"), t),
      },
    ]),
  );

  const cells = new Map(
    (data.data?.rows ?? []).map((row) => {
      const context = dates.get(row)!;

      const values: NativeTableRow = {
        product_id: nativeNumberCell(tableText(row.product_id), row.product_id),
        product_name: nativeTableCell(tableText(row.product_name)),
        amount: nativeNumberCell(
          `<span class="custom-sort d-none">${row.amount}</span>${tableLine}<span id="stock-${row.id}-amount" class="locale-number locale-number-quantity-amount number-parsing-done">${tableText(amount(row))}</span> <span id="product-${row.product_id}-qu-name">${tableText(unit(row))}</span>${tableLine}<span id="stock-${row.id}-opened-amount" class="small font-italic">${row.open === 1 ? tableText(t("Opened")) : ""}</span>`,
          row.amount,
        ),
        best_before_date: nativeTableCell(context.due.html, "html"),
        location_name: nativeTableCell(tableText(row.location_name)),
        shopping_location_name: nativeTableCell(tableText(row.shopping_location_name)),
        price: nativeNumberCell(tableText(price(row)), row.price ?? Number.NaN),
        purchased_date: nativeTableCell(context.purchased.html, "html"),
        purchased_date_group: nativeTableCell(tableText(row.purchased_date), "html"),
        row_created_timestamp: nativeTableCell(context.timestamp.html),
        note: nativeTableCell(`<span id="stock-${row.id}-note">${tableText(row.note)}</span>`),
        ...Object.fromEntries(
          productFields.map((field) => [
            `product:${field.name}`,
            nativeTableCell(tableText(row.product_values[field.name] ?? null)),
          ]),
        ),
        ...Object.fromEntries(
          stockFields.map((field) => [
            `stock:${field.name}`,
            nativeTableCell(tableText(row.stock_values[field.name] ?? null)),
          ]),
        ),
      };

      return [row, values] as const;
    }),
  );

  const value = (row: EntryRow, key: string): NativeTableCell =>
    cells.get(row)?.[key] ?? nativeTableCell("");

  const rows = (data.data?.rows ?? [])
    .filter(
      (row) =>
        (!product || String(row.product_id) === product) &&
        matchesTableSearch(value(row, "location_name").search, locationName),
    )
    .sort((a, b) => {
      for (const sort of options.sorters) {
        const order = compareNativeCells(value(a, sort.key), value(b, sort.key));

        if (order) return sort.descending ? -order : order;
      }

      return 0;
    });

  const columns = tableColumns.flatMap((c) =>
    c.key !== "actions" && c.rendered !== false ? [[c.key, c.label]] : [],
  );

  const error = data.error || definitions.error || action.error || undo.error;

  return (
    <>
      {editing !== undefined ? (
        <StockEntryDialog
          entryId={editing}
          onCancel={() => setEditing(undefined)}
          onSaved={(bookings) => {
            const booking = bookings[0];

            if (booking) {
              setRefreshedProducts((current) => [...new Set([...current, booking.product_id])]);
              setLastBooking(booking.id);
              notify({
                message: t("Stock entry successfully updated"),
                undo: () => undoBooking(booking.id),
              });
            }

            setEditing(undefined);
            requestAnimationFrame(() => table.current?.focus());
          }}
        />
      ) : null}
      <StockTableStatus options={options} />
      <div className="toolbar journal-filters">
        {search.embedded === undefined ? (
          <label className="field">
            <span>{t("Product")}</span>
            <select
              value={product ?? ""}
              onChange={(e) => onChange({ ...search, product: e.target.value || undefined })}
            >
              <option value="">{t("All")}</option>
              {data.data?.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {features.enabled("STOCK_LOCATION_TRACKING") ? (
          <label className="field">
            <span>{t("Location")}</span>
            <select value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="">{t("All")}</option>
              {data.data?.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className="btn"
          onClick={() => {
            setLocation("");
            onChange({
              ...search,
              product: search.embedded === undefined ? undefined : search.product,
            });
          }}
        >
          {t("Clear filter")}
        </button>
      </div>
      {error ? <ErrorBlock message={error.message} /> : null}
      {data.error || definitions.error ? (
        <button
          type="button"
          className="btn"
          onClick={() => void Promise.all([data.refetch(), definitions.refetch()])}
        >
          {t("Retry stock entries")}
        </button>
      ) : null}
      {lastBooking !== undefined ? (
        <div className="actions" role="status">
          <span>{t("Stock updated")}</span>
          <button
            type="button"
            className="btn"
            disabled={pending}
            onClick={() => undo.mutate(lastBooking)}
          >
            {t("Undo")}
          </button>
        </div>
      ) : null}
      {data.isPending || definitions.isPending ? (
        <LoadingBlock label={t("Loading stock entries…")} />
      ) : null}
      {data.isSuccess && definitions.isSuccess && options.ready ? (
        <>
          <p className="toolbar-note" role="status">
            {t("%s rows", String(rows.length))}
          </p>
          <div
            ref={table}
            className="journal-table-scroll"
            tabIndex={0}
            role="region"
            aria-label={t("Stock entries")}
          >
            <table className="stock-table journal-table entries-table">
              <caption className="sr-only">{t("Stock entries")}</caption>
              <thead>
                <tr>
                  <StockTableCells options={options} headers>
                    <th scope="col">
                      <StockTableOptions
                        options={options}
                        onReset={() => {
                          setLocation("");
                          setRefreshedProducts([]);
                          setLastBooking(undefined);
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
                  const context = dates.get(row)!;

                  const date =
                    options.groupColumn === "best_before_date"
                      ? context.due
                      : options.groupColumn === "purchased_date"
                        ? context.purchased
                        : options.groupColumn === "row_created_timestamp"
                          ? context.timestamp
                          : undefined;

                  const label = date ? <StockTableDate value={date} /> : name;

                  return { key: cell.html, label, name };
                })}
              >
                {rows.map((row) => {
                  const expired = !!row.best_before_date && row.best_before_date < isoDay();

                  const soon =
                    !!row.best_before_date &&
                    row.best_before_date <= isoDay(preferences.dueSoonDays);

                  return (
                    <tr
                      key={row.id}
                      data-due={
                        features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING") && row.amount > 0
                          ? expired
                            ? row.due_type === 1
                              ? "best-before"
                              : "expired"
                            : soon
                              ? "soon"
                              : undefined
                          : undefined
                      }
                    >
                      <StockTableCells options={options}>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              aria-label={t("Consume stock entry %s", String(row.id))}
                              disabled={pending}
                              onClick={() => action.mutate({ row, kind: "consume" })}
                            >
                              {t("Consume")}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              aria-label={t("Consume stock entry %s as spoiled", String(row.id))}
                              disabled={pending}
                              onClick={() => action.mutate({ row, kind: "spoiled" })}
                            >
                              {t("Spoiled")}
                            </button>
                            {features.enabled("STOCK_PRODUCT_OPENED_TRACKING") ? (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                aria-label={t("Open stock entry %s", String(row.id))}
                                disabled={
                                  pending ||
                                  row.open === 1 ||
                                  row.enable_tare_weight_handling === 1 ||
                                  row.disable_open === 1
                                }
                                onClick={() => action.mutate({ row, kind: "open" })}
                              >
                                {t("Open")}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={pending}
                              aria-label={t("Edit stock entry %s", String(row.id))}
                              onClick={() => setEditing(row.id)}
                            >
                              {t("Edit")}
                            </button>
                            <GrocycodeActions
                              kind="stock-entry"
                              id={row.id}
                              name={t("Stock entry %s", String(row.id))}
                              compact
                            />
                          </div>
                        </td>
                        <th scope="row">
                          <Link
                            to="/products/$productId"
                            params={{ productId: String(row.product_id) }}
                          >
                            {row.product_name}
                          </Link>
                        </th>
                        <td>
                          {amount(row)} {unit(row)}
                          {features.enabled("STOCK_PRODUCT_OPENED_TRACKING") && row.open === 1 ? (
                            <small> {t("Opened")}</small>
                          ) : null}
                        </td>
                        {features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING") ? (
                          <td>
                            <StockTableDate value={dates.get(row)!.due} />
                          </td>
                        ) : null}
                        {features.enabled("STOCK_LOCATION_TRACKING") ? (
                          <td>{row.location_name}</td>
                        ) : null}
                        {features.enabled("STOCK_PRICE_TRACKING") ? (
                          <>
                            <td>{row.shopping_location_name}</td>
                            <td
                              title={t(
                                "%1$s per %2$s",
                                preferences.formatCurrency(row.price ?? 0, currency),
                                row.qu_name ?? "",
                              )}
                            >
                              {price(row)}
                            </td>
                          </>
                        ) : null}
                        <td>
                          <StockTableDate value={dates.get(row)!.purchased} />
                        </td>
                        <td>
                          <StockTableDate value={dates.get(row)!.timestamp} />
                        </td>
                        <td>{row.note}</td>
                        {productFields.map((f) => (
                          <td key={f.id}>
                            <UserfieldValue field={f} value={row.product_values[f.name] ?? null} />
                          </td>
                        ))}
                        {stockFields.map((f) => (
                          <td key={f.id}>
                            <UserfieldValue field={f} value={row.stock_values[f.name] ?? null} />
                          </td>
                        ))}
                      </StockTableCells>
                    </tr>
                  );
                })}
              </StockTableRows>
            </table>
          </div>
          {!rows.length ? <p className="empty-state">{t("No stock entries.")}</p> : null}
        </>
      ) : null}
    </>
  );
}

export function ProductEntries({
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
        {t("Stock entries")}
      </button>
      {open ? (
        <EntriesDialog productId={productId} name={name} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function EntriesDialog({
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
  const [search, setSearch] = useState<EntriesSearch>({ product: String(productId), embedded: "" });

  return (
    <dialog
      ref={dialog}
      className="recipe-action-dialog stock-journal-dialog"
      aria-labelledby={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="section-heading">
        <h2 id={title}>{t("Stock entries")}</h2>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
      <p>{name}</p>
      <StockEntries search={search} onChange={setSearch} />
    </dialog>
  );
}
