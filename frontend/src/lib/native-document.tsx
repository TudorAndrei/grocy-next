import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, queryKeys, request } from "./api";
import { localizationSchema } from "./localization";
import type { JsonObject } from "./json";
import type { UserSettings } from "./types";
import { getNativeProductsContext, type NativeProductsContext } from "./native-products";
import { getNativeCalendarContext, type NativeCalendarContext } from "./native-calendar";
import {
  getNativeProductContext,
  nativeProductRouteArgument,
  type NativeProductContext,
} from "./native-product-context";

type DocumentOwner = string | RegExp;

type ReloadCapability = { pathname: string | undefined; reload: () => void };

const ReloadContext = createContext<ReloadCapability | null>(null);

type NativePresentation =
  | { kind: "products"; search: string; value: NativeProductsContext }
  | { kind: "product-form"; value: NativeProductContext }
  | { kind: "calendar"; value: NativeCalendarContext };

const PresentationContext = createContext<NativePresentation | undefined>(undefined);

export function NativePresentationProvider({
  children,
  value,
}: {
  children: ReactNode;
  value?: NativePresentation;
}) {
  return <PresentationContext.Provider value={value}>{children}</PresentationContext.Provider>;
}

export function useNativePresentation() {
  return useContext(PresentationContext);
}

/** A retired page may settle writes, but cannot reload its replacement. */
export function NativeDocumentReloadProvider({
  children,
  reload,
  page,
  pathname,
}: {
  children: ReactNode;
  reload: () => void;
  page?: string;
  pathname?: string;
}) {
  const active = useRef<string>(undefined);
  useLayoutEffect(() => {
    active.current = page;

    return () => {
      active.current = undefined;
    };
  }, [page]);

  const value = useMemo(
    () => ({
      pathname,
      reload: () => {
        if (page !== undefined && active.current === page) reload();
      },
    }),
    [pathname, page, reload],
  );

  return <ReloadContext.Provider value={value}>{children}</ReloadContext.Provider>;
}

/** True means this native document owns the replacement, including retired callbacks. */
export function useNativeDocumentReload(owner?: DocumentOwner | null) {
  const context = useContext(ReloadContext);

  return useCallback(() => {
    if (!context?.pathname || owner === null) return false;

    const matches =
      owner === undefined ||
      (owner instanceof RegExp ? owner.test(context.pathname) : owner === context.pathname);

    if (!matches) return false;
    context.reload();

    return true;
  }, [context, owner]);
}

// The same table can be a child React dialog. Reset must not replace that dialog's parent.
const tableOwners = new Map<string, DocumentOwner>([
  ["products-table", "/products"],
  ["stock-overview-table", "/stockoverview"],
  ["stockentries-table", "/stockentries"],
  ["stock-journal-table", "/stockjournal"],
  ["stock-journal-summary-table", "/stockjournal/summary"],
  ["chores-overview-table", "/choresoverview"],
  ["batteries-overview-table", "/batteriesoverview"],
  ["chores-journal-table", "/choresjournal"],
  ["batteries-journal-table", "/batteriesjournal"],
  ["chores-table", "/chores"],
  ["batteries-table", "/batteries"],
  ["taskcategories-table", "/taskcategories"],
  ["tasks-table", "/tasks"],
  ["quantityunits-table", "/quantityunits"],
  ["qu-conversions-table", /^\/quantityunit\/[^/]+$/],
  ["qu-conversions-resolved-table", "/quantityunitconversionsresolved"],
  ["locations-table", "/locations"],
  ["shoppinglocations-table", "/shoppinglocations"],
  ["productgroups-table", "/productgroups"],
  ["recipes-table", "/recipes"],
  ["recipes-pos-table", /^\/recipe\/[^/]+$/],
  ["recipes-includes-table", /^\/recipe\/[^/]+$/],
  ["mealplansections-table", "/mealplansections"],
  ["equipment-table", "/equipment"],
  ["metrics-table", "/stockreports/spendings"],
  ["userfields-table", "/userfields"],
  ["userentities-table", "/userentities"],
  ["users-table", "/users"],
  ["apikeys-table", "/manageapikeys"],
]);

export function nativeTableDocumentOwner(table: string): DocumentOwner | null {
  return table.startsWith("userobjects-table-")
    ? /^\/userobjects\/[^/]+$/
    : (tableOwners.get(table) ?? null);
}

const locale = z.string().optional().catch(undefined);
const permissions = z.record(z.string(), z.boolean());

export async function readNativeDocument(
  client: QueryClient,
  signal: AbortSignal,
  location: { pathname: string; search: string; rawPathname?: string },
) {
  await Promise.all([
    client.cancelQueries({ queryKey: queryKeys.systemConfig, exact: true }),
    client.cancelQueries({ queryKey: queryKeys.userSettings, exact: true }),
    client.cancelQueries({ queryKey: queryKeys.currentUser, exact: true }),
    client.cancelQueries({ queryKey: ["user-permissions"], exact: true }),
  ]);
  signal.throwIfAborted();
  const user = await api.getCurrentUser(signal);

  signal.throwIfAborted();

  // These controllers already return their own fresh document metadata. A stale
  // generic settings request must not delay or replace that authoritative read.
  const presentation: NativePresentation | undefined =
    location.pathname === "/products"
      ? {
          kind: "products",
          search: location.search,
          value: await getNativeProductsContext(location.search, signal),
        }
      : location.pathname === "/calendar"
        ? { kind: "calendar", value: await getNativeCalendarContext(signal) }
        : /^\/product\/[^/]+$/.test(location.pathname)
          ? {
              kind: "product-form",
              value: await getNativeProductContext(
                nativeProductRouteArgument(location.rawPathname ?? location.pathname),
                signal,
              ),
            }
          : undefined;

  signal.throwIfAborted();

  const [raw, settings, grants] = await Promise.all([
    presentation
      ? presentation.value.config
      : request<JsonObject>("/api/system/config", { signal }),
    presentation
      ? presentation.value.user_settings
      : request<UserSettings>("/api/user/settings", { signal }),
    request("/api/v2/user/permissions", { signal }).then((value) => permissions.parse(value)),
  ]);

  signal.throwIfAborted();
  const config = { ...raw, LOCALE: presentation?.value.locale ?? locale.parse(raw.LOCALE) };

  const catalog = localizationSchema.parse(
    await request(
      `/api/v2/localization${config.LOCALE ? `?locale=${encodeURIComponent(config.LOCALE)}` : ""}`,
      { signal },
    ),
  );

  signal.throwIfAborted();

  // A native document starts with fresh domain reads as well as fresh metadata.
  // This also retires old actor queries whose transports ignore cancellation.
  const documentData = (query: { queryKey: readonly unknown[] }) =>
    query.queryKey[0] !== "setup" &&
    query.queryKey[0] !== "localization" &&
    !(query.queryKey[0] === "user" && query.queryKey[1] === "current");

  await client.cancelQueries({ predicate: documentData });
  signal.throwIfAborted();
  client.removeQueries({ predicate: documentData });

  return { config, settings, catalog, user, grants, presentation };
}
