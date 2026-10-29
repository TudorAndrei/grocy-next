import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "./api";
import type { JsonObject } from "./json";

export type Features = {
  enabled: (name: string) => boolean;
  routeEnabled: (path: string) => boolean;
};

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
      case "products":
      case "product":
      case "barcode":
      case "journal":
      case "stockjournal":
      case "stockentries":
      case "stockentry":
      case "transfer":
      case "purchase":
      case "reviews":
      case "activity":
      case "dashboard":
        return enabled("STOCK");
      case "locations":
        return enabled("STOCK") && enabled("STOCK_LOCATION_TRACKING");
      case "shopping":
      case "shoppinglistitem":
        return enabled("SHOPPINGLIST");
      case "recipes":
        return enabled("RECIPES");
      case "meal-plan":
        return enabled("RECIPES") && enabled("RECIPES_MEALPLAN");
      case "chores":
        return enabled("CHORES");
      case "tasks":
        return enabled("TASKS");
      case "batteries":
        return enabled("BATTERIES");
      case "household":
        return enabled("CHORES") || enabled("TASKS") || enabled("BATTERIES");
      case "equipment":
        return enabled("EQUIPMENT");
      case "calendar":
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
  const query = useQuery({ queryKey: queryKeys.systemConfig, queryFn: api.getSystemConfig });

  return { ...configuredFeatures(query.data), query };
}
