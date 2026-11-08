import type { PurchaseOptions } from "./purchase";
import { initialStockOptions, useStockDocument, type StockDocument } from "./stock-document";

const parameters = [
  "product",
  "product-name",
  "embedded",
  "flow",
  "barcode",
  "amount",
  "quId",
  "listitemid",
] as const;

export function initialPurchaseOptions(search: string): PurchaseOptions {
  return initialStockOptions<PurchaseOptions>(search, parameters);
}

export type PurchaseDocument = StockDocument<PurchaseOptions>;

export function usePurchaseDocument(options: PurchaseOptions): PurchaseDocument {
  return useStockDocument("purchase", options, parameters);
}
