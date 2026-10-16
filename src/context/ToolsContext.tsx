import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { t } from "../i18n/translate";
import {
  isDesktopRuntime,
  notDesktopMessage,
  toErrorMessage,
} from "../services/backend";
import * as toolsService from "../services/tools";
import type { ToolConfigInput, ToolEntry, ToolState } from "../types/domain";
import { useRevision } from "./RevisionContext";

const EMPTY_STATE: ToolState = { entries: [], lastDetectionAt: null };

interface ToolsContextValue {
  tools: ToolEntry[];
  lastDetectionAt: string | null;
  loading: boolean;
  /** 是否有检测正在执行。 */
  detecting: boolean;
  error: string | null;
  desktopAvailable: boolean;
  refresh: () => Promise<void>;
  /** 触发检测；不传工具 id 时进行全量检测。 */
  detect: (toolId?: string) => Promise<void>;
  /** 仅重新校验一条已保存的配置（路径 / 命令），不触发全量自动检测。 */
  revalidateTool: (id: string) => Promise<void>;
  addTool: (input: ToolConfigInput) => Promise<void>;
  updateTool: (id: string, input: ToolConfigInput) => Promise<void>;
  removeTool: (id: string) => Promise<void>;
  setDefaultTool: (id: string | null) => Promise<void>;
  clearError: () => void;
}

const ToolsContext = createContext<ToolsContextValue | null>(null);

/**
 * 开发工具数据的统一来源。
 *
 * 检测与持久化均由 Rust 后端完成；所有变更命令直接返回最新状态，
 * 因此这里用返回值更新本地状态，无需额外重新拉取。
 */
export function ToolsProvider({ children }: { children: ReactNode }) {
  const desktopAvailable = isDesktopRuntime();
  const { bumpRevision } = useRevision();
  const [state, setState] = useState<ToolState>(EMPTY_STATE);
  const [loading, setLoading] = useState(desktopAvailable);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!desktopAvailable) {
      setState(EMPTY_STATE);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await toolsService.listTools();
      setState(result);
      setError(null);
    } catch (cause) {
      setError(toErrorMessage(cause, t("error.readTools")));
    } finally {
      setLoading(false);
    }
  }, [desktopAvailable]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 统一包裹一次「执行命令 → 应用返回状态」的流程。 */
  const run = useCallback(
    async (
      action: () => Promise<ToolState>,
      bumpsRevision = false,
    ): Promise<void> => {
      if (!desktopAvailable) {
        throw new Error(notDesktopMessage());
      }
      try {
        const next = await action();
        setState(next);
        setError(null);
        if (bumpsRevision) {
          bumpRevision();
        }
      } catch (cause) {
        const message = toErrorMessage(cause);
        setError(message);
        throw new Error(message);
      }
    },
    [desktopAvailable, bumpRevision],
  );

  const detect = useCallback(
    async (toolId?: string) => {
      setDetecting(true);
      try {
        await run(() => toolsService.detectTools(toolId ?? null));
      } finally {
        setDetecting(false);
      }
    },
    [run],
  );

  const addTool = useCallback(
    (input: ToolConfigInput) => run(() => toolsService.addTool(input), true),
    [run],
  );
  const revalidateTool = useCallback(
    (id: string) => run(() => toolsService.revalidateTool(id), true),
    [run],
  );
  const updateTool = useCallback(
    (id: string, input: ToolConfigInput) =>
      run(() => toolsService.updateTool(id, input), true),
    [run],
  );
  const removeTool = useCallback(
    (id: string) => run(() => toolsService.removeTool(id), true),
    [run],
  );
  const setDefaultTool = useCallback(
    (id: string | null) =>
      run(() => toolsService.setDefaultTool(id), true),
    [run],
  );

  const value = useMemo<ToolsContextValue>(
    () => ({
      tools: state.entries,
      lastDetectionAt: state.lastDetectionAt,
      loading,
      detecting,
      error,
      desktopAvailable,
      refresh: load,
      detect,
      revalidateTool,
      addTool,
      updateTool,
      removeTool,
      setDefaultTool,
      clearError: () => setError(null),
    }),
    [state, loading, detecting, error, desktopAvailable, load, detect, revalidateTool, addTool, updateTool, removeTool, setDefaultTool],
  );

  return <ToolsContext.Provider value={value}>{children}</ToolsContext.Provider>;
}

export function useTools(): ToolsContextValue {
  const context = useContext(ToolsContext);
  if (!context) {
    throw new Error("useTools 必须在 ToolsProvider 内部使用。");
  }
  return context;
}
