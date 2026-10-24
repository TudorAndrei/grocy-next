import { readApiConfig } from "./config";
import type {
  Battery,
  Booking,
  CurrentUser,
  Chore,
  CreateProposalPayload,
  NutritionProposalList,
  NutritionRecord,
  NutritionRevisionList,
  ProductListResponse,
  Location,
  QuantityUnit,
  Recipe,
  RecipeFulfillment,
  ShoppingList,
  StockLogEntry,
  StockOverviewItem,
  StockProductDetails,
  StockVolatile,
  Task,
  TrackedId,
} from "./types";

export type PurchaseOptions = {
  best_before_date?: string | null;
  location_id?: number | null;
  price?: number | null;
};

export type ConsumeOptions = {
  spoiled?: boolean;
  location_id?: number | null;
};

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function resolveUrl(path: string): string {
  const { baseUrl } = readApiConfig();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!baseUrl) {
    return normalized;
  }
  return `${baseUrl.replace(/\/$/, "")}${normalized}`;
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null) {
    if (
      "error_message" in body &&
      typeof (body as { error_message: unknown }).error_message === "string"
    ) {
      return (body as { error_message: string }).error_message;
    }
    if ("detail" in body && typeof (body as { detail: unknown }).detail === "string") {
      return (body as { detail: string }).detail;
    }
  }
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { apiKey } = readApiConfig();
  const headers = new Headers(init.headers);
  if (apiKey) {
    headers.set("GROCY-API-KEY", apiKey);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(resolveUrl(path), { ...init, headers });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const fallback =
      response.status === 401
        ? "Unauthorized — set GROCY-API-KEY to dev-key under Settings."
        : response.statusText || "Request failed";
    throw new ApiError(response.status, errorMessage(body, fallback), body);
  }
  return body as T;
}

export const api = {
  listProducts: () => request<ProductListResponse>("/api/objects/products"),

  listLocations: () => request<Location[]>("/api/objects/locations"),

  listQuantityUnits: () => request<QuantityUnit[]>("/api/objects/quantity_units"),

  getCurrentUser: () => request<CurrentUser>("/api/user"),

  listStockLog: () => request<StockLogEntry[]>("/api/objects/stock_log"),

  getProductNutrition: (productId: number) =>
    request<NutritionRecord>(`/api/v2/products/${productId}/nutrition`),

  listPendingProposals: () =>
    request<NutritionProposalList>("/api/v2/nutrition/proposals?status=pending"),

  approveProposal: (proposalId: number) =>
    post<NutritionRecord>(`/api/v2/nutrition/proposals/${proposalId}/approve`),

  rejectProposal: (proposalId: number) =>
    post<unknown>(`/api/v2/nutrition/proposals/${proposalId}/reject`),

  createProposal: (payload: CreateProposalPayload) =>
    post<unknown>("/api/v2/nutrition/proposals", payload),

  listNutritionRevisions: (productId: number) =>
    request<NutritionRevisionList>(`/api/v2/products/${productId}/nutrition/revisions`),

  listStock: () => request<StockOverviewItem[]>("/api/stock"),

  getStockVolatile: (dueSoonDays = 5) =>
    request<StockVolatile>(`/api/stock/volatile?due_soon_days=${dueSoonDays}`),

  getStockProduct: (productId: number) =>
    request<StockProductDetails>(`/api/stock/products/${productId}`),

  purchaseStock: (productId: number, amount: number, options: PurchaseOptions = {}) =>
    post<Booking>(`/api/stock/products/${productId}/add`, { amount, ...options }),

  consumeStock: (productId: number, amount: number, options: ConsumeOptions = {}) =>
    post<Booking>(`/api/stock/products/${productId}/consume`, { amount, ...options }),

  openStock: (productId: number, amount: number) =>
    post<Booking>(`/api/stock/products/${productId}/open`, { amount }),

  undoTransaction: (transactionId: string) =>
    post<unknown>(`/api/stock/transactions/${transactionId}/undo`),

  getShoppingList: (listId = 1) => request<ShoppingList>(`/api/v2/shopping-lists/${listId}`),

  addShoppingProduct: (productId: number, amount: number, note?: string | null, listId = 1) =>
    post<unknown>("/api/stock/shoppinglist/add-product", {
      product_id: productId,
      product_amount: amount,
      list_id: listId,
      note: note || null,
    }),

  removeShoppingProduct: (productId: number, amount: number, listId = 1) =>
    post<unknown>("/api/stock/shoppinglist/remove-product", {
      product_id: productId,
      product_amount: amount,
      list_id: listId,
    }),

  setShoppingItemDone: (itemId: number, done: boolean) =>
    request<unknown>(`/api/objects/shopping_list/${itemId}`, {
      method: "PUT",
      body: JSON.stringify({ done: done ? 1 : 0 }),
    }),

  clearShoppingList: (listId = 1, doneOnly = false) =>
    post<unknown>("/api/stock/shoppinglist/clear", { list_id: listId, done_only: doneOnly }),

  addMissingToShoppingList: (listId = 1) =>
    post<unknown>("/api/stock/shoppinglist/add-missing-products", { list_id: listId }),

  listRecipes: () => request<Recipe[]>("/api/objects/recipes"),

  listRecipeFulfillment: () => request<RecipeFulfillment[]>("/api/recipes/fulfillment"),

  getRecipeFulfillment: (recipeId: number) =>
    request<RecipeFulfillment>(`/api/recipes/${recipeId}/fulfillment`),

  consumeRecipe: (recipeId: number) => post<unknown>(`/api/recipes/${recipeId}/consume`),

  addRecipeMissingToShopping: (recipeId: number) =>
    post<unknown>(`/api/recipes/${recipeId}/add-not-fulfilled-products-to-shoppinglist`),

  listChores: () => request<Chore[]>("/api/chores"),

  executeChore: (choreId: number) => post<TrackedId>(`/api/chores/${choreId}/execute`),

  undoChoreExecution: (executionId: number) =>
    post<unknown>(`/api/chores/executions/${executionId}/undo`),

  listTasks: (includeDone = false) =>
    request<Task[]>(`/api/tasks?include_done=${includeDone ? "true" : "false"}`),

  completeTask: (taskId: number) => post<unknown>(`/api/tasks/${taskId}/complete`),

  undoTask: (taskId: number) => post<unknown>(`/api/tasks/${taskId}/undo`),

  listBatteries: () => request<Battery[]>("/api/batteries"),

  chargeBattery: (batteryId: number) => post<TrackedId>(`/api/batteries/${batteryId}/charge`),

  undoBatteryCharge: (chargeCycleId: number) =>
    post<unknown>(`/api/batteries/charge-cycles/${chargeCycleId}/undo`),
};

export const queryKeys = {
  products: ["products"] as const,
  locations: ["locations"] as const,
  quantityUnits: ["quantity-units"] as const,
  stockLog: ["stock", "log"] as const,
  currentUser: ["user"] as const,
  nutrition: (id: number) => ["nutrition", id] as const,
  proposalsPending: ["proposals", "pending"] as const,
  revisions: (id: number) => ["revisions", id] as const,
  stock: (id: number) => ["stock", id] as const,
  stockOverview: ["stock", "overview"] as const,
  stockVolatile: ["stock", "volatile"] as const,
  shopping: (id = 1) => ["shopping", id] as const,
  recipes: ["recipes"] as const,
  recipesFulfillment: ["recipe-fulfillment"] as const,
  recipeFulfillment: (id: number) => ["recipe-fulfillment", id] as const,
  chores: ["chores"] as const,
  tasks: ["tasks"] as const,
  batteries: ["batteries"] as const,
};
