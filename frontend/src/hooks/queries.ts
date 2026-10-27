import { queryOptions } from "@tanstack/react-query";
import { api, queryKeys, request } from "@/lib/api";
import type { StockLogRow } from "@/lib/types";

export const stockOverviewQuery = () =>
  queryOptions({
    queryKey: queryKeys.stockOverview,
    queryFn: () => api.listStock(),
  });

export const stockVolatileQuery = (dueSoonDays = 5) =>
  queryOptions({
    queryKey: [...queryKeys.stockVolatile, dueSoonDays] as const,
    queryFn: () => api.getStockVolatile(dueSoonDays),
  });

export const pendingProposalsQuery = () =>
  queryOptions({
    queryKey: queryKeys.proposalsPending,
    queryFn: () => api.listPendingProposals(),
  });

export const tasksQuery = (includeDone = false) =>
  queryOptions({
    queryKey: [...queryKeys.tasks, includeDone] as const,
    queryFn: () => api.listTasks(includeDone),
  });

export const choresQuery = () =>
  queryOptions({
    queryKey: queryKeys.chores,
    queryFn: () => api.listChores(),
  });

export const batteriesQuery = () =>
  queryOptions({
    queryKey: queryKeys.batteries,
    queryFn: () => api.listBatteries(),
  });

export const systemInfoQuery = () =>
  queryOptions({
    queryKey: queryKeys.systemInfo,
    queryFn: () => api.getSystemInfo(),
  });

export const userSettingsQuery = () =>
  queryOptions({
    queryKey: queryKeys.userSettings,
    queryFn: () => api.getUserSettings(),
  });

export const currentUserQuery = () =>
  queryOptions({
    queryKey: queryKeys.currentUser,
    queryFn: () => api.getCurrentUser(),
  });

export const objectsQuery = (entity: string) =>
  queryOptions({
    queryKey: queryKeys.objects(entity),
    queryFn: () => api.objects(entity),
  });

export const stockJournalQuery = (limit = 150) =>
  queryOptions({
    queryKey: queryKeys.stockJournal(limit),
    queryFn: () => request<StockLogRow[]>(`/api/objects/stock_log?order=id:desc&limit=${limit}`),
  });

export const productsQuery = () =>
  queryOptions({
    queryKey: queryKeys.products,
    queryFn: () => api.listProducts(),
  });

export const recipesQuery = () =>
  queryOptions({
    queryKey: queryKeys.recipes,
    queryFn: () => api.listRecipes(),
  });
