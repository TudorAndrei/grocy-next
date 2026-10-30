import { useI18n } from "@/lib/i18n";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { daysUntil } from "@/lib/format";
import { usePreferences } from "@/lib/preferences";
import { ErrorBlock } from "@/components/ErrorBlock";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";
import { QuickMoves } from "@/components/QuickMoves";
import { useFeatures } from "@/lib/features";
import { GrocycodeActions } from "@/components/GrocycodeActions";
import { TransferDialog } from "@/components/TransferForm";
import { PurchaseDialog } from "@/components/PurchaseForm";
import { ConsumeDialog } from "@/components/ConsumeForm";
import { InventoryDialog } from "@/components/InventoryForm";
import { usePermissions } from "@/lib/permissions";

import { getStockOverview, type StockOverviewRow } from "@/lib/stock-overview";
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

type StockFilter = "all" | "due" | "overdue" | "expired" | "low" | "in-stock";

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
};

export function StockOverviewPage() {
  const { t: tr, locale, ready: translationsReady } = useI18n();

  const features = useFeatures();
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
  });

  const rows: Row[] = (stock.data?.rows ?? []).map((item) => {
    const amount = item.is_aggregated_amount === 1 ? item.amount_aggregated : item.amount;

    return {
      source: item,
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

  const now = new Date(stock.dataUpdatedAt || 0);

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
        showShoppingIcon: stock.data?.show_shopping_icon ?? false,
        dueDays: dueSoonDays,
      }),
    ]),
  );

  const ordered = useTableOrder(
    rows.map((row) => ({ key: String(row.productId), row, cells: cells.get(row)! })),
    options,
    stock.isSuccess && definitions.isSuccess,
  );

  const counts = {
    all: rows.length,
    due: rows.filter(isDue).length,
    expired: rows.filter(isExpired).length,
    overdue: rows.filter(isOverdue).length,
    "in-stock": rows.filter((row) => row.amount > 0).length,
    low: rows.filter(isLow).length,
  };

  const visible = ordered.filter((row) => {
    if (filter === "due" && !isDue(row)) return false;

    if (filter === "overdue" && !isOverdue(row)) return false;

    if (filter === "in-stock" && row.amount <= 0) return false;

    if (filter === "expired" && !isExpired(row)) return false;

    if (filter === "low" && !isLow(row)) return false;

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
    <>
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
              groups={visible.map((row) => {
                const cell = cells.get(row)![options.groupColumn ?? ""];
                const name = cell ? tablePlainText(cell.html) : "";

                return { key: cell?.html ?? "", label: name, name };
              })}
            >
              {visible.map((row) => (
                <tr
                  key={row.productId}
                  data-low={isLow(row) ? "true" : undefined}
                  data-due={
                    datesEnabled
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
                      <QuickMoves productId={row.productId} name={row.name} amount={row.amount} />
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
                                field={field}
                                value={raw.product_values[field.name] ?? null}
                              />
                            </td>
                          );

                        return (
                          <td
                            key={column.key}
                            dangerouslySetInnerHTML={{
                              __html: cells.get(row)![column.key]?.html ?? "",
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
          embedded={false}
          expanded={overviewExpanded}
          onExpandedChange={setOverviewExpanded}
          onReturn={async () => {
            await stock.refetch();
          }}
          onClose={() => setOverview(undefined)}
        />
      ) : null}
    </>
  );
}
