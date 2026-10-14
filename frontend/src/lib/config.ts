const STORAGE_BASE = "grocy_next_api_base";
const STORAGE_KEY = "grocy_next_api_key";

export type ApiConfig = {
  baseUrl: string;
  apiKey: string;
};

export function readApiConfig(): ApiConfig {
  const baseUrl =
    (typeof localStorage !== "undefined"
      ? localStorage.getItem(STORAGE_BASE)
      : null) ??
    import.meta.env.VITE_API_BASE ??
    "";
  const apiKey =
    (typeof localStorage !== "undefined"
      ? localStorage.getItem(STORAGE_KEY)
      : null) ??
    import.meta.env.VITE_API_KEY ??
    "";
  return { baseUrl, apiKey };
}

export function writeApiConfig(config: ApiConfig): void {
  localStorage.setItem(STORAGE_BASE, config.baseUrl.trim());
  localStorage.setItem(STORAGE_KEY, config.apiKey.trim());
}

export function configStorageKeys() {
  return { base: STORAGE_BASE, key: STORAGE_KEY };
}
