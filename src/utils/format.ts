/** 时间与文本格式化工具（随界面语言变化）。 */

import { getLocale } from "../i18n/locale";
import { t } from "../i18n/translate";

interface Formatters {
  relative: Intl.RelativeTimeFormat;
  absolute: Intl.DateTimeFormat;
}

const formatterCache = new Map<string, Formatters>();

/** 按语言缓存 Intl formatter，避免每次调用都重新构造。 */
function getFormatters(locale: string): Formatters {
  let entry = formatterCache.get(locale);
  if (!entry) {
    entry = {
      relative: new Intl.RelativeTimeFormat(locale, { numeric: "auto" }),
      absolute: new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
    formatterCache.set(locale, entry);
  }
  return entry;
}

const DIVISIONS: Array<{ limit: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { limit: 60, unit: "second" },
  { limit: 60, unit: "minute" },
  { limit: 24, unit: "hour" },
  { limit: 30, unit: "day" },
  { limit: 12, unit: "month" },
  { limit: Number.POSITIVE_INFINITY, unit: "year" },
];

/** 相对时间，例如「3 天前」/「3 days ago」。null 返回「从未」。 */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) {
    return t("format.never");
  }
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) {
    return t("format.unknown");
  }

  let duration = (timestamp - Date.now()) / 1000;
  let divisionIndex = 0;
  while (
    divisionIndex < DIVISIONS.length - 1 &&
    Math.abs(duration) >= DIVISIONS[divisionIndex].limit
  ) {
    duration /= DIVISIONS[divisionIndex].limit;
    divisionIndex += 1;
  }
  const { unit } = DIVISIONS[divisionIndex];
  return getFormatters(getLocale()).relative.format(Math.round(duration), unit);
}

/** 绝对日期时间，用于 tooltip。 */
export function formatDateTime(iso: string | null): string {
  if (!iso) {
    return t("format.notRecorded");
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? t("format.unknown")
    : getFormatters(getLocale()).absolute.format(date);
}

/** 取用户名或路径的末段，用于紧凑展示。 */
export function lastPathSegment(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}
