export type ProductSummary = {
  id: number;
  name: string;
  barcode?: string | null;
  description?: string | null;
  barcodes?: string[];
};

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
  };
  note?: string | null;
  origin?: string;
};

export type StockProductDetails = ProductSummary & {
  stock_amount?: number;
  stock_amount_opened?: number;
  location_id?: number;
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
  positions: RecipePosition[];
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
