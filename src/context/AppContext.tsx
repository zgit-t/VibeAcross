import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  applyTheme,
  normalizeThemeMode,
  persistThemeMode,
  readStoredThemeMode,
  resolveTheme,
} from "./theme";
import { isDesktopRuntime, toErrorMessage } from "../services/backend";
import { getSettings, updateSettings } from "../services/settings";
import type { AppSettings } from "../types/domain";
import type { ResolvedTheme, ThemeMode, ViewId } from "../types/navigation";

const EMPTY_SETTINGS: AppSettings = {
  defaultProjectFolder: null,
  theme: null,
  showLastContextOnStartup: false,
  autoRestoreLastContext: false,
};

interface AppContextValue {
  activeView: ViewId;
  navigate: (view: ViewId) => void;

  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setThemeMode: (mode: ThemeMode) => void;

  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  /** 从 SQLite 载入的应用设置。 */
  settings: AppSettings;
  /** 设置是否已从 SQLite 载入完成（浏览器模式下立即为 true）。 */
  settingsLoaded: boolean;
  defaultProjectFolder: string | null;
  setDefaultProjectFolder: (folder: string | null) => void;
  /** 启动时显示最近的工作上下文（Level 1）。 */
  showLastContextOnStartup: boolean;
  setShowLastContextOnStartup: (value: boolean) => void;
  /** 启动时自动恢复最近的工作上下文（默认关闭）。 */
  autoRestoreLastContext: boolean;
  setAutoRestoreLastContext: (value: boolean) => void;
  /** 设置持久化失败时的提示信息。 */
  settingsError: string | null;
  clearSettingsError: () => void;

  aboutOpen: boolean;
  openAbout: () => void;
  closeAbout: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [themeMode, setThemeModeState] = useState<ThemeMode>(readStoredThemeMode);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    resolveTheme("system"),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(!isDesktopRuntime());
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // 首帧后从 SQLite 读取真实设置（主题、默认项目文件夹、恢复选项）。
  useEffect(() => {
    if (!isDesktopRuntime()) {
      setSettingsLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const loaded = await getSettings();
        if (cancelled) {
          return;
        }
        setSettings(loaded);
        if (loaded.theme) {
          setThemeModeState(normalizeThemeMode(loaded.theme));
        }
      } catch {
        // 读取失败时保留 localStorage 中的主题作为回退，不影响应用启动。
      } finally {
        if (!cancelled) {
          setSettingsLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 跟随系统主题变化（仅在 system 模式下生效）。
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  const resolvedTheme: ResolvedTheme =
    themeMode === "system" ? systemTheme : themeMode;

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  const navigate = useCallback((view: ViewId) => {
    setActiveView(view);
  }, []);

  /** 将设置写入 SQLite；失败时保留现有设置并提示。 */
  const persistSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    setSettings(next);
    if (!isDesktopRuntime()) {
      return;
    }
    try {
      const saved = await updateSettings(next);
      setSettings(saved);
      setSettingsError(null);
    } catch (cause) {
      setSettingsError(toErrorMessage(cause, "保存设置失败。"));
    }
  }, []);

  const setThemeMode = useCallback(
    (mode: ThemeMode) => {
      setThemeModeState(mode);
      persistThemeMode(mode);
      void persistSettings({ theme: mode });
    },
    [persistSettings],
  );

  const setDefaultProjectFolder = useCallback(
    (folder: string | null) => {
      void persistSettings({ defaultProjectFolder: folder });
    },
    [persistSettings],
  );

  const setShowLastContextOnStartup = useCallback(
    (value: boolean) => {
      void persistSettings({ showLastContextOnStartup: value });
    },
    [persistSettings],
  );

  const setAutoRestoreLastContext = useCallback(
    (value: boolean) => {
      void persistSettings({ autoRestoreLastContext: value });
    },
    [persistSettings],
  );

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  const openAbout = useCallback(() => setAboutOpen(true), []);
  const closeAbout = useCallback(() => setAboutOpen(false), []);
  const clearSettingsError = useCallback(() => setSettingsError(null), []);

  const value = useMemo<AppContextValue>(
    () => ({
      activeView,
      navigate,
      themeMode,
      resolvedTheme,
      setThemeMode,
      sidebarCollapsed,
      toggleSidebar,
      settings,
      settingsLoaded,
      defaultProjectFolder: settings.defaultProjectFolder,
      setDefaultProjectFolder,
      showLastContextOnStartup: settings.showLastContextOnStartup,
      setShowLastContextOnStartup,
      autoRestoreLastContext: settings.autoRestoreLastContext,
      setAutoRestoreLastContext,
      settingsError,
      clearSettingsError,
      aboutOpen,
      openAbout,
      closeAbout,
    }),
    [
      activeView,
      navigate,
      themeMode,
      resolvedTheme,
      setThemeMode,
      sidebarCollapsed,
      toggleSidebar,
      settings,
      settingsLoaded,
      setDefaultProjectFolder,
      setShowLastContextOnStartup,
      setAutoRestoreLastContext,
      settingsError,
      clearSettingsError,
      aboutOpen,
      openAbout,
      closeAbout,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp 必须在 AppProvider 内部使用。");
  }
  return context;
}
