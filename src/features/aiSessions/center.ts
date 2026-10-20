import type { AiSession } from "../../types/domain";

/** 把时间字符串安全地解析为毫秒时间戳；缺失、空白或无效时返回 null。 */
function parseTimestamp(iso: string | null | undefined): number | null {
  if (iso == null) {
    return null;
  }
  const trimmed = iso.trim();
  if (!trimmed) {
    return null;
  }
  const timestamp = Date.parse(trimmed);
  return Number.isNaN(timestamp) ? null : timestamp;
}

/** 会话活动时间的来源字段，用于展示与之相符的文案。 */
export type SessionActivitySource = "lastUsedAt" | "updatedAt" | "none";

/**
 * 判断会话活动时间来自哪个字段。
 *
 * 只有在 `lastUsedAt` 是有效时间时才算「最近使用」；否则回退到有效的更新时间；
 * 两者都缺失 / 无效时为 `none`。据此选择文案，避免把更新时间误标为「最近使用」。
 */
export function sessionActivitySource(session: AiSession): SessionActivitySource {
  if (parseTimestamp(session.lastUsedAt) !== null) {
    return "lastUsedAt";
  }
  return parseTimestamp(session.updatedAt) !== null ? "updatedAt" : "none";
}

/**
 * 会话的最近活动时间：优先使用真实有效的「上次使用」时间，缺失或无效时回退到更新时间。
 *
 * 绝不对无效时间做字符串比较，也绝不用项目名等无关数据冒充时间。
 */
export function sessionActivityTime(session: AiSession): string {
  return sessionActivitySource(session) === "lastUsedAt"
    ? (session.lastUsedAt as string)
    : session.updatedAt;
}

/** 会话活动时间的毫秒时间戳；缺失或无效时为 null。 */
export function sessionActivityTimestamp(session: AiSession): number | null {
  return parseTimestamp(sessionActivityTime(session));
}

/**
 * 按最近活动时间倒序排列。
 *
 * 有效时间按时间戳倒序；时间缺失 / 无效的记录一律排在最后（绝不因字符串比较把
 * 无效时间误排到前面）。时间完全相同时再以更新时间、最后以 id 兜底，保证排序
 * 稳定、可复现，绝不臆造时间。
 */
export function compareSessionsByActivity(a: AiSession, b: AiSession): number {
  const byActivity = compareTimestampsDesc(
    sessionActivityTimestamp(a),
    sessionActivityTimestamp(b),
  );
  if (byActivity !== 0) {
    return byActivity;
  }
  const byUpdated = compareTimestampsDesc(
    parseTimestamp(a.updatedAt),
    parseTimestamp(b.updatedAt),
  );
  return byUpdated !== 0 ? byUpdated : a.id.localeCompare(b.id);
}

/**
 * 时间戳倒序比较：有效值在前且越新越靠前，null（缺失 / 无效）一律排在最后。
 * 两者都为 null 时视为相等，交由上层以其它字段兜底。
 */
function compareTimestampsDesc(
  a: number | null,
  b: number | null,
): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return b - a;
}

/**
 * 会话展示名称：优先使用真实会话名称，缺失时回退到统一的备用名称。
 *
 * 绝不使用所属项目名称冒充会话名称。
 */
export function sessionDisplayName(session: AiSession, fallback: string): string {
  return session.displayName.trim() || fallback;
}

/** 按会话名称排序（用于「名称」排序模式），名称相同时回退到活动时间。 */
export function compareSessionsByName(a: AiSession, b: AiSession): number {
  const byName = sessionDisplayName(a, "").localeCompare(
    sessionDisplayName(b, ""),
  );
  return byName !== 0 ? byName : compareSessionsByActivity(a, b);
}

/**
 * 对同一原生会话的重复记录去重。
 *
 * 仅当「工具安装 id」与「原生会话标识」都一致时才视为同一会话——只凭名称绝不合并。
 * 缺少原生标识的记录无法可靠确认，一律保留、不去重。重复时保留活动时间最新的一条。
 */
export function dedupeSessions(sessions: AiSession[]): AiSession[] {
  const byKey = new Map<string, AiSession>();
  const order: string[] = [];
  const withoutKey: AiSession[] = [];
  for (const session of sessions) {
    if (!session.nativeSessionId) {
      withoutKey.push(session);
      continue;
    }
    const key = `${session.toolId}\u0000${session.nativeSessionId}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, session);
      order.push(key);
      continue;
    }
    // 保留活动时间更新的记录（比较结果小于 0 表示更靠前 / 更新）。
    if (compareSessionsByActivity(session, existing) < 0) {
      byKey.set(key, session);
    }
  }
  return [...order.map((key) => byKey.get(key)!), ...withoutKey];
}

export interface SessionCenterFilter {
  /** 搜索关键词：匹配会话名称、项目名称、工具名称。 */
  search: string;
  /** 项目筛选；`null` 表示不限。 */
  projectId: string | null;
  /** 工具筛选；`null` 表示不限。 */
  toolId: string | null;
}

/** 判断会话是否匹配搜索关键词（不区分大小写，匹配名称 / 项目 / 工具）。 */
export function sessionMatchesSearch(session: AiSession, search: string): boolean {
  const keyword = search.trim().toLowerCase();
  if (!keyword) {
    return true;
  }
  const fields = [
    session.displayName,
    session.projectName ?? "",
    session.toolName ?? "",
  ];
  return fields.some((field) => field.toLowerCase().includes(keyword));
}

/** 按搜索关键词与项目 / 工具筛选会话。 */
export function filterSessions(
  sessions: AiSession[],
  filter: SessionCenterFilter,
): AiSession[] {
  return sessions.filter((session) => {
    if (filter.projectId && session.projectId !== filter.projectId) {
      return false;
    }
    if (filter.toolId && session.toolId !== filter.toolId) {
      return false;
    }
    return sessionMatchesSearch(session, filter.search);
  });
}

/** 会话列表排序方式。 */
export type SessionSort = "activity" | "name";

/** 返回排序后的新数组，不修改入参。 */
export function sortSessions(
  sessions: AiSession[],
  sort: SessionSort,
): AiSession[] {
  const sorted = [...sessions];
  sorted.sort(sort === "name" ? compareSessionsByName : compareSessionsByActivity);
  return sorted;
}
