/**
 * 界面语言定义与模块级当前语言。
 *
 * 模块级单例供无法使用 React Hook 的代码（格式化工具、服务层、上下文回调）
 * 读取当前语言；React 组件应通过 `useI18n()` 获取并订阅语言变化。
 */

/** 应用支持的界面语言。 */
export type Locale = "zh-CN" | "en-US";

export const DEFAULT_LOCALE: Locale = "zh-CN";

export const SUPPORTED_LOCALES: readonly Locale[] = ["zh-CN", "en-US"];

/** 语言标记 → 展示名称（以各语言自身书写）。 */
export const LOCALE_LABEL: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "en-US": "English",
};

export function isLocale(value: unknown): value is Locale {
  return value === "zh-CN" || value === "en-US";
}

/** 归一化任意字符串为受支持的语言，未知值回退到默认语言。 */
export function normalizeLocale(value: string | null | undefined): Locale {
  if (!value) {
    return DEFAULT_LOCALE;
  }
  const lower = value.trim().toLowerCase();
  if (lower.startsWith("zh")) {
    return "zh-CN";
  }
  if (lower.startsWith("en")) {
    return "en-US";
  }
  return DEFAULT_LOCALE;
}

let currentLocale: Locale = DEFAULT_LOCALE;

/** 当前语言（供非 React 模块读取）。 */
export function getLocale(): Locale {
  return currentLocale;
}

/** 更新模块级当前语言；由 I18nProvider 与设置载入逻辑调用。 */
export function setLocale(locale: Locale): void {
  currentLocale = locale;
}
