import { z } from "zod";
import { parseJson, type JsonValue, type JsonObject } from "./json";
import { readApiConfig } from "./config";
import type {
  BarcodeProduct,
  Battery,
  Booking,
  Chore,
  CreateProposalPayload,
  CurrentUser,
  NutritionProposalList,
  NutritionProposal,
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
  SystemInfo,
  Task,
  TrackedId,
  UserSettings,
} from "./types";

export type ExternalBarcodeProduct = JsonObject & {
  name?: string | null;
  id?: number | string | null;
  product_id?: number | string | null;
  __barcode?: string | null;
};

export type AuthResult = {
  user_id: number;
  username: string;
  api_key: string;
};

export type PurchaseOptions = {
  best_before_date?: string | null;
  location_id?: number | null;
  price?: number | null;
  shopping_location_id?: number | null;
  purchased_date?: string | null;
  note?: string | null;
};

export type ConsumeOptions = {
  spoiled?: boolean;
  location_id?: number | null;
};

function post<T>(path: string, body?: JsonValue): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export class ApiError extends Error {
  status: number;
  body: JsonValue;

  constructor(status: number, message: string, body: JsonValue) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function resolveUrl(path: string): string {
  const { baseUrl } = readApiConfig();
  const normalized = path.startsWith("/") ? path : `/${path}`;

  if (!baseUrl) {
    return normalized;
  }

  return `${baseUrl.replace(/\/$/, "")}${normalized}`;
}

const errorBodySchema = z.object({
  error_message: z.string().optional().catch(undefined),
  detail: z.string().optional().catch(undefined),
});

function errorMessage(body: JsonValue, fallback: string): string {
  const result = errorBodySchema.safeParse(body);

  return result.success ? (result.data.error_message ?? result.data.detail ?? fallback) : fallback;
}

export async function request<T = void>(path: string, init: RequestInit = {}): Promise<T> {
  const { apiKey } = readApiConfig();
  const headers = new Headers(init.headers);

  if (apiKey) {
    headers.set("GROCY-API-KEY", apiKey);
  }

  if (init.body && !headers.has("Content-Type")) {
    headers.set(
      "Content-Type",
      init.body instanceof Blob ? init.body.type || "application/octet-stream" : "application/json",
    );
  }

  const response = await fetch(resolveUrl(path), {
    ...init,
    headers,
    cache: init.cache ?? "no-store",
  });

  const text = await response.text();
  let body: JsonValue = null;

  if (text) {
    try {
      body = parseJson(text);
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

  const contentType = response.headers.get("content-type") ?? "";

  if (text && !contentType.includes("json") && z.string().safeParse(body).success) {
    throw new ApiError(
      response.status,
      "API returned non-JSON (stale cache or wrong server on this port).",
      body,
    );
  }

  // SAFETY: Each caller selects T from its backend route contract. The response is
  // parsed JSON (or null for an empty response); endpoint fields are trusted here.
  return body as T;
}

export const api = {
  objects: (entity: string) => request<import("./entities").EntityRow[]>(`/api/objects/${entity}`),
  createObject: (entity: string, body: JsonObject) =>
    request<{ created_object_id: string }>(`/api/objects/${entity}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateObject: (entity: string, id: number, body: JsonObject) =>
    request<void>(`/api/objects/${entity}/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteObject: (entity: string, id: number) =>
    request<void>(`/api/objects/${entity}/${id}`, { method: "DELETE" }),
  action: <T = void>(path: string, body?: JsonObject) =>
    request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  rejectProposal: (id: number) =>
    request<NutritionProposal>(`/api/v2/nutrition/proposals/${id}/reject`, {
      method: "POST",
    }),
  restoreRevision: (id: number, revision: number) =>
    request<NutritionRecord>(`/api/v2/products/${id}/nutrition/revisions/${revision}/restore`, {
      method: "POST",
    }),
  listProducts: () => request<ProductListResponse>("/api/objects/products"),

  listLocations: () => request<Location[]>("/api/objects/locations"),

  listQuantityUnits: () => request<QuantityUnit[]>("/api/objects/quantity_units"),

  listStockLog: () => request<StockLogEntry[]>("/api/objects/stock_log"),

  getProductNutrition: (productId: number) =>
    request<NutritionRecord>(`/api/v2/products/${productId}/nutrition`),

  listPendingProposals: () =>
    request<NutritionProposalList>("/api/v2/nutrition/proposals?status=pending"),

  approveProposal: (proposalId: number) =>
    request<NutritionRecord>(`/api/v2/nutrition/proposals/${proposalId}/approve`, {
      method: "POST",
    }),

  createProposal: (payload: CreateProposalPayload) =>
    post<NutritionProposal>("/api/v2/nutrition/proposals", payload),

  listNutritionRevisions: (productId: number) =>
    request<NutritionRevisionList>(`/api/v2/products/${productId}/nutrition/revisions`),

  listStock: () => request<StockOverviewItem[]>("/api/stock"),

  getStockVolatile: (dueSoonDays = 5) =>
    request<StockVolatile>(`/api/stock/volatile?due_soon_days=${dueSoonDays}`),

  getStockProduct: (productId: number) =>
    request<StockProductDetails>(`/api/stock/products/${productId}`),

  purchaseStock: (productId: number, amount: number, options: PurchaseOptions = {}) =>
    post<Booking[]>(`/api/stock/products/${productId}/add`, { amount, ...options }),

  consumeStock: (productId: number, amount: number, options: ConsumeOptions = {}) =>
    post<Booking[]>(`/api/stock/products/${productId}/consume`, { amount, ...options }),

  openStock: (productId: number, amount: number) =>
    post<Booking[]>(`/api/stock/products/${productId}/open`, { amount }),

  undoTransaction: (transactionId: string) =>
    post<void>(`/api/stock/transactions/${transactionId}/undo`),

  getShoppingList: (listId = 1) => request<ShoppingList>(`/api/v2/shopping-lists/${listId}`),

  addShoppingProduct: (
    productId: number,
    amount: number,
    note?: string | null,
    listId = 1,
    quId?: number | null,
  ) =>
    post<void>("/api/v2/shopping-lists/items", {
      product_id: productId,
      amount,
      shopping_list_id: listId,
      qu_id: quId ?? null,
      note: note || null,
    }),

  purchaseShoppingItem: (listId: number, itemId: number) =>
    post<{ purchased: boolean; bookings: Booking[] }>(
      `/api/v2/shopping-lists/${listId}/items/${itemId}/purchase`,
    ),

  removeShoppingProduct: (productId: number, amount: number, listId = 1) =>
    post<void>("/api/stock/shoppinglist/remove-product", {
      product_id: productId,
      product_amount: amount,
      list_id: listId,
    }),

  setShoppingItemDone: (itemId: number, done: boolean) =>
    request<void>(`/api/objects/shopping_list/${itemId}`, {
      method: "PUT",
      body: JSON.stringify({ done: done ? 1 : 0 }),
    }),

  clearShoppingList: (listId = 1, doneOnly = false) =>
    post<void>("/api/stock/shoppinglist/clear", { list_id: listId, done_only: doneOnly }),

  addMissingToShoppingList: (listId = 1) =>
    post<void>("/api/stock/shoppinglist/add-missing-products", { list_id: listId }),

  listRecipes: () => request<Recipe[]>("/api/objects/recipes"),

  // The Grocy list route returns recipe rows, so ask the v2 route per recipe.
  listRecipeFulfillment: async () => {
    const recipes = await request<Recipe[]>("/api/objects/recipes");

    return Promise.all(
      recipes.map((recipe) =>
        request<RecipeFulfillment>(`/api/v2/recipes/${recipe.id}/fulfillment`),
      ),
    );
  },

  getRecipeFulfillment: (recipeId: number) =>
    request<RecipeFulfillment>(`/api/v2/recipes/${recipeId}/fulfillment`),

  consumeRecipe: (recipeId: number) => post<void>(`/api/recipes/${recipeId}/consume`),

  addRecipeMissingToShopping: (recipeId: number) =>
    request<void>(`/api/recipes/${recipeId}/add-not-fulfilled-products-to-shoppinglist`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  // /api/chores returns the Grocy chores_current view; expose a plain name.
  listChores: () =>
    request<Chore[]>("/api/chores").then((rows) =>
      rows.map((row) => ({ ...row, name: row.chore_name ?? row.name ?? `Chore ${row.id}` })),
    ),

  executeChore: (choreId: number) => post<TrackedId>(`/api/chores/${choreId}/execute`),

  undoChoreExecution: (executionId: number) =>
    post<void>(`/api/chores/executions/${executionId}/undo`),

  listTasks: (includeDone = false) =>
    request<Task[]>(`/api/tasks?include_done=${includeDone ? "true" : "false"}`),

  completeTask: (taskId: number) => post<void>(`/api/tasks/${taskId}/complete`),

  undoTask: (taskId: number) => post<void>(`/api/tasks/${taskId}/undo`),

  // /api/batteries nests the battery record; lift its fields beside the charge state.
  listBatteries: () =>
    request<Battery[]>("/api/batteries").then((rows) =>
      rows.map((row) => ({
        ...row,
        name: row.battery?.name ?? row.name ?? `Battery ${row.id}`,
        description: row.battery?.description ?? row.description,
        used_in: row.battery?.used_in ?? row.used_in,
        charge_interval_days: row.battery?.charge_interval_days ?? row.charge_interval_days,
      })),
    ),

  getSystemInfo: () => request<SystemInfo>("/api/system/info"),
  setupStatus: () => request<{ needs_setup: boolean }>("/api/v2/setup"),
  runSetup: (body: { setup_token: string; username: string; password: string }) =>
    request<AuthResult>("/api/v2/setup", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  login: (body: { username: string; password: string }) =>
    request<AuthResult>("/api/v2/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  logout: () => request<void>("/api/v2/logout", { method: "POST" }),

  getCurrentUser: () => request<CurrentUser[]>("/api/user").then((rows) => rows[0]),

  getUserSettings: () => request<UserSettings>("/api/user/settings"),

  putUserSetting: (key: string, value: UserSettings[string]) =>
    request<void>(`/api/user/settings/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),

  putUserSettings: (body: JsonObject) =>
    request<UserSettings>("/api/v2/user/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  getProductByBarcode: (barcode: string) =>
    request<Pick<BarcodeProduct, "product">>(
      `/api/stock/products/by-barcode/${encodeURIComponent(barcode)}`,
    ).then(({ product }): BarcodeProduct => ({ product, product_id: product.id })),

  externalBarcodeLookup: (barcode: string, add = false) =>
    request<ExternalBarcodeProduct | null>(
      `/api/stock/barcodes/external-lookup/${encodeURIComponent(barcode)}${add ? "?add=true" : ""}`,
    ),

  stockActionByBarcode: (
    barcode: string,
    action: "add" | "consume" | "open" | "transfer" | "inventory",
    body: JsonObject,
  ) =>
    request<void>(`/api/stock/products/by-barcode/${encodeURIComponent(barcode)}/${action}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  mergeProducts: (keepId: number, removeId: number) =>
    request<void>(`/api/stock/products/${keepId}/merge/${removeId}`, { method: "POST" }),

  addOverdueToShoppingList: (listId = 1) =>
    request<void>("/api/stock/shoppinglist/add-overdue-products", {
      method: "POST",
      body: JSON.stringify({ list_id: listId }),
    }),

  addExpiredToShoppingList: (listId = 1) =>
    request<void>("/api/stock/shoppinglist/add-expired-products", {
      method: "POST",
      body: JSON.stringify({ list_id: listId }),
    }),
  chargeBattery: (batteryId: number) => post<TrackedId>(`/api/batteries/${batteryId}/charge`),

  undoBatteryCharge: (chargeCycleId: number) =>
    post<void>(`/api/batteries/charge-cycles/${chargeCycleId}/undo`),
};

export const queryKeys = {
  products: ["products"] as const,
  locations: ["locations"] as const,
  quantityUnits: ["quantity-units"] as const,
  stockLog: ["stock", "log"] as const,
  nutrition: (id: number) => ["nutrition", id] as const,
  proposalsPending: ["proposals", "pending"] as const,
  revisions: (id: number) => ["revisions", id] as const,
  stock: (id: number) => ["stock", id] as const,
  stockOverview: ["stock", "overview"] as const,
  stockVolatile: ["stock", "volatile"] as const,
  stockJournal: (limit: number) => ["stock", "journal", limit] as const,
  shopping: (id = 1) => ["shopping", id] as const,
  recipes: ["recipes"] as const,
  recipesFulfillment: ["recipe-fulfillment"] as const,
  recipeFulfillment: (id: number) => ["recipe-fulfillment", id] as const,
  chores: ["chores"] as const,
  tasks: ["tasks"] as const,
  batteries: ["batteries"] as const,
  systemInfo: ["system", "info"] as const,
  setup: ["setup"] as const,
  userSettings: ["user", "settings"] as const,
  currentUser: ["user", "current"] as const,
  objects: (entity: string) => ["objects", entity] as const,
  calendarAgenda: ["calendar", "agenda"] as const,
};

export function filePath(group: string, name: string): string {
  if (group === "equipment" || group === "nutrition")
    return `/api/v2/files/${encodeURIComponent(group)}/${encodeURIComponent(name)}`;

  const encoded = btoa(
    Array.from(new TextEncoder().encode(name), (byte) => String.fromCharCode(byte)).join(""),
  );

  return `/api/files/${encodeURIComponent(group)}/${encodeURIComponent(encoded)}`;
}

export async function downloadFile(
  group: string,
  name: string,
  legacyGroup?: string,
): Promise<void> {
  const { apiKey } = readApiConfig();
  const headers = { "GROCY-API-KEY": apiKey };
  let response = await fetch(resolveUrl(filePath(group, name)), { headers });

  if (response.status === 404 && legacyGroup)
    response = await fetch(resolveUrl(filePath(legacyGroup, name)), { headers });

  if (!response.ok) throw new ApiError(response.status, "Could not download the file.", null);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
