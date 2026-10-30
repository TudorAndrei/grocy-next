type FixtureStock = {
  product_id: number;
  product: { id?: number; name: string; min_stock_amount?: number; location_id?: number };
  amount: number;
  amount_opened?: number;
  amount_aggregated?: number;
  amount_opened_aggregated?: number;
  is_aggregated_amount?: boolean;
  best_before_date?: string;
};

/** Read-model fixture for tests which book from an overview row. */
export function overviewFixture(stock: FixtureStock[], location = "Shelf") {
  return {
    rows: stock.map((row) => ({
      product_id: row.product_id,
      product_name: row.product.name,
      amount: row.amount,
      amount_opened: row.amount_opened ?? 0,
      amount_aggregated: row.amount_aggregated ?? row.amount,
      amount_opened_aggregated: row.amount_opened_aggregated ?? row.amount_opened ?? 0,
      is_aggregated_amount: row.is_aggregated_amount ? 1 : 0,
      min_stock_amount: row.product.min_stock_amount ?? 0,
      product_missing: 0,
      best_before_date: row.best_before_date ?? "2888-12-31",
      due_type: 1,
      product_group_name: null,
      product_default_location_name: location,
      location_names: [location],
    })),
    locations: [{ id: 2, name: location }],
    product_groups: [],
  };
}
