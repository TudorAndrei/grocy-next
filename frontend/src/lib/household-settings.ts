import { z } from "zod";
import type { UserSettings } from "./types";

export type HouseholdSettingsKind = "chores" | "batteries" | "tasks";

// Preserve the literal leading spaces in the pinned chore/battery templates' write keys.
export const householdSettings = {
  chores: {
    title: "Chores settings",
    overview: "Chores overview",
    destination: "/choresoverview",
    readKey: "chores_due_soon_days",
    writeKey: " chores_due_soon_days",
  },
  batteries: {
    title: "Batteries settings",
    overview: "Batteries overview",
    destination: "/batteriesoverview",
    readKey: "batteries_due_soon_days",
    writeKey: " batteries_due_soon_days",
  },
  tasks: {
    title: "Tasks settings",
    overview: undefined,
    destination: "/tasks",
    readKey: "tasks_due_soon_days",
    writeKey: "tasks_due_soon_days",
  },
} as const;

export const householdSettingsDefaults: UserSettings = {
  chores_due_soon_days: 5,
  batteries_due_soon_days: 5,
  tasks_due_soon_days: 5,
  chores_overview_swap_tracking_buttons: false,
};

export function householdDueSoonValue(settings: UserSettings, kind: HouseholdSettingsKind) {
  const key = householdSettings[kind].readKey;
  const value = settings[key] === undefined ? householdSettingsDefaults[key] : settings[key];

  return value === null ? "" : String(value);
}

export function sameHouseholdSetting(
  first: UserSettings[string] | undefined,
  second: UserSettings[string],
) {
  if (first === undefined || first === null || second === null) return first === second;

  if (z.string().safeParse(first).success && z.string().safeParse(second).success)
    return first === second;

  return Number(first) === Number(second);
}
