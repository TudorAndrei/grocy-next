import { useI18n } from "@/lib/i18n";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import { daysUntil } from "@/lib/format";
import { usePreferences } from "@/lib/preferences";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";
import { StockOverviewQuickActions } from "@/components/StockOverviewQuickActions";
import { StockOverviewMenu } from "@/components/StockOverviewMenu";
import { useFeatures } from "@/lib/features";
import { GrocycodeActions } from "@/components/GrocycodeActions";
import { TransferDialog } from "@/components/TransferForm";
import { PurchaseDialog } from "@/components/PurchaseForm";
import { ConsumeDialog } from "@/components/ConsumeForm";
import { InventoryDialog } from "@/components/InventoryForm";
import { usePermissions } from "@/lib/permissions";

import {
  getStockOverview,
  getOverviewProductRefresh,
  type OverviewProductRefresh,
  type StockOverviewRow,
} from "@/lib/stock-overview";
import { getStockStatistics, getVolatileStatistics } from "@/lib/stock-statistics";
import { useTableSnapshot } from "@/lib/table-snapshot";
import { StockProductChangeContext, useProductChangedMessage } from "@/lib/stock-product-change";
import { preferenceEnabled } from "@/lib/preferences";
import { userSettingsQuery } from "@/hooks/queries";
import { refreshOverviewCells, overviewRefreshTone } from "@/lib/stock-overview-refresh";
import { useNotify } from "./Toaster";
import { matchesTableSearch } from "@/lib/table-search";
import { overviewColumns, overviewCells } from "@/lib/stock-overview-table";
import { userfieldsQuery } from "@/lib/userfields";
import { useTableOptions } from "@/lib/table-options";
import { useTableOrder } from "@/lib/table-order";
import { tablePlainText } from "@/lib/native-table-cell";
import {
  StockTableCells,
  StockTableRows,
  StockTableOptions,
  StockTableStatus,
} from "./StockTableOptions";
import { UserfieldValue } from "./UserfieldValue";
import { EntityPicture } from "./EntityPicture";
import { ProductOverview } from "./ProductOverview";
import { useProductCardMemory } from "@/hooks/useProductCardMemory";

type StockFilter = "all" | "due" | "overdue" | "expired" | "low" | "in-stock";

type RowRefresh = OverviewProductRefresh & { drawVersion: number };

type Row = {
  source: StockOverviewRow;
  productId: number;
  name: string;
  amount: number;
  ownAmount: number;
  bestBefore: string | null;
  locations: string;
  groupName: string | null;
  missing: boolean;
  dueType: number;
  refreshed?: RowRefresh;
  hidden: boolean;
};

export function StockOverviewPage() {
  const { locale } = useI18n();

  return <StockOverviewContent key={locale} />;
}

function StockOverviewContent() {
  const { t: tr, n, pluralIndex, locale, ready: translationsReady } = useI18n();

  const features = useFeatures();
  const notify = useNotify();
  const settings = useQuery(userSettingsQuery());

  const [updates, setUpdates] = useState<{
    version: number;
    rows: Map<number, RowRefresh>;
  }>({ version: -1, rows: new Map() });

  const can = usePermissions();
  const [overview, setOverview] = useState<number>();
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [transfer, setTransfer] = useState<number>();
  const [purchase, setPurchase] = useState<number>();
  const [consume, setConsume] = useState<number>();
  const [inventory, setInventory] = useState<number>();
  const datesEnabled = features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING");
  const locationsEnabled = features.enabled("STOCK_LOCATION_TRACKING");
  const preferences = usePreferences();
  const { dueSoonDays } = preferences;
  const [search, setSearch] = useState("");
  const [selection, setFilter] = useState<StockFilter>("all");

  const filter =
    !datesEnabled && ["due", "overdue", "expired"].includes(selection) ? "all" : selection;

  const [location, setLocation] = useState("");
  const [group, setGroup] = useState("");

  const stock = useQuery({
    queryKey: ["stock", "overview-view", locale],
    queryFn: ({ signal }) => getStockOverview(signal),
    retry: false,
    enabled: translationsReady,
    refetchOnWindowFocus: false,
  });

  const statistics = useQuery({
    queryKey: ["stock", "overview-statistics"],
    queryFn: ({ signal }) => getStockStatistics(signal),
    retry: false,
    enabled: translationsReady,
  });

  const volatile = useQuery({
    queryKey: ["stock", "overview-volatile-statistics", dueSoonDays],
    queryFn: ({ signal }) => getVolatileStatistics(dueSoonDays, signal),
    retry: false,
    enabled: translationsReady,
  });

  const definitions = useQuery(userfieldsQuery);

  const fields =
    definitions.data?.filter((f) => f.entity === "products" && f.show_as_column_in_tables === 1) ??
    [];

  const columns = overviewColumns(
    datesEnabled,
    features.enabled("STOCK_PRICE_TRACKING"),
    fields,
    tr,
  );

  const options = useTableOptions(
    "stock-overview-table",
    columns,
    { key: "best_before_date", descending: false },
    stock.isSuccess && definitions.isSuccess,
  );

  const overviewMemory = useProductCardMemory({ resetVersion: options.resetVersion });

  const initial = useTableSnapshot(
    stock.data,
    stock.isSuccess && !stock.isFetching && definitions.isSuccess && options.ready,
    options.resetVersion,
    stock.dataUpdatedAt,
  );

  const tableVersion = useRef({ reset: options.resetVersion, draw: options.drawVersion });
  const refreshScope = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    const scope = new AbortController();
    refreshScope.current = scope;

    return () => scope.abort();
  }, [options.resetVersion]);
  useLayoutEffect(() => {
    tableVersion.current = { reset: options.resetVersion, draw: options.drawVersion };
  }, [options.resetVersion, options.drawVersion]);

  function applyRefresh(refreshed: OverviewProductRefresh) {
    const version = tableVersion.current;
    setUpdates((current) => {
      const rows =
        current.version === version.reset ? new Map(current.rows) : new Map<number, RowRefresh>();

      rows.set(refreshed.product.id, { ...refreshed, drawVersion: version.draw });

      return { version: version.reset, rows };
    });
  }

  async function refreshProduct(productId: number, seen = new Set<number>()) {
    const scope = refreshScope.current;

    if (!scope || scope.signal.aborted) return;

    if (seen.has(productId)) return;
    seen.add(productId);

    try {
      const refreshed = await getOverviewProductRefresh(productId, scope.signal);

      if (scope.signal.aborted) return;
      applyRefresh(refreshed);

      if (refreshed.product.parent_product_id !== null)
        await refreshProduct(refreshed.product.parent_product_id, seen);
    } catch (error) {
      if (scope.signal.aborted) return;
      notify({
        message: error instanceof Error ? error.message : tr("Failed to load product"),
        tone: "error",
      });
    }
  }

  useProductChangedMessage(async (id) => {
    await Promise.all([refreshProduct(id), statistics.refetch(), volatile.refetch()]);
  });

  const rows: Row[] = (initial?.value.rows ?? []).map((item) => {
    const refreshed =
      updates.version === options.resetVersion ? updates.rows.get(item.product_id) : undefined;

    const hidden =
      !!refreshed &&
      !preferenceEnabled(settings.data?.stock_overview_show_all_out_of_stock_products) &&
      refreshed.stock_amount === 0 &&
      refreshed.stock_amount_aggregated === 0 &&
      Number(refreshed.product.min_stock_amount) === 0;

    const amount = item.is_aggregated_amount === 1 ? item.amount_aggregated : item.amount;

    return {
      source: item,
      refreshed,
      hidden,
      productId: item.product_id,
      name: item.product_name ?? "",
      amount,
      ownAmount: item.amount,
      bestBefore: item.best_before_date,
      locations: item.location_names.map((name) => `xx${name ?? ""}xx`).join(" "),
      groupName: item.product_group_name,
      missing: item.product_missing === 1,
      dueType: item.due_type,
    };
  });

  const isDue = (row: Row) => {
    const days = daysUntil(row.bestBefore);

    return row.ownAmount > 0 && days !== null && days >= 0 && days <= dueSoonDays;
  };

  const isPast = (row: Row) => row.ownAmount > 0 && (daysUntil(row.bestBefore) ?? 0) < 0;
  const isOverdue = (row: Row) => isPast(row) && row.dueType === 1;
  const isExpired = (row: Row) => isPast(row) && row.dueType !== 1;
  const isLow = (row: Row) => row.missing;

  const now = new Date(initial?.at || 0);

  const cells = new Map(
    rows.map((row) => [
      row,
      overviewCells(row.source, fields, {
        now,
        locale: tr("moment_locale"),
        t: tr,
        amountPrecision: preferences.amountPrecision,
        pricePrecision: preferences.priceDisplayPrecision,
        currency: String(features.query.data?.CURRENCY ?? "USD"),
        config: features.query.data,
        showShoppingIcon: initial?.value.show_shopping_icon ?? false,
        dueDays: dueSoonDays,
      }),
    ]),
  );

  const displayedCells = new Map(
    rows.map((row) => [
      row,
      row.refreshed
        ? refreshOverviewCells(
            cells.get(row)!,
            row.refreshed,
            {
              amountPrecision: preferences.amountPrecision,
              pricePrecision: preferences.priceDisplayPrecision,
              currency: String(features.query.data?.CURRENCY ?? "USD"),
              locale: tr("moment_locale"),
              t: tr,
              pluralIndex,
            },
            row.hidden,
          )
        : cells.get(row)!,
    ]),
  );

  const ordered = useTableOrder(
    rows.map((row) => ({ key: String(row.productId), row, cells: cells.get(row)! })),
    options,
    stock.isSuccess && definitions.isSuccess,
  );

  const counts = {
    all: rows.length,
    due: volatile.data?.due,
    expired: volatile.data?.expired,
    overdue: volatile.data?.overdue,
    "in-stock": rows.filter((row) => row.amount > 0).length,
    low: volatile.data?.low,
  };

  const visible = ordered.filter((row) => {
    const status = cells.get(row)!.status!.search;

    if (filter === "due" && !status.includes("duesoon")) return false;

    if (filter === "overdue" && !status.includes("overdue")) return false;

    if (filter === "in-stock" && !status.includes("instockX")) return false;

    if (filter === "expired" && !status.includes("expired")) return false;

    if (filter === "low" && !status.includes("belowminstockamount")) return false;

    if (locationsEnabled && !matchesTableSearch(row.locations, location ? `xx${location}xx` : ""))
      return false;

    if (!matchesTableSearch(`xx${row.groupName ?? ""}xx`, group ? `xx${group}xx` : ""))
      return false;

    return matchesTableSearch(
      Object.values(cells.get(row)!)
        .map((cell) => cell.search)
        .join("  "),
      search,
    );
  });

  const filters: Array<[StockFilter, string]> = [
    ["all", "All"],
    ["due", "Due soon"],
    ["overdue", "Overdue"],
    ["expired", "Expired"],
    ["low", "Below min"],
    ["in-stock", "In stock"],
  ];

  return (
    <StockProductChangeContext.Provider value={refreshProduct}>
      {transfer !== undefined ? (
        <TransferDialog
          options={{ embedded: "", product: String(transfer) }}
          onClose={() => setTransfer(undefined)}
        />
      ) : null}
      {purchase !== undefined ? (
        <PurchaseDialog
          options={{ embedded: "", product: String(purchase) }}
          onClose={() => setPurchase(undefined)}
        />
      ) : null}
      {consume !== undefined ? (
        <ConsumeDialog
          options={{ embedded: "", product: String(consume) }}
          onClose={() => setConsume(undefined)}
        />
      ) : null}
      {inventory !== undefined ? (
        <InventoryDialog
          options={{ embedded: "", product: String(inventory) }}
          onClose={() => setInventory(undefined)}
        />
      ) : null}
      <PageHeader
        title={tr("Stock overview")}
        lead={tr(
          "What is on hand, how full each product is against its minimum, and what to use first.",
        )}
        actions={
          <>
            <Link to="/stocksettings" className="btn btn-ghost">
              {tr("Stock settings")}
            </Link>
            <Link to="/journal" className="btn btn-ghost">
              {tr("Journal")}
            </Link>
            <Link to="/stockentries" className="btn btn-ghost">
              {tr("Stock entries")}
            </Link>
            {features.enabled("STOCK_LOCATION_TRACKING") ? (
              <Link to="/locationcontentsheet" className="btn btn-ghost">
                {tr("Location Content Sheet")}
              </Link>
            ) : null}
            {features.enabled("STOCK_PRICE_TRACKING") ? (
              <Link to="/stockreports/spendings" className="btn btn-ghost">
                {tr("Spendings")}
              </Link>
            ) : null}
            <Link to="/barcode" className="btn btn-ghost">
              {tr("Barcode")}
            </Link>
            <Link to="/consume" className="btn">
              {tr("Consume")}
            </Link>
            <Link to="/inventory" className="btn">
              {tr("Inventory")}
            </Link>
            <Link to="/purchase" className="btn btn-primary">
              {tr("Purchase")}
            </Link>
          </>
        }
      />

      {statistics.data ? (
        <p id="info-current-stock" className="toolbar-note">
          {n(statistics.data.products, "%s Product", "%s Products")}
          {features.enabled("STOCK_PRICE_TRACKING")
            ? ", " +
              tr(
                "%s total value",
                statistics.data.value.toLocaleString(undefined, {
                  style: "currency",
                  currency: String(features.query.data?.CURRENCY ?? "USD"),
                }),
              )
            : ""}
        </p>
      ) : null}
      {statistics.error || volatile.error ? (
        <>
          <ErrorBlock message={(statistics.error ?? volatile.error)!.message} />
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (statistics.isError) void statistics.refetch();

              if (volatile.isError) void volatile.refetch();
            }}
          >
            {tr("Retry stock statistics")}
          </button>
        </>
      ) : null}
      <div className="toolbar stock-overview-filters">
        <label className="search-field">
          <span className="sr-only">{tr("Search stock")}</span>
          <input
            type="search"
            placeholder={tr("Search products")}
            value={search}
            onChange={(e) => {
              options.draw();
              setSearch(e.target.value);
            }}
          />
        </label>
        <div className="chips" role="group" aria-label={tr("Stock filter")}>
          {filters.flatMap(([id, label]) =>
            !datesEnabled && ["due", "overdue", "expired"].includes(id)
              ? []
              : [
                  <button
                    key={id}
                    type="button"
                    className="chip"
                    data-tone={id}
                    title={
                      id === "due" && counts.due !== undefined
                        ? n(counts.due, "%s product is due", "%s products are due") +
                          " " +
                          n(dueSoonDays, "within the next day", "within the next %s days")
                        : undefined
                    }
                    aria-pressed={filter === id}
                    onClick={() => {
                      options.draw();
                      setFilter(id);
                    }}
                  >
                    {tr(label)}
                    <span className="chip-count">{counts[id]}</span>
                  </button>,
                ],
          )}
        </div>
        {locationsEnabled ? (
          <label className="select-field">
            <span className="sr-only">{tr("Location")}</span>
            <select
              value={location}
              onChange={(e) => {
                options.draw();
                setLocation(e.target.value);
              }}
            >
              <option value="">{tr("All locations")}</option>
              {(stock.data?.locations ?? []).map((location) => (
                <option key={location.id} value={location.name ?? ""}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="select-field">
          <span className="sr-only">{tr("Product group")}</span>
          <select
            value={group}
            onChange={(e) => {
              options.draw();
              setGroup(e.target.value);
            }}
          >
            <option value="">{tr("All product groups")}</option>
            {(stock.data?.product_groups ?? []).map((item) => (
              <option key={item.id} value={item.name ?? ""}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            options.draw();
            setSearch("");
            setFilter("all");
            setLocation("");
            setGroup("");
          }}
        >
          {tr("Clear filter")}
        </button>
      </div>

      {stock.isLoading ? <LoadingBlock label={tr("Loading stock…")} /> : null}
      {stock.isError ? (
        <>
          <ErrorBlock message={stock.error.message} />
          <button type="button" className="btn" onClick={() => void stock.refetch()}>
            {tr("Retry")}
          </button>
        </>
      ) : null}

      {stock.isSuccess && visible.length === 0 ? (
        <p className="empty-state">
          {rows.length === 0
            ? tr("Stock is empty. Press Purchase or ⌘K to book what you bought.")
            : tr("No product matches this filter.")}
        </p>
      ) : null}

      <StockTableStatus options={options} />
      {definitions.isPending ? <LoadingBlock label={tr("Loading custom fields…")} /> : null}
      {definitions.error ? (
        <>
          <ErrorBlock message={definitions.error.message} />
          <button type="button" className="btn" onClick={() => void definitions.refetch()}>
            {tr("Retry custom fields")}
          </button>
        </>
      ) : null}
      {stock.isSuccess && definitions.isSuccess && options.ready ? (
        <div
          className="panel journal-table-scroll"
          tabIndex={0}
          role="region"
          aria-label={tr("Stock overview")}
        >
          <table id="stock-overview-table" className="stock-table journal-table overview-table">
            <caption className="sr-only">{tr("Stock overview")}</caption>
            <thead>
              <tr>
                <StockTableCells options={options} headers>
                  <th scope="col">
                    <StockTableOptions
                      options={options}
                      onReset={() => {
                        setOverview(undefined);
                        setOverviewExpanded(false);
                        options.draw();
                        setSearch("");
                        setLocation("");
                        setGroup("");
                        setFilter("all");
                        void stock.refetch();
                        options.reload();
                      }}
                    />
                  </th>
                  {columns
                    .filter((c) => c.key !== "actions" && c.rendered !== false)
                    .map((column) => (
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
                          onClick={(e) => options.sortBy(column.key, e.shiftKey)}
                        >
                          {column.labelIsLiteral ? column.label : tr(column.label)}
                        </button>
                      </th>
                    ))}
                </StockTableCells>
              </tr>
            </thead>
            <StockTableRows
              options={options}
              refreshDrawVersions={visible.map((row) => row.refreshed?.drawVersion)}
              groups={visible.map((row) => {
                const groupedField = fields.find(
                  (field) => options.groupColumn === `product:${field.name}`,
                );

                const groupedValues = row.source.product_values;
                const cell = cells.get(row)![options.groupColumn ?? ""];
                const name = cell ? tablePlainText(cell.html) : "";

                return {
                  key: cell?.html ?? "",
                  label: name,
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
              {visible.map((row) => (
                <tr
                  key={row.productId}
                  id={`product-${row.productId}-row`}
                  hidden={row.hidden}
                  data-low={
                    (
                      row.refreshed
                        ? overviewRefreshTone(row.refreshed, dueSoonDays) === "low"
                        : isLow(row)
                    )
                      ? "true"
                      : undefined
                  }
                  data-due={
                    row.refreshed
                      ? overviewRefreshTone(row.refreshed, dueSoonDays) === "low"
                        ? undefined
                        : overviewRefreshTone(row.refreshed, dueSoonDays)
                      : datesEnabled
                        ? isOverdue(row)
                          ? "best-before"
                          : isExpired(row)
                            ? "expired"
                            : isDue(row)
                              ? "soon"
                              : undefined
                        : undefined
                  }
                >
                  <StockTableCells options={options}>
                    <td className="row-actions">
                      <StockOverviewQuickActions
                        row={row.source}
                        refreshed={row.hidden ? undefined : row.refreshed}
                      />
                      <button
                        type="button"
                        className="btn btn-sm"
                        aria-label={tr("Purchase %s", row.name)}
                        disabled={!can("STOCK_PURCHASE")}
                        onClick={() => setPurchase(row.productId)}
                      >
                        {tr("Purchase")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        aria-label={tr("Consume %s", row.name)}
                        disabled={row.amount <= 0 || !can("STOCK_CONSUME")}
                        onClick={() => setConsume(row.productId)}
                      >
                        {tr("Consume")}
                      </button>
                      {locationsEnabled ? (
                        <button
                          type="button"
                          className="btn btn-sm"
                          aria-label={tr("Transfer %s", row.name)}
                          disabled={row.ownAmount <= 0 || !can("STOCK_TRANSFER")}
                          onClick={() => setTransfer(row.productId)}
                        >
                          {tr("Transfer")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-sm"
                        aria-label={tr("Inventory %s", row.name)}
                        disabled={!can("STOCK_INVENTORY")}
                        onClick={() => setInventory(row.productId)}
                      >
                        {tr("Inventory")}
                      </button>
                      <GrocycodeActions kind="product" id={row.productId} name={row.name} compact />
                      <StockOverviewMenu
                        row={row.source}
                        onOverview={() => setOverview(row.productId)}
                      />
                    </td>
                    {columns
                      .filter((c) => c.key !== "actions" && c.rendered !== false)
                      .map((column) => {
                        const raw = row.source;

                        if (column.key === "product_name" || column.key === "parent_product_name") {
                          const parent = column.key === "parent_product_name";
                          const id = parent ? raw.parent_product_id : row.productId;
                          const name = parent ? raw.parent_product_name : row.name;

                          return (
                            <td key={column.key} className={parent ? undefined : "stock-name"}>
                              {id === null ? (
                                name
                              ) : (
                                <a
                                  href="#"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    setOverview(id);
                                  }}
                                >
                                  {name}
                                </a>
                              )}
                            </td>
                          );
                        }

                        if (column.key === "product_picture")
                          return (
                            <td key={column.key}>
                              {raw.product_picture_file_name &&
                              raw.product_picture_file_name !== "0" ? (
                                <EntityPicture
                                  group="productpictures"
                                  source={raw.product_picture_file_name}
                                  label={row.name}
                                  width={64}
                                  height={64}
                                />
                              ) : null}
                            </td>
                          );
                        const field = fields.find((f) => column.key === "product:" + f.name);

                        if (field)
                          return (
                            <td key={column.key}>
                              <UserfieldValue
                                nativeTable
                                field={field}
                                value={raw.product_values[field.name] ?? null}
                                present={Object.hasOwn(raw.product_values, field.name)}
                              />
                            </td>
                          );

                        return (
                          <td
                            key={column.key}
                            dangerouslySetInnerHTML={{
                              __html: displayedCells.get(row)![column.key]?.html ?? "",
                            }}
                          />
                        );
                      })}
                  </StockTableCells>
                </tr>
              ))}
            </StockTableRows>
          </table>
        </div>
      ) : null}
      {overview !== undefined ? (
        <ProductOverview
          productId={overview}
          memory={overviewMemory}
          embedded={false}
          expanded={overviewExpanded}
          onExpandedChange={setOverviewExpanded}
          onReturn={async () => {
            await Promise.all([refreshProduct(overview), statistics.refetch(), volatile.refetch()]);
          }}
          onClose={() => setOverview(undefined)}
        />
      ) : null}
    </StockProductChangeContext.Provider>
  );
}
