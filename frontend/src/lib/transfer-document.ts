import type { TransferOptions } from "./transfer";
import { initialStockOptions, useStockDocument, type StockDocument } from "./stock-document";

const parameters = [
  "product",
  "product-name",
  "locationId",
  "stockId",
  "embedded",
  "flow",
  "barcode",
] as const;

export function initialTransferOptions(search: string): TransferOptions {
  return initialStockOptions<TransferOptions>(search, parameters);
}

export type TransferDocument = StockDocument<TransferOptions>;

export function useTransferDocument(options: TransferOptions): TransferDocument {
  return useStockDocument("transfer", options, parameters);
}
