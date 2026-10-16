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
import type { ActivityLog, ActivityType } from "../types/domain";
import { isDesktopRuntime, toErrorMessage } from "../services/backend";
import * as activityService from "../services/activity";

interface ActivityContextValue {
  /**
   * 数据变更版本号。
   *
   * 任何会写入活动记录或影响任务的操作成功后都会自增，从而使各页面
   * 通过 `useActivityFeed` / `useTaskList` 等钩子自动重新拉取最新数据。
   */
  revision: number;
  bumpRevision: () => void;
  desktopAvailable: boolean;
}

const ActivityContext = createContext<ActivityContextValue | null>(null);

export function ActivityProvider({ children }: { children: ReactNode }) {
  const desktopAvailable = isDesktopRuntime();
  const [revision, setRevision] = useState(0);

  const bumpRevision = useCallback(() => {
    setRevision((prev) => prev + 1);
  }, []);

  const value = useMemo<ActivityContextValue>(
    () => ({ revision, bumpRevision, desktopAvailable }),
    [revision, bumpRevision, desktopAvailable],
  );

  return (
    <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>
  );
}

export function useActivity(): ActivityContextValue {
  const context = useContext(ActivityContext);
  if (!context) {
    throw new Error("useActivity 必须在 ActivityProvider 内部使用。");
  }
  return context;
}

export interface ActivityFeedSelector {
  projectId?: string | null;
  eventType?: ActivityType | null;
}

export interface ActivityFeed {
  items: ActivityLog[];
  total: number;
  loading: boolean;
  error: string | null;
  /** 是否还有更早的记录可加载。 */
  hasMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
}

/**
 * 订阅活动记录的分页数据。
 *
 * 当筛选条件、分页大小或全局版本号变化时自动重新拉取；`loadMore`
 * 按偏移量追加更早的记录。
 */
export function useActivityFeed(
  selector: ActivityFeedSelector = {},
  pageSize = 20,
): ActivityFeed {
  const { revision, desktopAvailable } = useActivity();
  const projectId = selector.projectId ?? null;
  const eventType = selector.eventType ?? null;

  const [items, setItems] = useState<ActivityLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(desktopAvailable);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      if (!desktopAvailable) {
        setItems([]);
        setTotal(0);
        setLoading(false);
        return;
      }
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);
      try {
        const page = await activityService.listActivity({
          projectId,
          eventType,
          limit: pageSize,
          offset,
        });
        if (requestId !== requestIdRef.current) {
          return;
        }
        setItems((prev) =>
          offset === 0 ? page.items : [...prev, ...page.items],
        );
        setTotal(page.total);
        setError(null);
      } catch (cause) {
        if (requestId !== requestIdRef.current) {
          return;
        }
        setError(toErrorMessage(cause, "读取活动记录失败。"));
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [desktopAvailable, projectId, eventType, pageSize],
  );

  useEffect(() => {
    void load(0);
  }, [load, revision]);

  const refresh = useCallback(() => load(0), [load]);
  const loadMore = useCallback(() => load(items.length), [load, items.length]);

  return {
    items,
    total,
    loading,
    error,
    hasMore: items.length < total,
    refresh,
    loadMore,
  };
}
