import type { QueryClient } from "@tanstack/react-query";
import { configStorageKeys, readApiConfig, writeApiConfig } from "./config";

/** Store a new API key for this browser and refetch everything with it. */
export async function signInWithKey(queryClient: QueryClient, apiKey: string) {
  writeApiConfig({ baseUrl: readApiConfig().baseUrl, apiKey });
  await queryClient.resetQueries();
}

/** Forget this browser's API key; the next request shows the login page. */
export async function forgetKey(queryClient: QueryClient) {
  localStorage.removeItem(configStorageKeys().key);
  await queryClient.resetQueries();
}
