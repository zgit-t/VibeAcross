import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Task,
  TaskInput,
  TaskQuery,
  TaskStats,
  TaskStatus,
} from "../types/domain";
import { t } from "../i18n/translate";
import { toErrorMessage } from "../services/backend";
import * as tasksService from "../services/tasks";
import { useRevision } from "./RevisionContext";

const EMPTY_STATS: TaskStats = { todo: 0, inProgress: 0, done: 0, total: 0 };

export interface TaskList {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * 订阅任务列表。
 *
 * `query` 会被序列化后作为依赖：条件变化或全局版本号变化时自动重新拉取，
 * 因此任务的新增、编辑、状态切换都会实时反映到所有列表。
 */
export function useTaskList(query: TaskQuery = {}): TaskList {
  const { revision, desktopAvailable } = useRevision();
  // 序列化后作为稳定依赖，避免对象字面量导致每次渲染都重新拉取。
  const key = JSON.stringify(query);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(desktopAvailable);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!desktopAvailable) {
      setTasks([]);
      setLoading(false);
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    try {
      const result = await tasksService.listTasks(JSON.parse(key) as TaskQuery);
      if (requestId !== requestIdRef.current) {
        return;
      }
      setTasks(result);
      setError(null);
    } catch (cause) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setError(toErrorMessage(cause, t("error.readTasks")));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [desktopAvailable, key]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  return { tasks, loading, error, refresh: load };
}

/** 订阅全局任务统计（按状态计数）。 */
export function useTaskStats(): TaskStats {
  const { revision, desktopAvailable } = useRevision();
  const [stats, setStats] = useState<TaskStats>(EMPTY_STATS);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!desktopAvailable) {
      setStats(EMPTY_STATS);
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    void (async () => {
      try {
        const result = await tasksService.taskStats();
        if (requestId === requestIdRef.current) {
          setStats(result);
        }
      } catch {
        if (requestId === requestIdRef.current) {
          setStats(EMPTY_STATS);
        }
      }
    })();
  }, [desktopAvailable, revision]);

  return stats;
}

export interface TaskActions {
  createTask: (input: TaskInput) => Promise<Task>;
  updateTask: (id: string, input: TaskInput) => Promise<Task>;
  setTaskStatus: (id: string, status: TaskStatus) => Promise<Task>;
  deleteTask: (id: string) => Promise<void>;
}

/**
 * 任务变更操作。成功后自增全局版本号，驱动列表与统计自动刷新。
 */
export function useTaskActions(): TaskActions {
  const { bumpRevision } = useRevision();

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        const result = await action();
        bumpRevision();
        return result;
      } catch (cause) {
        throw new Error(toErrorMessage(cause));
      }
    },
    [bumpRevision],
  );

  return useMemo<TaskActions>(
    () => ({
      createTask: (input) => run(() => tasksService.createTask(input)),
      updateTask: (id, input) => run(() => tasksService.updateTask(id, input)),
      setTaskStatus: (id, status) =>
        run(() => tasksService.setTaskStatus(id, status)),
      deleteTask: (id) => run(() => tasksService.deleteTask(id)),
    }),
    [run],
  );
}
