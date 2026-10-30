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
      value: 0,
      on_shopping_list: 0,
      product_no_own_stock: 0,
      product_calories: null,
      calories: null,
      last_purchased: null,
      last_price: null,
      average_price: null,
      qu_stock_name: "Piece",
      qu_price_name: "Piece",
      product_qu_factor_price_to_stock: 1,
      product_barcodes: null,
      product_description: "",
      parent_product_id: null,
      parent_product_name: null,
      product_picture_file_name: null,
      default_store_name: null,
      unit_label: row.amount === 1 ? "Piece" : "Pieces",
      unit_label_aggregated: (row.amount_aggregated ?? row.amount) === 1 ? "Piece" : "Pieces",
      number_text: {
        amount: String(row.amount),
        amount_opened: String(row.amount_opened ?? 0),
        amount_aggregated: String(row.amount_aggregated ?? row.amount),
        amount_opened_aggregated: String(row.amount_opened_aggregated ?? row.amount_opened ?? 0),
        min_stock_amount: String(row.product.min_stock_amount ?? 0),
        value: "0",
      },
      product_values: {},
      best_before_date: row.best_before_date ?? "2888-12-31",
      due_type: 1,
      product_group_name: null,
      product_default_location_name: location,
      location_names: [location],
    })),
    locations: [{ id: 2, name: location }],
    product_groups: [],
    show_shopping_icon: false,
  };
}
