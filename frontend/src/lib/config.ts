const STORAGE_BASE = "grocy_next_api_base";
const STORAGE_KEY = "grocy_next_api_key";
const DEFAULT_API_KEY = "dev-key";

export type ApiConfig = {
  baseUrl: string;
  apiKey: string;
};

function readStored(key: string): string | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  const value = localStorage.getItem(key);
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function readApiConfig(): ApiConfig {
  const baseUrl =
    readStored(STORAGE_BASE) ?? import.meta.env.VITE_API_BASE ?? "";
  const apiKey =
    readStored(STORAGE_KEY) ?? import.meta.env.VITE_API_KEY ?? DEFAULT_API_KEY;
  return { baseUrl, apiKey };
}

export function writeApiConfig(config: ApiConfig): void {
  localStorage.setItem(STORAGE_BASE, config.baseUrl.trim());
  localStorage.setItem(STORAGE_KEY, config.apiKey.trim() || DEFAULT_API_KEY);
}

export function configStorageKeys() {
  return { base: STORAGE_BASE, key: STORAGE_KEY };
}
