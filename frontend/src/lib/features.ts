import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "./api";
import type { JsonObject } from "./json";
import { useNativeProductDocument } from "./native-product-document";

export type Features = {
  enabled: (name: string) => boolean;
  /** Feature policy for navigation and additional workflows, independent of native page access. */
  routeEnabled: (path: string) => boolean;
};

// Native controllers authenticate pages independently of sidebar feature flags.
// Match registered page shapes, rather than prefixes shared with modern workflows.
const nativePages = new Set([
  "/",
  "/about",
  "/barcodescannertesting",
  "/login",
  "/logout",
  "/userfields",
  "/userentities",
  "/users",
  "/usersettings",
  "/products",
  "/quantityunits",
  "/productgroups",
  "/stockoverview",
  "/stockentries",
  "/purchase",
  "/consume",
  "/transfer",
  "/inventory",
  "/stocksettings",
  "/locations",
  "/stockjournal",
  "/locationcontentsheet",
  "/quantityunitpluraltesting",
  "/stockjournal/summary",
  "/quantityunitconversionsresolved",
  "/stockreports/spendings",
  "/shoppinglocations",
  "/shoppinglist",
  "/shoppinglistsettings",
  "/recipes",
  "/recipessettings",
  "/mealplan",
  "/mealplansections",
  "/choresoverview",
  "/choretracking",
  "/choresjournal",
  "/chores",
  "/choressettings",
  "/batteriesoverview",
  "/batterytracking",
  "/batteriesjournal",
  "/batteries",
  "/batteriessettings",
  "/tasks",
  "/taskcategories",
  "/taskssettings",
  "/equipment",
  "/calendar",
  "/api",
  "/manageapikeys",
  "/manageapikeys/new",
]);

export function isNativePagePath(path: string) {
  const pathname = path.replace(/\/+$/, "") || "/";

  return (
    nativePages.has(pathname) ||
    /^\/(?:userfield|userentity|userobjects|product|quantityunit|quantityunitconversion|productgroup|stockentry|location|productbarcodes|shoppinglocation|shoppinglistitem|shoppinglist|recipe|mealplansection|chore|battery|task|taskcategory|equipment|user)\/[^/]+$/.test(
      pathname,
    ) ||
    /^\/userobject\/[^/]+\/[^/]+$/.test(pathname) ||
    /^\/user\/[^/]+\/permissions$/.test(pathname) ||
    /^\/recipe\/[^/]+\/pos\/[^/]+$/.test(pathname)
  );
}

/** SystemController::GetEntryPageRelative uses only these configured values. */
export function nativeEntryPage(config: JsonObject) {
  const features = configuredFeatures(config);
  const entry = config.ENTRY_PAGE === undefined ? "stock" : config.ENTRY_PAGE;

  const pages = [
    ["stock", "STOCK", "/stockoverview"],
    ["shoppinglist", "SHOPPINGLIST", "/shoppinglist"],
    ["recipes", "RECIPES", "/recipes"],
    ["chores", "CHORES", "/choresoverview"],
    ["tasks", "TASKS", "/tasks"],
    ["batteries", "BATTERIES", "/batteriesoverview"],
    ["equipment", "EQUIPMENT", "/equipment"],
    ["calendar", "CALENDAR", "/calendar"],
    ["mealplan", "RECIPES_MEALPLAN", "/mealplan"],
  ] as const;

  return pages.find(([name, flag]) => entry === name && features.enabled(flag))?.[2] ?? "/about";
}

export function configuredFeatures(config: JsonObject | undefined): Features {
  const enabled = (name: string) => {
    if (!config) return false;
    const value = config[`FEATURE_FLAG_${name}`];

    return value === undefined
      ? name !== "LABEL_PRINTER" &&
          name !== "THERMAL_PRINTER" &&
          name !== "DISABLE_BROWSER_BARCODE_CAMERA_SCANNING"
      : value !== false && value !== null && value !== 0 && value !== "" && value !== "0";
  };

  const routeEnabled = (path: string) => {
    const route = path.split("/")[1];

    switch (route) {
      case "stock":
      case "stockoverview":
      case "catalog":
      case "product":
      case "barcode":
      case "journal":
      case "stockjournal":
      case "stockentries":
      case "stockentry":
      case "transfer":
      case "purchase":
      case "consume":
      case "inventory":
      case "reviews":
      case "activity":
      case "productbarcodes":
      case "dashboard":
        return enabled("STOCK");
      case "products":
        return path === "/products" || path === "/products/" || enabled("STOCK");
      case "location":
      case "stockbylocation":
      case "locations":
      case "locationcontentsheet":
        return enabled("STOCK") && enabled("STOCK_LOCATION_TRACKING");
      case "shoppinglocations":
      case "shoppinglocation":
      case "stockreports":
        return enabled("STOCK") && enabled("STOCK_PRICE_TRACKING");
      case "shopping":
      case "shoppinglist":
      case "shoppinglistitem":
        return enabled("SHOPPINGLIST");
      case "recipes":
      case "recipe":
      case "recipessettings":
        return enabled("RECIPES");
      case "meal-plan":
      case "mealplan":
      case "mealplansections":
      case "mealplansection":
        return enabled("RECIPES") && enabled("RECIPES_MEALPLAN");
      case "choressettings":
      case "chore":
      case "choresoverview":
      case "chores":
      case "choretracking":
      case "choresjournal":
        return enabled("CHORES");
      case "taskssettings":
      case "task":
      case "taskcategory":
      case "taskcategories":
      case "tasks":
        return enabled("TASKS");
      case "batteriessettings":
      case "battery":
      case "batteriesoverview":
      case "batteries":
      case "batterytracking":
      case "batteriesjournal":
        return enabled("BATTERIES");
      case "household":
        return enabled("CHORES") || enabled("TASKS") || enabled("BATTERIES");
      case "equipment":
        return enabled("EQUIPMENT");
      case "calendar-agenda":
        return enabled("CALENDAR");
      case "labels":
        return enabled("LABEL_PRINTER") || enabled("THERMAL_PRINTER");
      default:
        return true;
    }
  };

  return { enabled, routeEnabled };
}

export function useFeatures() {
  const document = useNativeProductDocument();

  const query = useQuery<Awaited<ReturnType<typeof api.getSystemConfig>>>(
    document
      ? {
          queryKey: ["native-product-document", document.scope, "config"],
          queryFn: () => document.context.config,
          initialData: document.context.config,
          enabled: false,
          gcTime: 0,
        }
      : { queryKey: queryKeys.systemConfig, queryFn: api.getSystemConfig },
  );

  return { ...configuredFeatures(query.data), query };
}
