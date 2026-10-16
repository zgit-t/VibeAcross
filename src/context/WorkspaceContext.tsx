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
import type {
  LaunchResult,
  WorkspaceSession,
  WorkspaceSessionInput,
} from "../types/domain";
import { t } from "../i18n/translate";
import {
  isDesktopRuntime,
  notDesktopMessage,
  toErrorMessage,
} from "../services/backend";
import * as workspaceService from "../services/workspace";
import { useRevision } from "./RevisionContext";
import { useApp } from "./AppContext";

type AutoRestoreState = "idle" | "running" | "success" | "failed";

export interface AutoRestoreStatus {
  state: AutoRestoreState;
  /** 面向用户的简短结果说明；idle/running 时为 null。 */
  message: string | null;
}

interface WorkspaceContextValue {
  sessions: WorkspaceSession[];
  /** 最近一次使用的工作上下文（列表首项）；没有记录时为 null。 */
  lastSession: WorkspaceSession | null;
  loading: boolean;
  error: string | null;
  desktopAvailable: boolean;
  refresh: () => Promise<void>;
  clearError: () => void;
  createSession: (input: WorkspaceSessionInput) => Promise<WorkspaceSession>;
  updateSession: (
    id: string,
    input: WorkspaceSessionInput,
  ) => Promise<WorkspaceSession>;
  deleteSession: (id: string) => Promise<void>;
  /** 恢复工作上下文；`toolId` 为 null 时使用记录中保存的工具。 */
  restoreSession: (id: string, toolId?: string | null) => Promise<LaunchResult>;
  /** 启动时自动恢复的结果状态（供界面展示，默认不会自动启动外部程序）。 */
  autoRestore: AutoRestoreStatus;
  dismissAutoRestore: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/**
 * 工作上下文数据的统一来源（Phase 7）。
 *
 * 所有读写均通过 Rust 后端命令完成；恢复操作完成后重新拉取列表以刷新
 * 「上次恢复结果 / 最近使用时间」。自动恢复默认关闭，仅在用户于设置中
 * 明确开启、且已完成设置与列表加载后执行一次。
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const desktopAvailable = isDesktopRuntime();
  const { bumpRevision } = useRevision();
  const { settingsLoaded, autoRestoreLastContext } = useApp();

  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [loading, setLoading] = useState(desktopAvailable);
  const [error, setError] = useState<string | null>(null);
  const [autoRestore, setAutoRestore] = useState<AutoRestoreStatus>({
    state: "idle",
    message: null,
  });

  const load = useCallback(async () => {
    if (!desktopAvailable) {
      setSessions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await workspaceService.listWorkspaceSessions();
      setSessions(result);
      setError(null);
    } catch (cause) {
      setError(toErrorMessage(cause, t("error.readWorkspace")));
    } finally {
      setLoading(false);
    }
  }, [desktopAvailable]);

  useEffect(() => {
    void load();
  }, [load]);

  const lastSession = sessions.length > 0 ? sessions[0] : null;

  const mutate = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      if (!desktopAvailable) {
        throw new Error(notDesktopMessage());
      }
      try {
        const result = await action();
        setError(null);
        await load();
        // 增删改与恢复操作成功后自增版本号，驱动相关视图刷新。
        bumpRevision();
        return result;
      } catch (cause) {
        throw new Error(toErrorMessage(cause));
      }
    },
    [desktopAvailable, load, bumpRevision],
  );

  const restoreSession = useCallback(
    (id: string, toolId: string | null = null) =>
      mutate(() => workspaceService.restoreWorkspaceSession(id, toolId)),
    [mutate],
  );

  // 启动时自动恢复：仅在用户显式开启、且设置与列表均已就绪后尝试一次。
  const attemptedRef = useRef(false);
  useEffect(() => {
    if (attemptedRef.current || !desktopAvailable || !settingsLoaded || loading) {
      return;
    }
    attemptedRef.current = true;
    if (!autoRestoreLastContext || !lastSession) {
      return;
    }
    const target = lastSession;
    const name =
      target.label ?? target.projectName ?? t("workspace.autoRestore.fallbackName");
    setAutoRestore({ state: "running", message: null });
    void (async () => {
      try {
        await restoreSession(target.id);
        setAutoRestore({
          state: "success",
          message: t("workspace.autoRestore.success", { name }),
        });
      } catch (cause) {
        // 自动恢复失败时退回正常界面，不影响应用使用。
        setAutoRestore({
          state: "failed",
          message: toErrorMessage(
            cause,
            t("workspace.autoRestore.failed", { name }),
          ),
        });
      }
    })();
  }, [desktopAvailable, settingsLoaded, loading, autoRestoreLastContext, lastSession, restoreSession]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      sessions,
      lastSession,
      loading,
      error,
      desktopAvailable,
      refresh: load,
      clearError: () => setError(null),
      createSession: (input) =>
        mutate(() => workspaceService.createWorkspaceSession(input)),
      updateSession: (id, input) =>
        mutate(() => workspaceService.updateWorkspaceSession(id, input)),
      deleteSession: (id) =>
        mutate(() => workspaceService.deleteWorkspaceSession(id)).then(
          () => undefined,
        ),
      restoreSession,
      autoRestore,
      dismissAutoRestore: () => setAutoRestore({ state: "idle", message: null }),
    }),
    [sessions, lastSession, loading, error, desktopAvailable, load, mutate, restoreSession, autoRestore],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace 必须在 WorkspaceProvider 内部使用。");
  }
  return context;
}
