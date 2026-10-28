import type { UserSettings } from "./types";
import { preferenceEnabled } from "./preferences";

export type ThemePreference = "light" | "dark" | "system";

const CLOCK_TIME = /^(?:([01]\d|2[0-3]):([0-5]\d)|(24):(00))$/;

export function isNightModeTime(value: string): boolean {
  return CLOCK_TIME.test(value);
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "light" || preference === "dark") return preference;

  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function clockTime(value: UserSettings[string] | undefined, now: Date): Date | null {
  const match = CLOCK_TIME.exec(String(value));

  if (!match) return null;

  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    Number(match[1] ?? match[3]),
    Number(match[2] ?? match[4]),
  );
}

/** Retains the time range and invalid-input rules in Grocy 4.5.0's CheckNightMode. */
export function nightModeEnabled(settings: UserSettings, systemDark: boolean, now = new Date()) {
  const mode = settings.night_mode === undefined ? "follow-system" : settings.night_mode;
  const previous = preferenceEnabled(settings.night_mode_enabled_internal);

  if (mode !== "follow-system" && preferenceEnabled(settings.auto_night_mode_enabled)) {
    const start = clockTime(settings.auto_night_mode_time_range_from, now);
    const end = clockTime(settings.auto_night_mode_time_range_to, now);

    if (!start) return previous;

    // The legacy script checks end.isValid instead of calling it. An invalid end disables the mode.
    if (!end) return false;

    if (preferenceEnabled(settings.auto_night_mode_time_range_goes_over_midnight))
      end.setDate(end.getDate() + 1);

    return now > start && now < end;
  }

  if (mode === "on") return true;

  if (mode === "off") return false;

  return mode === "follow-system" ? systemDark : previous;
}

export function applyTheme(preference: ThemePreference): void {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}
