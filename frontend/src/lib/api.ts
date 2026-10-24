import { readApiConfig } from "./config";
import type {
  BarcodeProduct,
  Battery,
  Chore,
  CreateProposalPayload,
  CurrentUser,
  NutritionProposalList,
  NutritionRecord,
  NutritionRevisionList,
  ProductListResponse,
  Recipe,
  RecipeFulfillment,
  ShoppingList,
  StockOverviewItem,
  StockProductDetails,
  StockVolatile,
  SystemInfo,
  Task,
  UserSettings,
} from "./types";

export type AuthResult = {
  user_id: number;
  username: string;
  api_key: string;
};

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
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

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null) {
    if (
      "error_message" in body &&
      typeof (body as { error_message: unknown }).error_message === "string"
    ) {
      return (body as { error_message: string }).error_message;
    }
    if (
      "detail" in body &&
      typeof (body as { detail: unknown }).detail === "string"
    ) {
      return (body as { detail: string }).detail;
    }
  }
  return fallback;
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const { apiKey } = readApiConfig();
  const headers = new Headers(init.headers);
  if (apiKey) {
    headers.set("GROCY-API-KEY", apiKey);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set(
      "Content-Type",
      init.body instanceof Blob
        ? init.body.type || "application/octet-stream"
        : "application/json",
    );
  }
  const response = await fetch(resolveUrl(path), {
    ...init,
    headers,
    cache: init.cache ?? "no-store",
  });
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
  const contentType = response.headers.get("content-type") ?? "";
  if (text && !contentType.includes("json") && typeof body === "string") {
    throw new ApiError(
      response.status,
      "API returned non-JSON (stale cache or wrong server on this port).",
      body,
    );
  }
  return body as T;
}

export const api = {
  objects: (entity: string) =>
    request<import("./entities").EntityRow[]>(`/api/objects/${entity}`),
  createObject: (entity: string, body: Record<string, unknown>) =>
    request<{ created_object_id: string }>(`/api/objects/${entity}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateObject: (entity: string, id: number, body: Record<string, unknown>) =>
    request<void>(`/api/objects/${entity}/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteObject: (entity: string, id: number) =>
    request<void>(`/api/objects/${entity}/${id}`, { method: "DELETE" }),
  action: <T = unknown>(path: string, body?: Record<string, unknown>) =>
    request<T>(path, {
      method: "POST",
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  rejectProposal: (id: number) =>
    request<unknown>(`/api/v2/nutrition/proposals/${id}/reject`, {
      method: "POST",
    }),
  restoreRevision: (id: number, revision: number) =>
    request<unknown>(
      `/api/v2/products/${id}/nutrition/revisions/${revision}/restore`,
      { method: "POST" },
    ),
  listProducts: () => request<ProductListResponse>("/api/objects/products"),

  getProductNutrition: (productId: number) =>
    request<NutritionRecord>(`/api/v2/products/${productId}/nutrition`),

  listPendingProposals: () =>
    request<NutritionProposalList>(
      "/api/v2/nutrition/proposals?status=pending",
    ),

  approveProposal: (proposalId: number) =>
    request<NutritionRecord>(
      `/api/v2/nutrition/proposals/${proposalId}/approve`,
      {
        method: "POST",
      },
    ),

  createProposal: (payload: CreateProposalPayload) =>
    request<unknown>("/api/v2/nutrition/proposals", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  listNutritionRevisions: (productId: number) =>
    request<NutritionRevisionList>(
      `/api/v2/products/${productId}/nutrition/revisions`,
    ),

  listStock: () => request<StockOverviewItem[]>("/api/stock"),

  getStockVolatile: (dueSoonDays = 5) =>
    request<StockVolatile>(`/api/stock/volatile?due_soon_days=${dueSoonDays}`),

  getStockProduct: (productId: number) =>
    request<StockProductDetails>(`/api/stock/products/${productId}`),

  purchaseStock: (productId: number, amount: number) =>
    request<unknown>(`/api/stock/products/${productId}/add`, {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),

  consumeStock: (productId: number, amount: number) =>
    request<unknown>(`/api/stock/products/${productId}/consume`, {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),

  openStock: (productId: number, amount: number) =>
    request<unknown>(`/api/stock/products/${productId}/open`, {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),

  getShoppingList: (listId = 1) =>
    request<ShoppingList>(`/api/v2/shopping-lists/${listId}`),

  addShoppingProduct: (productId: number, amount: number, listId = 1) =>
    request<unknown>("/api/stock/shoppinglist/add-product", {
      method: "POST",
      body: JSON.stringify({
        product_id: productId,
        product_amount: amount,
        list_id: listId,
      }),
    }),

  removeShoppingProduct: (productId: number, amount: number, listId = 1) =>
    request<unknown>("/api/stock/shoppinglist/remove-product", {
      method: "POST",
      body: JSON.stringify({
        product_id: productId,
        product_amount: amount,
        list_id: listId,
      }),
    }),

  clearShoppingList: (listId = 1) =>
    request<unknown>("/api/stock/shoppinglist/clear", {
      method: "POST",
      body: JSON.stringify({ list_id: listId }),
    }),

  addMissingToShoppingList: (listId = 1) =>
    request<unknown>("/api/stock/shoppinglist/add-missing-products", {
      method: "POST",
      body: JSON.stringify({ list_id: listId }),
    }),

  listRecipes: () => request<Recipe[]>("/api/objects/recipes"),

  getRecipeFulfillment: (recipeId: number) =>
    request<RecipeFulfillment>(`/api/v2/recipes/${recipeId}/fulfillment`),

  consumeRecipe: (recipeId: number) =>
    request<unknown>(`/api/recipes/${recipeId}/consume`, { method: "POST" }),

  addRecipeMissingToShopping: (recipeId: number) =>
    request<unknown>(
      `/api/recipes/${recipeId}/add-not-fulfilled-products-to-shoppinglist`,
      { method: "POST", body: JSON.stringify({}) },
    ),

  listChores: () => request<Chore[]>("/api/chores"),

  executeChore: (choreId: number) =>
    request<unknown>(`/api/chores/${choreId}/execute`, { method: "POST" }),

  listTasks: (includeDone = false) =>
    request<Task[]>(
      `/api/tasks?include_done=${includeDone ? "true" : "false"}`,
    ),

  completeTask: (taskId: number) =>
    request<unknown>(`/api/tasks/${taskId}/complete`, { method: "POST" }),

  undoTask: (taskId: number) =>
    request<unknown>(`/api/tasks/${taskId}/undo`, { method: "POST" }),

  listBatteries: () => request<Battery[]>("/api/batteries"),

  chargeBattery: (batteryId: number) =>
    request<unknown>(`/api/batteries/${batteryId}/charge`, { method: "POST" }),

  getSystemInfo: () => request<SystemInfo>("/api/system/info"),
  setupStatus: () => request<{ needs_setup: boolean }>("/api/v2/setup"),
  runSetup: (body: {
    setup_token: string;
    username: string;
    password: string;
  }) =>
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

  putUserSetting: (key: string, value: unknown) =>
    request<void>(`/api/user/settings/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),

  putUserSettings: (body: Record<string, unknown>) =>
    request<UserSettings>("/api/v2/user/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  getProductByBarcode: (barcode: string) =>
    request<BarcodeProduct>(
      `/api/stock/products/by-barcode/${encodeURIComponent(barcode)}`,
    ),

  externalBarcodeLookup: (barcode: string, add = false) =>
    request<Record<string, unknown> | null>(
      `/api/stock/barcodes/external-lookup/${encodeURIComponent(barcode)}${add ? "?add=1" : ""}`,
    ),

  stockActionByBarcode: (
    barcode: string,
    action: "add" | "consume" | "open" | "transfer" | "inventory",
    body: Record<string, unknown>,
  ) =>
    request<unknown>(
      `/api/stock/products/by-barcode/${encodeURIComponent(barcode)}/${action}`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  mergeProducts: (keepId: number, removeId: number) =>
    request<void>(
      `/api/stock/products/${keepId}/merge/${removeId}`,
      { method: "POST" },
    ),

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
};

export const queryKeys = {
  products: ["products"] as const,
  nutrition: (id: number) => ["nutrition", id] as const,
  proposalsPending: ["proposals", "pending"] as const,
  revisions: (id: number) => ["revisions", id] as const,
  stock: (id: number) => ["stock", id] as const,
  stockOverview: ["stock", "overview"] as const,
  stockVolatile: ["stock", "volatile"] as const,
  stockJournal: (limit: number) => ["stock", "journal", limit] as const,
  shopping: (id = 1) => ["shopping", id] as const,
  recipes: ["recipes"] as const,
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
    Array.from(new TextEncoder().encode(name), (byte) =>
      String.fromCharCode(byte),
    ).join(""),
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
  if (!response.ok)
    throw new ApiError(response.status, "Could not download the file.", null);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
