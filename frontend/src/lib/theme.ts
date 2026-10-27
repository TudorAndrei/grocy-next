const STORAGE_THEME = "grocy_next_theme";

export type ThemePreference = "light" | "dark" | "system";

export function readThemePreference(): ThemePreference {
  if (typeof localStorage === "undefined") return "system";
  const stored = localStorage.getItem(STORAGE_THEME);

  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }

  return "system";
}

export function writeThemePreference(theme: ThemePreference): void {
  localStorage.setItem(STORAGE_THEME, theme);
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "light" || preference === "dark") return preference;

  if (typeof matchMedia === "undefined") return "light";

  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(preference: ThemePreference): void {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}
