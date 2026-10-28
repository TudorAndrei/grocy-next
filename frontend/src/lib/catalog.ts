import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, queryKeys } from "./api";
import { formatAmount, unitLabel } from "./format";
import type { Location, ProductSummary, QuantityUnit, StockOverviewItem } from "./types";
import { preferenceEnabled, usePreferences } from "./preferences";
import { useI18n } from "./i18n";

export function stockAmount(stock: StockOverviewItem): number {
  return stock.is_aggregated_amount ? stock.amount_aggregated : stock.amount;
}

export function openedStockAmount(stock: StockOverviewItem): number {
  return stock.is_aggregated_amount ? stock.amount_opened_aggregated : stock.amount_opened;
}

export function stockMinimumAmount(stock: StockOverviewItem): number {
  return (
    stockAmount(stock) -
    (preferenceEnabled(stock.product.treat_opened_as_out_of_stock) ? openedStockAmount(stock) : 0)
  );
}

const MEASURED_UNITS = new Set([
  "gram",
  "kilogram",
  "milligram",
  "milliliter",
  "millilitre",
  "liter",
  "litre",
]);

export type Catalog = {
  products: ProductSummary[];
  product: (id: number) => ProductSummary | undefined;
  productName: (id: number) => string;
  location: (id: number | null | undefined) => Location | undefined;
  locations: Location[];
  unit: (id: number | null | undefined) => QuantityUnit | undefined;
  /** "500 g", "2 pcs" — amount in the product's stock unit. */
  amountText: (productId: number, amount: number) => string;
  stockUnitText: (productId: number, amount: number) => string;
  /** True when the stock unit is a count (pieces), so "+1" means one item. */
  countsItems: (productId: number) => boolean;
};

/** Products, locations and quantity units, joined for display. */
export function useCatalog(enabled = true): Catalog {
  const { t, pluralIndex } = useI18n();
  const { amountPrecision } = usePreferences();
  const products = useQuery({ queryKey: queryKeys.products, queryFn: api.listProducts, enabled });

  const locations = useQuery({
    queryKey: queryKeys.locations,
    queryFn: api.listLocations,
    enabled,
  });

  const units = useQuery({
    queryKey: queryKeys.quantityUnits,
    queryFn: api.listQuantityUnits,
    enabled,
  });

  return useMemo(() => {
    const productMap = new Map((products.data ?? []).map((p) => [p.id, p]));
    const locationMap = new Map((locations.data ?? []).map((l) => [l.id, l]));
    const unitMap = new Map((units.data ?? []).map((u) => [u.id, u]));

    const stockUnitText = (productId: number, amount: number) =>
      unitLabel(unitMap.get(productMap.get(productId)?.qu_id_stock ?? -1), amount, pluralIndex);

    return {
      products: products.data ?? [],
      product: (id) => productMap.get(id),
      productName: (id) => productMap.get(id)?.name ?? t("Product #%s", id),
      location: (id) => (id == null ? undefined : locationMap.get(id)),
      locations: locations.data ?? [],
      unit: (id) => (id == null ? undefined : unitMap.get(id)),
      stockUnitText,
      countsItems: (productId) => {
        const unit = unitMap.get(productMap.get(productId)?.qu_id_stock ?? -1);

        return !unit || !MEASURED_UNITS.has(unit.name.toLowerCase());
      },
      amountText: (productId, amount) =>
        `${formatAmount(amount, amountPrecision)} ${stockUnitText(productId, amount)}`.trim(),
    };
  }, [products.data, locations.data, units.data, amountPrecision, t, pluralIndex]);
}

/** Refresh everything a stock movement can change. */
export function useInvalidateStock() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["stock"] }),
      queryClient.invalidateQueries({ queryKey: ["recipe-fulfillment"] }),
      queryClient.invalidateQueries({ queryKey: ["shopping"] }),
    ]);
  };
}
