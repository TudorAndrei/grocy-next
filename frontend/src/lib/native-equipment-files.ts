import { z } from "zod";
import type { JsonObject } from "./json";
import {
  automaticBrowserSessionSelected,
  cookieSessionSelected,
  hasExplicitApiConnection,
  readApiConfig,
} from "./config";
import { nativeResourceUrl } from "./native-userfields-clear";

/** Capture once per host, after native bootstrap has supplied its configuration. */
export function nativeEquipmentResources(config: JsonObject | undefined): boolean {
  if (cookieSessionSelected()) return true;

  if (automaticBrowserSessionSelected()) return true;

  if (hasExplicitApiConnection()) return false;

  const setting = z.union([z.boolean(), z.string(), z.number()]).safeParse(config?.DISABLE_AUTH);

  // PHP treats nonempty strings such as "false" as true, but "0" as false.
  const disabled =
    setting.success &&
    setting.data !== false &&
    setting.data !== 0 &&
    setting.data !== "" &&
    setting.data !== "0";

  const automaticMode = z.enum(["dev", "demo", "prerelease"]).safeParse(config?.MODE).success;

  if ((!disabled && !automaticMode) || typeof window === "undefined") return false;

  try {
    return new URL(readApiConfig().baseUrl, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** DisplayEquipment uses JavaScript btoa, retaining raw plus signs and padding. */
export function nativeEquipmentManualPath(name: string) {
  return `/api/files/equipmentmanuals/${btoa(name)}`;
}

/** The selected Blade form instead base64-encodes its stored UTF-8 name in PHP. */
export function nativeEquipmentEditorManualUrl(name: string, config: JsonObject) {
  const bytes = Array.from(new TextEncoder().encode(name), (byte) =>
    String.fromCharCode(byte),
  ).join("");

  return nativeResourceUrl(`/api/files/equipmentmanuals/${btoa(bytes)}`, config);
}
