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
import { readPreference, writePreference } from "../services/preferences";
import { normalizeLocale, setLocale as setActiveLocale } from "../i18n/locale";
import type { Locale } from "../i18n/locale";
import { t } from "../i18n/translate";
import type { AppSettings } from "../types/domain";
import type { ResolvedTheme, ThemeMode, ViewId } from "../types/navigation";

const EMPTY_SETTINGS: AppSettings = {
  defaultProjectFolder: null,
  theme: null,
  showLastContextOnStartup: true,
  autoRestoreLastContext: false,
  language: null,
};

/** 界面语言的本地偏好键（SQLite 为主，localStorage 用于快速启动）。 */
const LANGUAGE_STORAGE_KEY = "vibeacross.language";

function readStoredLanguage(): Locale {
  return normalizeLocale(readPreference(LANGUAGE_STORAGE_KEY));
}

function persistLanguage(locale: Locale): void {
  writePreference(LANGUAGE_STORAGE_KEY, locale);
}

// 首帧前同步模块级语言，避免格式化工具与粗粒度组件使用过期语言。
setActiveLocale(readStoredLanguage());

interface AppContextValue {
  activeView: ViewId;
  navigate: (view: ViewId) => void;
  /** 打开 Projects 页面并定位到指定项目的详情抽屉（深链）。 */
  openProject: (projectId: string) => void;
  /** 待处理的项目深链 id；由 Projects 页面消费后清除。 */
  pendingProjectId: string | null;
  clearPendingProject: () => void;
  /** 打开 Tasks 页面并定位到指定任务（深链）。 */
  openTask: (taskId: string) => void;
  /** 待处理的任务深链 id；由 Tasks 页面消费后清除。 */
  pendingTaskId: string | null;
  clearPendingTask: () => void;
  /** 打开 Sessions 页面并定位到指定工作上下文（深链）。 */
  openSession: (sessionId: string) => void;
  /** 待处理的工作上下文深链 id；由 Sessions 页面消费后清除。 */
  pendingSessionId: string | null;
  clearPendingSession: () => void;

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
  /** 当前界面语言。 */
  language: Locale;
  setLanguage: (locale: Locale) => void;
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
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [themeMode, setThemeModeState] = useState<ThemeMode>(readStoredThemeMode);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    resolveTheme("system"),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
  const [language, setLanguageState] = useState<Locale>(readStoredLanguage);
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
        if (loaded.language) {
          const stored = normalizeLocale(loaded.language);
          setLanguageState(stored);
          setActiveLocale(stored);
          persistLanguage(stored);
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
    setPendingProjectId(null);
    setPendingTaskId(null);
    setPendingSessionId(null);
    setActiveView(view);
  }, []);

  const openProject = useCallback((projectId: string) => {
    setPendingTaskId(null);
    setPendingSessionId(null);
    setPendingProjectId(projectId);
    setActiveView("projects");
  }, []);

  const clearPendingProject = useCallback(() => setPendingProjectId(null), []);

  const openTask = useCallback((taskId: string) => {
    setPendingProjectId(null);
    setPendingSessionId(null);
    setPendingTaskId(taskId);
    setActiveView("tasks");
  }, []);

  const clearPendingTask = useCallback(() => setPendingTaskId(null), []);

  const openSession = useCallback((sessionId: string) => {
    setPendingProjectId(null);
    setPendingTaskId(null);
    setPendingSessionId(sessionId);
    setActiveView("sessions");
  }, []);

  const clearPendingSession = useCallback(() => setPendingSessionId(null), []);

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
      setSettingsError(toErrorMessage(cause, t("error.saveSettings")));
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

  const setLanguage = useCallback(
    (locale: Locale) => {
      setLanguageState(locale);
      setActiveLocale(locale);
      persistLanguage(locale);
      void persistSettings({ language: locale });
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
      openProject,
      pendingProjectId,
      clearPendingProject,
      openTask,
      pendingTaskId,
      clearPendingTask,
      openSession,
      pendingSessionId,
      clearPendingSession,
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
      language,
      setLanguage,
      settingsError,
      clearSettingsError,
      aboutOpen,
      openAbout,
      closeAbout,
    }),
    [
      activeView,
      navigate,
      openProject,
      pendingProjectId,
      clearPendingProject,
      openTask,
      pendingTaskId,
      clearPendingTask,
      openSession,
      pendingSessionId,
      clearPendingSession,
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
      language,
      setLanguage,
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
