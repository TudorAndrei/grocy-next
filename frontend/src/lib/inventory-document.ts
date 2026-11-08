import type { InventoryOptions } from "./inventory";
import { initialStockOptions, useStockDocument, type StockDocument } from "./stock-document";

const parameters = ["product", "product-name", "embedded", "flow", "barcode"] as const;

export function initialInventoryOptions(search: string): InventoryOptions {
  return initialStockOptions<InventoryOptions>(search, parameters);
}

export type InventoryDocument = StockDocument<InventoryOptions>;

export function useInventoryDocument(options: InventoryOptions): InventoryDocument {
  return useStockDocument("inventory", options, parameters);
}
