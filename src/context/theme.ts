import { readPreference, writePreference } from "../services/preferences";
import type { ResolvedTheme, ThemeMode } from "../types/navigation";

export const THEME_STORAGE_KEY = "vibeacross.theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** 读取系统当前偏好主题。 */
export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "dark";
  }
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/** 归一化存储中的主题值，非法值回退到 system。 */
export function normalizeThemeMode(value: string | null): ThemeMode {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

/** 读取已保存的主题模式。 */
export function readStoredThemeMode(): ThemeMode {
  return normalizeThemeMode(readPreference(THEME_STORAGE_KEY));
}

/** 将主题模式解析为实际生效的主题。 */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? getSystemTheme() : mode;
}

/** 将主题写入 <html data-theme>，驱动所有 CSS 变量切换。 */
export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
}

/** 在应用挂载前同步应用一次主题，减少主题闪烁。 */
export function applyInitialTheme(): void {
  applyTheme(resolveTheme(readStoredThemeMode()));
}

/** 持久化主题模式。 */
export function persistThemeMode(mode: ThemeMode): void {
  writePreference(THEME_STORAGE_KEY, mode);
}
