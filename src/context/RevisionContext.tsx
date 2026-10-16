import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { isDesktopRuntime } from "../services/backend";

/**
 * 全局「数据版本号」。
 *
 * 任何会改变本地数据（项目 / 工具 / 任务 / 工作上下文）的操作成功后都会自增，
 * 从而使各上下文与订阅钩子自动重新拉取最新数据。它不承载任何业务数据，
 * 仅作为跨功能刷新的信号。
 */
interface RevisionContextValue {
  revision: number;
  bumpRevision: () => void;
  desktopAvailable: boolean;
}

const RevisionContext = createContext<RevisionContextValue | null>(null);

export function RevisionProvider({ children }: { children: ReactNode }) {
  const desktopAvailable = isDesktopRuntime();
  const [revision, setRevision] = useState(0);

  const bumpRevision = useCallback(() => {
    setRevision((prev) => prev + 1);
  }, []);

  const value = useMemo<RevisionContextValue>(
    () => ({ revision, bumpRevision, desktopAvailable }),
    [revision, bumpRevision, desktopAvailable],
  );

  return (
    <RevisionContext.Provider value={value}>{children}</RevisionContext.Provider>
  );
}

export function useRevision(): RevisionContextValue {
  const context = useContext(RevisionContext);
  if (!context) {
    throw new Error("useRevision 必须在 RevisionProvider 内部使用。");
  }
  return context;
}
