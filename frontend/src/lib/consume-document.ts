import type { ConsumeOptions } from "./consume";
import { initialStockOptions, useStockDocument, type StockDocument } from "./stock-document";

const parameters = [
  "product",
  "product-name",
  "embedded",
  "locationId",
  "stockId",
  "flow",
  "barcode",
] as const;

export function initialConsumeOptions(search: string): ConsumeOptions {
  return initialStockOptions<ConsumeOptions>(search, parameters);
}

export type ConsumeDocument = StockDocument<ConsumeOptions>;

export function useConsumeDocument(options: ConsumeOptions): ConsumeDocument {
  return useStockDocument("consume", options, parameters);
}
