export type ProductSummary = {
  id: number;
  name: string;
  barcode?: string | null;
  description?: string | null;
  barcodes?: string[];
  min_stock_amount?: number;
  location_id?: number | null;
  qu_id_stock?: number | null;
  qu_id_purchase?: number | null;
  default_best_before_days?: number | null;
  product_group_id?: number | null;
};

export type Location = {
  id: number;
  name: string;
  description?: string | null;
  is_freezer?: number;
};

export type QuantityUnit = {
  id: number;
  name: string;
  name_plural?: string | null;
  description?: string | null;
};

export type Booking = {
  id: number;
  product_id: number;
  amount: number;
  transaction_type: string;
  transaction_id: string;
};

export type StockLogEntry = {
  id: number;
  product_id: number;
  amount: number;
  best_before_date?: string | null;
  transaction_type: string;
  transaction_id: string;
  undone: number;
  spoiled?: number;
  location_id?: number | null;
  user_id?: number | null;
  note?: string | null;
  row_created_timestamp: string;
};

export type TrackedId = { id: number };

export type ProductListResponse = ProductSummary[];

export type Nutrients = {
  energy_kj?: number | null;
  energy_kcal?: number | null;
  protein_g?: number | null;
  carbohydrates_g?: number | null;
  sugars_g?: number | null;
  fat_g?: number | null;
  saturated_fat_g?: number | null;
  fiber_g?: number | null;
  salt_g?: number | null;
};

export type NutritionRecord = {
  product_id: number;
  revision: number;
  barcode?: string | null;
  basis_quantity: number | string;
  basis_unit: string;
  nutrients: Nutrients;
  source?: {
    type: string;
    barcode?: string | null;
    note?: string | null;
    photo_path?: string;
    external_url?: string;
  } | null;
  updated_by?: number | null;
};

export type NutritionProposal = {
  id: number;
  product_id: number;
  expected_revision?: number | null;
  barcode?: string | null;
  status: string;
  conflict_reason?: string | null;
  payload: CreateProposalPayload;
  created_by?: number | null;
};

export type NutritionProposalList = NutritionProposal[];

export type NutritionRevision = {
  id: number;
  product_id: number;
  revision: number;
  barcode?: string | null;
  basis_quantity: number | string;
  basis_unit: string;
  nutrients: Nutrients;
  origin: string;
  review_status: string;
  change_summary?: string | null;
  actor_id?: number | null;
};

export type NutritionRevisionList = NutritionRevision[];

export type CreateProposalPayload = {
  product_id: number;
  expected_revision?: number | null;
  barcode?: string | null;
  basis: { quantity: number; unit: string };
  nutrients: Nutrients;
  source?: {
    type?: string;
    barcode?: string | null;
    note?: string | null;
    photo_path?: string;
    external_url?: string;
  };
  note?: string | null;
  origin?: string;
};

export type StockProductDetails = ProductSummary & {
  stock_amount?: number;
  stock_amount_opened?: number;
  location_id?: number;
};

export type SystemInfo = {
  grocy_version: { Version: string; ReleaseDate: string };
  php_version: string;
  sqlite_version: string;
  db_version: number;
  os: string;
  client: string;
};

export type UserSettings = Record<string, string | number | boolean | null>;

export type CurrentUser = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
};

export type StockLogRow = {
  id: number;
  product_id: number;
  amount: number;
  transaction_type: string;
  undone: number;
  row_created_timestamp?: string;
};

export type BarcodeProduct = {
  product_id: number;
  product: ProductSummary;
};

export type StockOverviewItem = {
  product_id: number;
  amount: number;
  amount_aggregated: number;
  amount_opened: number;
  amount_opened_aggregated: number;
  best_before_date?: string | null;
  is_aggregated_amount: boolean;
  product: ProductSummary;
};

export type StockVolatile = {
  due_products: StockOverviewItem[];
  overdue_products: StockOverviewItem[];
  expired_products: StockOverviewItem[];
  missing_products: Array<{
    id: number;
    name: string;
    amount_missing: number;
    is_partly_in_stock: number;
  }>;
};

export type ShoppingListItem = {
  id: number;
  product_id: number | null;
  amount: number;
  note?: string | null;
  done: boolean;
  qu_id?: number | null;
};

export type ShoppingList = {
  id: number;
  name: string;
  items: ShoppingListItem[];
};

export type RecipePosition = {
  id: number;
  product_id: number;
  amount: number;
  qu_id: number;
  note?: string | null;
};

export type Recipe = {
  id: number;
  name: string;
  description?: string | null;
  base_servings: number;
  desired_servings: number;
  /** Absent on /api/objects/recipes rows. */
  positions?: RecipePosition[];
};

export type RecipeFulfillment = {
  recipe_id: number;
  need_fulfilled: boolean;
  need_fulfilled_with_shopping_list: boolean;
  missing_products_count: number;
  positions: Array<{
    product_id: number;
    amount_needed: number;
    amount_available: number;
    fulfilled: boolean;
  }>;
};

export type Chore = {
  id: number;
  name: string;
  chore_name?: string;
  description?: string | null;
  period_type?: string;
  period_days?: number | null;
  last_tracked_time?: string | null;
  next_estimated_execution_time?: string | null;
};

export type Task = {
  id: number;
  name: string;
  description?: string | null;
  done?: number | boolean;
  due_date?: string | null;
};

export type Battery = {
  id: number;
  name: string;
  battery?: {
    id?: number;
    name: string;
    description?: string | null;
    used_in?: string | null;
    charge_interval_days?: number | null;
  };
  description?: string | null;
  used_in?: string | null;
  charge_interval_days?: number | null;
  last_tracked_time?: string | null;
  next_estimated_charge_time?: string | null;
};
