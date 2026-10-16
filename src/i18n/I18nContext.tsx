import { createContext, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { useApp } from "../context/AppContext";
import { setLocale as setActiveLocale } from "./locale";
import type { Locale } from "./locale";
import { translate } from "./translate";
import type { TranslationKey, TranslationVars } from "./translate";

export interface I18nValue {
  /** 当前界面语言。 */
  locale: Locale;
  /** 切换语言（持久化到 SQLite 与 localStorage）。 */
  setLocale: (locale: Locale) => void;
  /** 按当前语言翻译文案。 */
  t: (key: TranslationKey, vars?: TranslationVars) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * 国际化 Provider，需置于 `AppProvider` 内部以读取持久化的语言设置。
 * 同步维护模块级语言，使格式化工具与服务层与界面语言保持一致。
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const { language, setLanguage } = useApp();

  // 在子组件渲染前同步模块级语言，确保非 React 读取者拿到正确值。
  setActiveLocale(language);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<I18nValue>(
    () => ({
      locale: language,
      setLocale: setLanguage,
      t: (key, vars) => translate(language, key, vars),
    }),
    [language, setLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n 必须在 I18nProvider 内部使用。");
  }
  return context;
}
