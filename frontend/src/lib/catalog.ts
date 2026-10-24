import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, queryKeys } from "./api";
import { formatAmount, unitLabel } from "./format";
import type { Location, ProductSummary, QuantityUnit } from "./types";

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
export function useCatalog(): Catalog {
  const products = useQuery({ queryKey: queryKeys.products, queryFn: api.listProducts });
  const locations = useQuery({ queryKey: queryKeys.locations, queryFn: api.listLocations });
  const units = useQuery({ queryKey: queryKeys.quantityUnits, queryFn: api.listQuantityUnits });

  return useMemo(() => {
    const productMap = new Map((products.data ?? []).map((p) => [p.id, p]));
    const locationMap = new Map((locations.data ?? []).map((l) => [l.id, l]));
    const unitMap = new Map((units.data ?? []).map((u) => [u.id, u]));
    const stockUnitText = (productId: number, amount: number) =>
      unitLabel(unitMap.get(productMap.get(productId)?.qu_id_stock ?? -1), amount);
    return {
      products: products.data ?? [],
      product: (id) => productMap.get(id),
      productName: (id) => productMap.get(id)?.name ?? `Product #${id}`,
      location: (id) => (id == null ? undefined : locationMap.get(id)),
      locations: locations.data ?? [],
      unit: (id) => (id == null ? undefined : unitMap.get(id)),
      stockUnitText,
      countsItems: (productId) => {
        const unit = unitMap.get(productMap.get(productId)?.qu_id_stock ?? -1);
        return !unit || !MEASURED_UNITS.has(unit.name.toLowerCase());
      },
      amountText: (productId, amount) =>
        `${formatAmount(amount)} ${stockUnitText(productId, amount)}`.trim(),
    };
  }, [products.data, locations.data, units.data]);
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
