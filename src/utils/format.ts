/** 时间与文本格式化工具。 */

const relativeFormatter = new Intl.RelativeTimeFormat("zh-CN", {
  numeric: "auto",
});

const absoluteFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const DIVISIONS: Array<{ limit: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { limit: 60, unit: "second" },
  { limit: 60, unit: "minute" },
  { limit: 24, unit: "hour" },
  { limit: 30, unit: "day" },
  { limit: 12, unit: "month" },
  { limit: Number.POSITIVE_INFINITY, unit: "year" },
];

/** 相对时间，例如「3 天前」。null 返回「从未」。 */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) {
    return "从未";
  }
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) {
    return "未知";
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
  return relativeFormatter.format(Math.round(duration), unit);
}

/** 绝对日期时间，用于 tooltip。 */
export function formatDateTime(iso: string | null): string {
  if (!iso) {
    return "尚未记录";
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "未知" : absoluteFormatter.format(date);
}

/** 取用户名或路径的末段，用于紧凑展示。 */
export function lastPathSegment(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}
