import { z } from "zod";
import { request } from "./api";
import { preferenceEnabled } from "./preferences";

const product = z.object({
  product: z.object({
    hide_on_stock_overview: z.union([z.number(), z.string(), z.boolean()]).nullable().optional(),
  }),
});

const stock = z.array(product.extend({ value: z.number() }));

const volatile = z.object({
  due_products: z.array(product),
  overdue_products: z.array(product),
  expired_products: z.array(product),
  missing_products: z.array(product),
});

const visible = (row: z.infer<typeof product>) =>
  !preferenceEnabled(row.product.hide_on_stock_overview);

export async function getStockStatistics(signal?: AbortSignal) {
  const rows = stock.parse(await request("/api/stock", { signal }));

  return {
    products: rows.filter(visible).length,
    // The original summary includes hidden products in the value, but not the count.
    value: rows.reduce((sum, row) => sum + row.value, 0),
  };
}

export async function getVolatileStatistics(days: number, signal?: AbortSignal) {
  const rows = volatile.parse(
    await request(`/api/stock/volatile?due_soon_days=${days}`, { signal }),
  );

  return {
    due: rows.due_products.filter(visible).length,
    overdue: rows.overdue_products.filter(visible).length,
    expired: rows.expired_products.filter(visible).length,
    low: rows.missing_products.filter(visible).length,
  };
}
