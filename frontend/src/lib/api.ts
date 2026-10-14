import { readApiConfig } from "./config";
import type {
  CreateProposalPayload,
  NutritionProposalList,
  NutritionRecord,
  NutritionRevisionList,
  ProductListResponse,
  Recipe,
  RecipeFulfillment,
  StockProductDetails,
} from "./types";

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
    if ("error_message" in body && typeof (body as { error_message: unknown }).error_message === "string") {
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
    throw new ApiError(
      response.status,
      errorMessage(body, response.statusText || "Request failed"),
      body,
    );
  }
  return body as T;
}

export const api = {
  listProducts: () => request<ProductListResponse>("/api/objects/products"),

  getProductNutrition: (productId: number) =>
    request<NutritionRecord>(`/api/v2/products/${productId}/nutrition`),

  listPendingProposals: () =>
    request<NutritionProposalList>("/api/v2/nutrition/proposals?status=pending"),

  approveProposal: (proposalId: number) =>
    request<NutritionRecord>(`/api/v2/nutrition/proposals/${proposalId}/approve`, {
      method: "POST",
    }),

  createProposal: (payload: CreateProposalPayload) =>
    request<unknown>("/api/v2/nutrition/proposals", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  listNutritionRevisions: (productId: number) =>
    request<NutritionRevisionList>(`/api/v2/products/${productId}/nutrition/revisions`),

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

  listRecipes: () => request<Recipe[]>("/api/objects/recipes"),

  getRecipeFulfillment: (recipeId: number) =>
    request<RecipeFulfillment>(`/api/recipes/${recipeId}/fulfillment`),

  consumeRecipe: (recipeId: number) =>
    request<unknown>(`/api/recipes/${recipeId}/consume`, { method: "POST" }),

  listChores: () => request<Array<{ id: number; name: string; period_type: string }>>("/api/chores"),

  executeChore: (choreId: number) =>
    request<unknown>(`/api/chores/${choreId}/execute`, { method: "POST" }),
};

export const queryKeys = {
  products: ["products"] as const,
  nutrition: (id: number) => ["nutrition", id] as const,
  proposalsPending: ["proposals", "pending"] as const,
  revisions: (id: number) => ["revisions", id] as const,
  stock: (id: number) => ["stock", id] as const,
  recipes: ["recipes"] as const,
  recipeFulfillment: (id: number) => ["recipe-fulfillment", id] as const,
  chores: ["chores"] as const,
};
