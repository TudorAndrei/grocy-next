import { readApiConfig } from "./config";
import { ApiError } from "./api";

function resolveUrl(path: string): string {
  const { baseUrl } = readApiConfig();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!baseUrl) return normalized;
  return `${baseUrl.replace(/\/$/, "")}${normalized}`;
}

export async function openApiDocument(path: string): Promise<void> {
  const { apiKey } = readApiConfig();
  const headers: HeadersInit = {};
  if (apiKey) headers["GROCY-API-KEY"] = apiKey;
  const response = await fetch(resolveUrl(path), { headers });
  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.statusText || "Could not open document.",
      null,
    );
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function apiHref(path: string): string {
  return resolveUrl(path);
}
