import { useI18n } from "@/lib/i18n";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useCatalog } from "@/lib/catalog";
import { daysUntil, dueLabel, dueTone } from "@/lib/format";
import { usePreferences } from "@/lib/preferences";
import { ErrorBlock } from "@/components/ErrorBlock";
import { Gauge } from "@/components/Gauge";
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

import { getStockOverview } from "@/lib/stock-overview";
import { matchesTableSearch } from "@/lib/table-search";

type StockFilter = "all" | "due" | "overdue" | "expired" | "low" | "in-stock";

type Row = {
  productId: number;
  name: string;
  amount: number;
  ownAmount: number;
  minimumAmount: number;
  opened: number;
  min: number;
  bestBefore: string | null;
  locationName: string | null;
  locations: string;
  groupName: string | null;
  missing: boolean;
  dueType: number;
};

export function StockOverviewPage() {
  const { t: tr } = useI18n();

  const features = useFeatures();
  const can = usePermissions();
  const [transfer, setTransfer] = useState<number>();
  const [purchase, setPurchase] = useState<number>();
  const [consume, setConsume] = useState<number>();
  const [inventory, setInventory] = useState<number>();
  const datesEnabled = features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING");
  const locationsEnabled = features.enabled("STOCK_LOCATION_TRACKING");
  const { dueSoonDays, formatAmount } = usePreferences();
  const catalog = useCatalog();
  const [search, setSearch] = useState("");
  const [selection, setFilter] = useState<StockFilter>("all");

  const filter =
    !datesEnabled && ["due", "overdue", "expired"].includes(selection) ? "all" : selection;

  const [location, setLocation] = useState("");
  const [group, setGroup] = useState("");

  const stock = useQuery({
    queryKey: ["stock", "overview-view"],
    queryFn: ({ signal }) => getStockOverview(signal),
    retry: false,
  });

  const rows: Row[] = (stock.data?.rows ?? [])
    .map((item) => {
      const amount = item.is_aggregated_amount === 1 ? item.amount_aggregated : item.amount;

      const opened =
        item.is_aggregated_amount === 1 ? item.amount_opened_aggregated : item.amount_opened;

      return {
        productId: item.product_id,
        name: item.product_name ?? "",
        amount,
        ownAmount: item.amount,
        minimumAmount:
          catalog.product(item.product_id)?.treat_opened_as_out_of_stock === 1
            ? amount - opened
            : amount,
        opened,
        min: item.min_stock_amount,
        bestBefore: item.best_before_date,
        locationName: item.product_default_location_name,
        locations: item.location_names.map((name) => `xx${name ?? ""}xx`).join(" "),
        groupName: item.product_group_name,
        missing: item.product_missing === 1,
        dueType: item.due_type,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const isDue = (row: Row) => {
    const days = daysUntil(row.bestBefore);

    return row.ownAmount > 0 && days !== null && days >= 0 && days <= dueSoonDays;
  };

  const isPast = (row: Row) => row.ownAmount > 0 && (daysUntil(row.bestBefore) ?? 0) < 0;
  const isOverdue = (row: Row) => isPast(row) && row.dueType === 1;
  const isExpired = (row: Row) => isPast(row) && row.dueType !== 1;
  const isLow = (row: Row) => row.missing;

  const anyOpened =
    features.enabled("STOCK_PRODUCT_OPENED_TRACKING") && rows.some((row) => row.opened > 0);

  const counts = {
    all: rows.length,
    due: rows.filter(isDue).length,
    expired: rows.filter(isExpired).length,
    overdue: rows.filter(isOverdue).length,
    "in-stock": rows.filter((row) => row.amount > 0).length,
    low: rows.filter(isLow).length,
  };

  const visible = rows.filter((row) => {
    if (filter === "due" && !isDue(row)) return false;

    if (filter === "overdue" && !isOverdue(row)) return false;

    if (filter === "in-stock" && row.amount <= 0) return false;

    if (filter === "expired" && !isExpired(row)) return false;

    if (filter === "low" && !isLow(row)) return false;

    if (locationsEnabled && !matchesTableSearch(row.locations, location ? `xx${location}xx` : ""))
      return false;

    if (!matchesTableSearch(`xx${row.groupName ?? ""}xx`, group ? `xx${group}xx` : ""))
      return false;
    const q = search.trim().toLowerCase();

    return !q || row.name.toLowerCase().includes(q);
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
            onChange={(e) => setSearch(e.target.value)}
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
                    onClick={() => setFilter(id)}
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
            <select value={location} onChange={(e) => setLocation(e.target.value)}>
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
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
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

      {visible.length > 0 ? (
        <div
          className="panel journal-table-scroll"
          tabIndex={0}
          role="region"
          aria-label={tr("Stock overview")}
        >
          <table className="stock-table">
            <thead>
              <tr>
                <th scope="col">{tr("Product")}</th>
                <th scope="col">{tr("Level")}</th>
                <th scope="col" className="num">
                  {tr("Amount")}
                </th>
                {anyOpened ? (
                  <th scope="col" className="num">
                    {tr("Opened")}
                  </th>
                ) : null}
                {datesEnabled ? <th scope="col">{tr("Best before")}</th> : null}
                <th scope="col">
                  <span className="sr-only">{tr("Actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const tone = dueTone(row.bestBefore, dueSoonDays);

                return (
                  <tr key={row.productId} data-low={isLow(row) ? "true" : undefined}>
                    <td className="stock-name">
                      <Link to="/products/$productId" params={{ productId: String(row.productId) }}>
                        {row.name}
                      </Link>
                      <small>
                        {locationsEnabled ? (row.locationName ?? tr("No location")) : null}
                        {row.min > 0
                          ? tr(
                              "%1$smin %2$s",
                              String(locationsEnabled ? " · " : ""),
                              String(catalog.amountText(row.productId, row.min)),
                            )
                          : ""}
                      </small>
                    </td>
                    <td className="level">
                      <Gauge amount={row.minimumAmount} min={row.min} label={row.name} />
                    </td>
                    <td className="num amount">{catalog.amountText(row.productId, row.amount)}</td>
                    {anyOpened ? (
                      <td className="num opened">
                        {row.opened > 0 ? (
                          formatAmount(row.opened)
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                    ) : null}
                    {datesEnabled ? (
                      <td className="date">
                        {tone ? (
                          <span className="badge" data-tone={tone}>
                            {row.dueType === 1 && isOverdue(row)
                              ? tr("Overdue")
                              : dueLabel(row.bestBefore, dueSoonDays)}
                          </span>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                    ) : null}
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
