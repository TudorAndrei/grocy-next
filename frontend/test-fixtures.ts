export const server = "http://127.0.0.1:8000";
export const products = [
  {
    id: 1,
    name: "Oats",
    qu_id_stock: 1,
    qu_id_purchase: 1,
    location_id: 1,
    min_stock_amount: 0,
    default_best_before_days: 7,
  },
  {
    id: 2,
    name: "Whole Milk",
    qu_id_stock: 2,
    qu_id_purchase: 2,
    location_id: 2,
    min_stock_amount: 0,
  },
];
export const units = [
  { id: 1, name: "packs" },
  { id: 2, name: "litres" },
];
export const network = {
  [`GET ${server}/api/system/info`]: {
    body: { grocy_version: { Version: "4.5.0" } },
  },
  [`GET ${server}/api/v2/stock/overview`]: {
    body: {
      rows: [
        {
          product_id: 1,
          product_name: "Oats",
          amount: 3,
          unit_label: "packs",
          location_names: [],
          best_before_date: "2999-12-31",
        },
      ],
    },
  },
  [`GET ${server}/api/objects/products`]: { body: products },
  [`GET ${server}/api/objects/locations`]: {
    body: [
      { id: 1, name: "Pantry" },
      { id: 2, name: "Fridge" },
    ],
  },
  [`GET ${server}/api/objects/product_groups`]: { body: [] },
  [`GET ${server}/api/objects/quantity_units`]: { body: units },
  [`GET ${server}/api/stock/products/*/entries`]: { body: [] },
  [`GET ${server}/api/v2/nutrition/proposals`]: { body: [] },
  [`GET ${server}/api/v2/products/*/nutrition/revisions`]: { body: [] },
};
