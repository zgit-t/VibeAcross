export { I18nProvider, useI18n } from "./I18nContext";
export type { I18nValue } from "./I18nContext";
export {
  DEFAULT_LOCALE,
  LOCALE_LABEL,
  SUPPORTED_LOCALES,
  getLocale,
  isLocale,
  normalizeLocale,
} from "./locale";
export type { Locale } from "./locale";
export { translate, t } from "./translate";
export type { TranslationKey, TranslationVars } from "./translate";
