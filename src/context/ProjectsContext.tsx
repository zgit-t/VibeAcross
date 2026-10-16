import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { LaunchResult, Project, ProjectSort } from "../types/domain";
import {
  isDesktopRuntime,
  NOT_DESKTOP_MESSAGE,
  toErrorMessage,
} from "../services/backend";
import * as projectsService from "../services/projects";
import type {
  CreateProjectInput,
  ImportProjectInput,
} from "../services/projects";
import { useActivity } from "./ActivityContext";

interface ProjectsContextValue {
  projects: Project[];
  loading: boolean;
  error: string | null;
  /** 数据后端（Tauri 桌面运行时）是否可用。 */
  desktopAvailable: boolean;
  sort: ProjectSort;
  setSort: (sort: ProjectSort) => void;
  refresh: () => Promise<void>;
  clearError: () => void;
  createProject: (input: CreateProjectInput) => Promise<Project>;
  importProject: (input: ImportProjectInput) => Promise<Project>;
  renameProject: (id: string, name: string) => Promise<void>;
  updateDescription: (id: string, description: string | null) => Promise<void>;
  setFavorite: (id: string, value: boolean) => Promise<void>;
  relocate: (id: string, path: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  touchOpened: (id: string) => Promise<void>;
  /** 设置或清除项目的默认开发工具。 */
  setProjectTool: (id: string, toolId: string | null) => Promise<void>;
  /** 在项目目录中启动工具；`toolId` 为 null 时使用默认工具。 */
  launchProject: (id: string, toolId: string | null) => Promise<LaunchResult>;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

/**
 * 项目数据的统一来源。
 *
 * 所有读写都通过 Rust 后端命令完成，前端只做展示与本地搜索/筛选。
 * 任何变更操作成功后都会重新拉取列表，确保界面与数据库保持一致。
 */
export function ProjectsProvider({ children }: { children: ReactNode }) {
  const desktopAvailable = isDesktopRuntime();
  const { bumpRevision } = useActivity();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(desktopAvailable);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<ProjectSort>("recent");

  const load = useCallback(
    async (nextSort: ProjectSort) => {
      if (!desktopAvailable) {
        setProjects([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result = await projectsService.listProjects(nextSort);
        setProjects(result);
        setError(null);
      } catch (cause) {
        setError(toErrorMessage(cause, "读取项目列表失败。"));
      } finally {
        setLoading(false);
      }
    },
    [desktopAvailable],
  );

  useEffect(() => {
    void load(sort);
  }, [load, sort]);

  const refresh = useCallback(() => load(sort), [load, sort]);

  /** 统一包裹一次「执行变更 → 刷新列表」的流程。 */
  const mutate = useCallback(
    async <T,>(action: () => Promise<T>, recordsActivity = false): Promise<T> => {
      if (!desktopAvailable) {
        throw new Error(NOT_DESKTOP_MESSAGE);
      }
      try {
        const result = await action();
        setError(null);
        await load(sort);
        // 记录活动的操作会自增版本号，驱动 Activity / Tasks 视图刷新。
        if (recordsActivity) {
          bumpRevision();
        }
        return result;
      } catch (cause) {
        throw new Error(toErrorMessage(cause));
      }
    },
    [desktopAvailable, load, sort, bumpRevision],
  );

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      loading,
      error,
      desktopAvailable,
      sort,
      setSort,
      refresh,
      clearError: () => setError(null),
      createProject: (input) =>
        mutate(() => projectsService.createProject(input), true),
      importProject: (input) =>
        mutate(() => projectsService.importProject(input), true),
      renameProject: (id, name) =>
        mutate(() => projectsService.renameProject(id, name), true).then(
          () => undefined,
        ),
      updateDescription: (id, description) =>
        mutate(
          () => projectsService.updateProjectDescription(id, description),
          true,
        ).then(() => undefined),
      setFavorite: (id, value) =>
        mutate(() => projectsService.setProjectFavorite(id, value)).then(
          () => undefined,
        ),
      relocate: (id, path) =>
        mutate(() => projectsService.relocateProject(id, path), true).then(
          () => undefined,
        ),
      remove: (id) =>
        mutate(() => projectsService.removeProject(id), true).then(
          () => undefined,
        ),
      touchOpened: (id) =>
        mutate(() => projectsService.touchProjectOpened(id)).then(
          () => undefined,
        ),
      setProjectTool: (id, toolId) =>
        mutate(() => projectsService.setProjectTool(id, toolId), true).then(
          () => undefined,
        ),
      launchProject: async (id, toolId) => {
        if (!desktopAvailable) {
          throw new Error(NOT_DESKTOP_MESSAGE);
        }
        const result = await projectsService.launchProject(id, toolId);
        // 显式指定工具时后端会写入默认关联，刷新列表以保持一致。
        if (toolId) {
          await load(sort);
        }
        bumpRevision();
        return result;
      },
    }),
    [projects, loading, error, desktopAvailable, sort, refresh, mutate, load, bumpRevision],
  );

  return (
    <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>
  );
}

export function useProjects(): ProjectsContextValue {
  const context = useContext(ProjectsContext);
  if (!context) {
    throw new Error("useProjects 必须在 ProjectsProvider 内部使用。");
  }
  return context;
}
