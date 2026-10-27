import { readApiConfig } from "./config";
import { ApiError } from "./api";

function resolveUrl(path: string): string {
  const { baseUrl } = readApiConfig();
  const normalized = path.startsWith("/") ? path : `/${path}`;

  if (!baseUrl) return normalized;

  return `${baseUrl.replace(/\/$/, "")}${normalized}`;
}

export async function fetchApiDocument(path: string, signal?: AbortSignal): Promise<Blob> {
  const { apiKey } = readApiConfig();
  const headers: HeadersInit = {};

  if (apiKey) headers["GROCY-API-KEY"] = apiKey;
  const response = await fetch(resolveUrl(path), { headers, signal });

  if (!response.ok) {
    throw new ApiError(response.status, response.statusText || "Could not open document.", null);
  }

  return response.blob();
}

export async function openApiDocument(path: string): Promise<void> {
  const blob = await fetchApiDocument(path);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadApiDocument(path: string, filename: string): Promise<void> {
  const url = URL.createObjectURL(await fetchApiDocument(path));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function apiHref(path: string): string {
  return resolveUrl(path);
}
