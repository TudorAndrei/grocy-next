import { useI18n } from "@/lib/i18n";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, queryKeys } from "@/lib/api";
import { openedStockAmount, stockAmount, stockMinimumAmount, useCatalog } from "@/lib/catalog";
import { daysUntil, dueLabel, dueTone } from "@/lib/format";
import { usePreferences } from "@/lib/preferences";
import { stockVolatileQuery } from "@/hooks/queries";
import { useCommandBar } from "@/components/CommandBar";
import { ErrorBlock } from "@/components/ErrorBlock";
import { Gauge } from "@/components/Gauge";
import { LoadingBlock } from "@/components/LoadingBlock";
import { PageHeader } from "@/components/PageHeader";
import { QuickMoves } from "@/components/QuickMoves";
import { useFeatures } from "@/lib/features";

export const Route = createFileRoute("/stock")({
  component: StockPage,
});

type StockFilter = "all" | "due" | "expired" | "low";

type Row = {
  productId: number;
  name: string;
  amount: number;
  minimumAmount: number;
  opened: number;
  min: number;
  bestBefore: string | null;
  locationId: number | null;
};

function StockPage() {
  const { t: tr } = useI18n();

  const features = useFeatures();
  const datesEnabled = features.enabled("STOCK_BEST_BEFORE_DATE_TRACKING");
  const locationsEnabled = features.enabled("STOCK_LOCATION_TRACKING");
  const { dueSoonDays, formatAmount } = usePreferences();
  const catalog = useCatalog();
  const command = useCommandBar();
  const [search, setSearch] = useState("");
  const [selection, setFilter] = useState<StockFilter>("all");

  const filter =
    !datesEnabled && (selection === "due" || selection === "expired") ? "all" : selection;

  const [locationId, setLocationId] = useState("");

  const stock = useQuery({ queryKey: queryKeys.stockOverview, queryFn: api.listStock });

  const volatile = useQuery(stockVolatileQuery(dueSoonDays));

  // Products below minimum and out of stock are not in /api/stock; add them as empty rows.
  const rows = useMemo<Row[]>(() => {
    const shortages = new Map(
      (volatile.data?.missing_products ?? []).map((item) => [item.id, item.amount_missing]),
    );

    const out: Row[] = (stock.data ?? []).map((item) => {
      const amountForMinimum = stockMinimumAmount(item);
      const shortage = shortages.get(item.product_id);

      return {
        productId: item.product_id,
        name: item.product.name,
        amount: stockAmount(item),
        minimumAmount: amountForMinimum,
        opened: openedStockAmount(item),
        min:
          shortage === undefined
            ? (item.product.min_stock_amount ?? 0)
            : amountForMinimum + shortage,
        bestBefore: item.best_before_date ?? null,
        locationId: item.product.location_id ?? null,
      };
    });

    const present = new Set(out.map((row) => row.productId));

    for (const missing of volatile.data?.missing_products ?? []) {
      if (present.has(missing.id)) continue;
      const product = catalog.product(missing.id);
      out.push({
        productId: missing.id,
        name: missing.name,
        amount: 0,
        minimumAmount: 0,
        opened: 0,
        min: missing.amount_missing,
        bestBefore: null,
        locationId: product?.location_id ?? null,
      });
    }

    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [stock.data, volatile.data, catalog]);

  const isDue = (row: Row) => {
    const days = daysUntil(row.bestBefore);

    return days !== null && days >= 0 && days <= dueSoonDays;
  };

  const isExpired = (row: Row) => {
    const days = daysUntil(row.bestBefore);

    return days !== null && days < 0;
  };

  const missingIds = new Set((volatile.data?.missing_products ?? []).map((item) => item.id));
  const isLow = (row: Row) => missingIds.has(row.productId);

  const anyOpened =
    features.enabled("STOCK_PRODUCT_OPENED_TRACKING") && rows.some((row) => row.opened > 0);

  const counts = {
    all: rows.length,
    due: rows.filter(isDue).length,
    expired: rows.filter(isExpired).length,
    low: rows.filter(isLow).length,
  };

  const visible = rows.filter((row) => {
    if (filter === "due" && !isDue(row)) return false;

    if (filter === "expired" && !isExpired(row)) return false;

    if (filter === "low" && !isLow(row)) return false;

    if (locationsEnabled && locationId && String(row.locationId) !== locationId) return false;
    const q = search.trim().toLowerCase();

    return !q || row.name.toLowerCase().includes(q);
  });

  const filters: Array<[StockFilter, string]> = [
    ["all", "All"],
    ["due", "Due soon"],
    ["expired", "Expired"],
    ["low", "Below min"],
  ];

  return (
    <>
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
            <Link to="/barcode" className="btn btn-ghost">
              {tr("Barcode")}
            </Link>
            <button type="button" className="btn" onClick={() => command.open("consume")}>
              {tr("Consume")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => command.open("purchase")}
            >
              {tr("Purchase")}
            </button>
          </>
        }
      />

      <div className="toolbar">
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
            !datesEnabled && (id === "due" || id === "expired")
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
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">{tr("All locations")}</option>
              {catalog.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {stock.isLoading ? <LoadingBlock label={tr("Loading stock…")} /> : null}
      {stock.isError ? <ErrorBlock message={stock.error.message} /> : null}

      {stock.isSuccess && visible.length === 0 ? (
        <p className="empty-state">
          {rows.length === 0
            ? tr("Stock is empty. Press Purchase or ⌘K to book what you bought.")
            : tr("No product matches this filter.")}
        </p>
      ) : null}

      {visible.length > 0 ? (
        <div className="panel">
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
                        {locationsEnabled
                          ? (catalog.location(row.locationId)?.name ?? tr("No location"))
                          : null}
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
                            {dueLabel(row.bestBefore, dueSoonDays)}
                          </span>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                    ) : null}
                    <td className="row-actions">
                      <QuickMoves productId={row.productId} name={row.name} amount={row.amount} />
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
