import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRevision } from "../../context/RevisionContext";
import { toErrorMessage } from "../../services/backend";
import { listSessions } from "../../services/sessions";
import { t } from "../../i18n/translate";
import type { AiSession } from "../../types/domain";
import { compareSessionsByActivity } from "./center";

export { sessionActivityTime, compareSessionsByActivity } from "./center";

export interface RecentSessionsResult {
  /** 按最近活动时间排序、截断后的会话记录。 */
  sessions: AiSession[];
  loading: boolean;
  error: string | null;
  /** 重新拉取会话列表。 */
  reload: () => void;
}

/**
 * 最近会话数据源。
 *
 * 直接读取统一的本地会话记录（`listSessions`），与项目 / 工具页使用同一份数据，
 * 不新增任何存储。数据版本号变化（如新建 / 恢复会话、项目变更）时自动刷新，
 * 以保证展示的是真实、最新的记录。
 */
export function useRecentSessions(limit: number | null = 5): RecentSessionsResult {
  const { revision, desktopAvailable } = useRevision();
  const [all, setAll] = useState<AiSession[]>([]);
  const [loading, setLoading] = useState(desktopAvailable);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!desktopAvailable) {
      setAll([]);
      setLoading(false);
      setError(null);
      return;
    }
    // 带请求令牌，丢弃过期响应，避免版本号频繁变化时旧结果覆盖新状态。
    const token = requestRef.current + 1;
    requestRef.current = token;
    let cancelled = false;
    setLoading(true);
    listSessions({})
      .then((result) => {
        if (cancelled || requestRef.current !== token) {
          return;
        }
        setAll(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled || requestRef.current !== token) {
          return;
        }
        setError(toErrorMessage(cause, t("error.readSessions")));
      })
      .finally(() => {
        if (cancelled || requestRef.current !== token) {
          return;
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [desktopAvailable, revision, reloadToken]);

  const sessions = useMemo(() => {
    const sorted = [...all].sort(compareSessionsByActivity);
    return limit === null ? sorted : sorted.slice(0, Math.max(0, limit));
  }, [all, limit]);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  return { sessions, loading, error, reload };
}
