import { enUS } from "./en-US";
import { DEFAULT_LOCALE, getLocale } from "./locale";
import type { Locale } from "./locale";
import { zhCN } from "./zh-CN";

/** 翻译键：以简体中文字典为基准，类型系统保证两种语言键集一致。 */
export type TranslationKey = keyof typeof zhCN;

/** 插值变量：模板中的 `{name}` 会被替换为对应值。 */
export type TranslationVars = Record<string, string | number>;

const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name)
      ? String(vars[name])
      : match,
  );
}

/**
 * 按语言与键取值。
 *
 * 回退链：目标语言字典 → 简体中文字典 → 键本身，绝不返回 undefined。
 */
export function translate(
  locale: Locale,
  key: TranslationKey,
  vars?: TranslationVars,
): string {
  const dict = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  const template = dict[key] ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? key;
  return interpolate(template, vars);
}

/** 使用当前模块级语言翻译；供非 React 代码使用。 */
export function t(key: TranslationKey, vars?: TranslationVars): string {
  return translate(getLocale(), key, vars);
}
