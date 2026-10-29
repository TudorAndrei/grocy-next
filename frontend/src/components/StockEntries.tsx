import { ProductOverview } from "./ProductOverview";
import { useId, useRef, useState } from "react";
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
  nativeNumberCell,
  nativeTableCell,
  tableDate,
  tableAttribute,
  tableLine,
  tablePlainText,
  tableText,
  type NativeTableCell,
  type NativeTableRow,
} from "@/lib/native-table-cell";
import { StockTableDate } from "./StockTableDate";
import { useTableSnapshot } from "@/lib/table-snapshot";
import { refreshEntry, type EntryRefresh } from "@/lib/entry-refresh";
import { matchesTableSearch } from "@/lib/table-search";
import { useTableOrder } from "@/lib/table-order";
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
  const [overview, setOverview] = useState<number>();
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const { t, pluralIndex, ready: translationsReady } = useI18n();
  const features = useFeatures();
  const preferences = usePreferences();
  const invalidate = useInvalidateStock();
  const notify = useNotify();
  const table = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<number>();
  const [location, setLocation] = useState("");
  const [reloading, setReloading] = useState(false);
  const [consumeLocation, setConsumeLocation] = useState<{ value: number; cellVersion: number }>();

  const [display, setDisplay] = useState<{
    version: number;
    rows: Map<number, (EntryRefresh & { cellVersion: number }) | null>;
  }>({ version: -1, rows: new Map() });

  const data = useQuery({
    queryKey: ["stock", "entries-view"],
    queryFn: ({ signal }) => api.getStockEntries(signal),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
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

  const priceParts = (row: EntryRow, refreshed = false) =>
    [
      preferences.formatCurrency(
        (row.price ?? 0) *
          (refreshed ? row.qu_factor_purchase_to_stock : row.qu_factor_price_to_stock),
        currency,
      ),
      (refreshed ? row.purchase_qu_name : row.price_qu_name) ?? "",
    ] as const;

  const price = (row: EntryRow, refreshed = false) =>
    t("%1$s per %2$s", ...priceParts(row, refreshed));

  const [lastBooking, setLastBooking] = useState<{ id: number; product: number }>();

  const undoBooking = async ({ id, product }: { id: number; product: number }) => {
    await api.action(`/api/stock/bookings/${id}/undo`);
    setLastBooking(undefined);
    await invalidate();
    await refresh.mutateAsync(product).catch(() => undefined);
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
                  location_id: String(
                    consumeLocation?.cellVersion === options.cellVersion
                      ? consumeLocation.value
                      : row.location_id,
                  ),
                  stock_entry_id: row.stock_id,
                  exact_amount: true,
                },
          ),
        },
      ),
    onSuccess: async (bookings, { row, kind }) => {
      await invalidate();
      await refresh.mutateAsync(row.product_id).catch(() => undefined);
      const bookingId = bookings[0]?.id;
      const last = bookingId === undefined ? undefined : { id: bookingId, product: row.product_id };
      notify({
        message:
          t(
            kind === "open" ? "Marked %1$s of %2$s as opened" : "Removed %1$s of %2$s from stock",
            `${amount(row)} ${unit(row)}`,
            row.product_name ?? "",
          ) + (kind === "spoiled" ? ` (${t("Spoiled")})` : ""),
        undo: last === undefined ? undefined : () => undoBooking(last),
      });
      setLastBooking(last);
    },
  });

  const undo = useMutation({
    mutationFn: undoBooking,
  });

  const refresh = useMutation({ mutationFn: (product: number) => refreshProduct(product) });

  const pending = action.isPending || undo.isPending || refresh.isPending || reloading;

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

  const changed = (row: EntryRow) =>
    display.version === options.resetVersion ? display.rows.get(row.id) : undefined;

  const reload = async () => {
    setReloading(true);

    try {
      const result = await data.refetch();

      if (result.isSuccess) {
        options.reload();
        setConsumeLocation(undefined);
        setLocation("");
        setLastBooking(undefined);
        action.reset();
        undo.reset();
        refresh.reset();
      }
    } finally {
      setReloading(false);
    }
  };

  const refreshProduct = async (productId: number) => {
    const targets = rows.filter((row) => row.product_id === productId);

    if (targets.some((row) => changed(row) === null)) {
      await reload();

      return;
    }

    const updates = await Promise.allSettled(
      targets.map((row) =>
        refreshEntry(row.id, (update) => {
          if (update?.location_id !== undefined)
            setConsumeLocation({ value: update.location_id, cellVersion: options.cellVersion });
          setDisplay((current) => {
            const rows =
              current.version === options.resetVersion
                ? new Map(current.rows)
                : new Map<number, (EntryRefresh & { cellVersion: number }) | null>();

            const previous = rows.get(row.id);
            rows.set(
              row.id,
              update === null
                ? null
                : {
                    ...(previous?.cellVersion === options.cellVersion ? previous : undefined),
                    ...update,
                    cellVersion: options.cellVersion,
                  },
            );

            return { version: options.resetVersion, rows };
          });
        }),
      ),
    );

    for (const update of updates) if (update.status === "rejected") throw update.reason;
  };

  const product = initial?.value.products.some((p) => String(p.id) === search.product)
    ? search.product
    : undefined;

  const locationName = initial?.value.locations.find((l) => String(l.id) === location)?.name ?? "";

  const dates = new Map(
    (initial?.value.rows ?? []).map((row) => [
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
    (initial?.value.rows ?? []).map((row) => {
      const context = dates.get(row)!;
      const [priceValue, priceUnit] = priceParts(row);

      const priceTitle = t(
        "%1$s per %2$s",
        `<span class='locale-number locale-number-currency'>${tableText(row.price)}</span>`,
        row.qu_name ?? "",
      );

      const priceMarkup = t(
        "%1$s per %2$s",
        `<span class="locale-number locale-number-currency number-parsing-done">${tableText(priceValue)}</span>`,
        tableText(priceUnit),
      );

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
        price: nativeNumberCell(
          `<span class="custom-sort d-none">${tableText(row.price)}</span>${tableLine}<span id="stock-${row.id}-price" data-toggle="tooltip" data-trigger="hover click" data-html="true" title="" data-original-title="${tableAttribute(priceTitle)}">${tableLine}\t${priceMarkup}${tableLine}</span>`,
          row.price ?? Number.NaN,
        ),
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

  const ordered = useTableOrder(
    (initial?.value.rows ?? []).map((row) => ({
      key: String(row.id),
      row,
      cells: cells.get(row)!,
    })),
    options,
    !!initial,
  );

  const rows = ordered.filter(
    (row) =>
      (!product || String(row.product_id) === product) &&
      matchesTableSearch(value(row, "location_name").search, locationName),
  );

  const columns = tableColumns.flatMap((c) =>
    c.key !== "actions" && c.rendered !== false ? [[c.key, c.label]] : [],
  );

  const error = data.error || definitions.error || action.error || undo.error || refresh.error;

  return (
    <>
      {editing !== undefined ? (
        <StockEntryDialog
          entryId={editing}
          onCancel={() => setEditing(undefined)}
          onSaved={async (bookings) => {
            const booking = bookings[0];

            if (booking) {
              await refresh.mutateAsync(booking.product_id).catch(() => undefined);
              const last = { id: booking.id, product: booking.product_id };
              setLastBooking(last);
              notify({
                message: t("Stock entry successfully updated"),
                undo: () => undoBooking(last),
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
              onChange={(e) => {
                options.draw();
                onChange({ ...search, product: e.target.value || undefined });
              }}
            >
              <option value="">{t("All")}</option>
              {initial?.value.products.map((p) => (
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
            <select
              value={location}
              onChange={(e) => {
                options.draw();
                setLocation(e.target.value);
              }}
            >
              <option value="">{t("All")}</option>
              {initial?.value.locations.map((l) => (
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
            options.draw();
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
          onClick={() => void Promise.all([reload(), definitions.refetch()])}
        >
          {t("Retry stock entries")}
        </button>
      ) : null}
      {refresh.isError ? (
        <button
          type="button"
          className="btn"
          disabled={pending}
          onClick={() => refresh.mutate(refresh.variables)}
        >
          {t("Retry stock entries")}
        </button>
      ) : null}
      {lastBooking !== undefined ? (
        <div className="actions" role="status" aria-label={t("Stock updated")}>
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
      {!initial && !data.error && !definitions.error ? (
        <LoadingBlock label={t("Loading stock entries…")} />
      ) : null}
      {initial ? (
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
                          setLastBooking(undefined);
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

                  const name =
                    options.groupColumn === "price"
                      ? price(row)
                      : options.groupColumn === "amount"
                        ? `${amount(row)} ${unit(row)}${row.open === 1 ? ` ${t("Opened")}` : ""}`
                        : tablePlainText(cell.html);

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
                  const appearance = changed(row);

                  const update =
                    appearance?.cellVersion === options.cellVersion ? appearance : undefined;

                  const status = { ...row, ...appearance };
                  const current = { ...row, ...update };
                  const refreshed = update?.qu_factor_purchase_to_stock !== undefined;
                  const priceRow = refreshed ? current : row;

                  const context = update
                    ? {
                        due: tableDate(
                          current.best_before_date,
                          new Date(update.at),
                          t("moment_locale"),
                          t,
                          { dateOnly: true },
                        ),
                        purchased: tableDate(
                          current.purchased_date,
                          new Date(update.at),
                          t("moment_locale"),
                          t,
                          { dateOnly: true },
                        ),
                        timestamp: tableDate(
                          row.row_created_timestamp,
                          new Date(update.at),
                          t("moment_locale"),
                          t,
                        ),
                      }
                    : dates.get(row)!;

                  const expired = !!status.best_before_date && status.best_before_date < isoDay();

                  const soon =
                    !!status.best_before_date &&
                    status.best_before_date <= isoDay(preferences.dueSoonDays);

                  return (
                    <tr
                      key={row.id}
                      style={appearance === null ? { display: "none" } : undefined}
                      data-due={
                        features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING") && status.amount > 0
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
                                  (update?.openDisabled ??
                                    (row.open === 1 ||
                                      row.enable_tare_weight_handling === 1 ||
                                      row.disable_open === 1))
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
                          <button
                            type="button"
                            className="stock-product-trigger"
                            aria-label={`${t("Product overview")}: ${row.product_name ?? ""}`}
                            onClick={() => setOverview(row.product_id)}
                          >
                            {row.product_name}
                          </button>
                        </th>
                        <td>
                          {amount(current)} {unit(row)}
                          {features.enabled("STOCK_PRODUCT_OPENED_TRACKING") &&
                          current.open === 1 ? (
                            <small> {t("Opened")}</small>
                          ) : null}
                        </td>
                        {features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING") ? (
                          <td>
                            <StockTableDate value={context.due} />
                          </td>
                        ) : null}
                        {features.enabled("STOCK_LOCATION_TRACKING") ? (
                          <td>{current.location_name}</td>
                        ) : null}
                        {features.enabled("STOCK_PRICE_TRACKING") ? (
                          <>
                            <td>{current.shopping_location_name}</td>
                            <td
                              title={t(
                                "%1$s per %2$s",
                                preferences.formatCurrency(priceRow.price ?? 0, currency),
                                priceRow.qu_name ?? "",
                              )}
                            >
                              {price(priceRow, refreshed)}
                            </td>
                          </>
                        ) : null}
                        <td>
                          <StockTableDate value={context.purchased} />
                        </td>
                        <td>
                          <StockTableDate value={context.timestamp} />
                        </td>
                        <td>{current.note}</td>
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
      {overview !== undefined ? (
        <ProductOverview
          productId={overview}
          embedded={search.embedded !== undefined}
          expanded={overviewExpanded}
          onExpandedChange={setOverviewExpanded}
          onReturn={async () => {
            await reload();
            requestAnimationFrame(() => table.current?.focus());
          }}
          onClose={() => setOverview(undefined)}
        />
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
        e.stopPropagation();
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
